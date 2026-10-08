import { getSupabase } from './supabase';
import { organizationNow } from './organizationDates';
import { fetchAllRows } from './pagination';
import { AccountService } from './accounts';
import { addDaysIso } from '../utils/dates';
import {
  aggregateBalanceSheet,
  aggregateCashFlow,
  aggregateProfitAndLoss,
  normalizeAsOfDate,
  resolveReportDateRange,
  type ReportAccount,
  type ReportAccountType,
  type ReportLedgerLine,
} from '../utils/reportCalculations';

const ACCOUNT_TYPES = new Set<ReportAccountType>(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE']);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function normalizeLedgerLines(rows: unknown[] | null): ReportLedgerLine[] {
  const normalized: ReportLedgerLine[] = [];

  for (const value of rows || []) {
    const row = asRecord(value);
    const accountRow = asRecord(row?.account);
    const accountType = accountRow?.type;
    if (!row || !accountRow || typeof accountType !== 'string' || !ACCOUNT_TYPES.has(accountType as ReportAccountType)) {
      continue;
    }

    const account: ReportAccount = {
      code: String(accountRow.code || ''),
      name: String(accountRow.name || 'Unnamed account'),
      type: accountType as ReportAccountType,
      subtype: typeof accountRow.subtype === 'string' ? accountRow.subtype : null,
    };
    const journalRow = asRecord(row.journal_entry);

    normalized.push({
      debit: typeof row.debit === 'number' || typeof row.debit === 'string' ? row.debit : 0,
      credit: typeof row.credit === 'number' || typeof row.credit === 'string' ? row.credit : 0,
      account,
      journalEntry: journalRow && typeof journalRow.id === 'string'
        ? {
          id: journalRow.id,
          sourceType: typeof journalRow.source_type === 'string' ? journalRow.source_type : null,
          entryDate: typeof journalRow.entry_date === 'string' ? journalRow.entry_date : null,
        }
        : null,
    });
  }

  return normalized;
}

/**
 * One ledger line per account carrying that account's summed debits and
 * credits, for reports that only need per-account totals (P&L, balance sheet,
 * trial balance). Postgres adds the lines up, so the report costs two queries
 * however long the ledger is, instead of one query per thousand lines.
 */
async function accountTotalLines(orgId: string, range: { from?: string; to?: string }): Promise<ReportLedgerLine[]> {
  const supabase = getSupabase();
  const [totals, accounts] = await Promise.all([
    AccountService.getAccountTotals(orgId, range),
    fetchAllRows<{ id: string; code: string | null; name: string | null; type: string; subtype: string | null }>((from, to) => supabase
      .from('accounts')
      .select('id, code, name, type, subtype')
      .eq('org_id', orgId)
      .order('id')
      .range(from, to)),
  ]);

  const lines: ReportLedgerLine[] = [];
  for (const account of accounts) {
    const total = totals.get(account.id);
    if (!total || !ACCOUNT_TYPES.has(account.type as ReportAccountType)) continue;
    lines.push({
      debit: total.debitCents,
      credit: total.creditCents,
      account: {
        code: String(account.code || ''),
        name: String(account.name || 'Unnamed account'),
        type: account.type as ReportAccountType,
        subtype: account.subtype,
      },
    });
  }
  return lines;
}

export class ReportsService {
  static async getProfitAndLoss(orgId: string, dateRange: string) {
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    return aggregateProfitAndLoss(await accountTotalLines(orgId, { from: range.start, to: range.end }));
  }

  static async getBalanceSheet(orgId: string, asOfDate: string) {
    const normalizedAsOfDate = normalizeAsOfDate(asOfDate || new Date().toISOString());
    return aggregateBalanceSheet(await accountTotalLines(orgId, { to: normalizedAsOfDate }));
  }

  static async getCashFlow(orgId: string, dateRange: string) {
    const supabase = getSupabase();
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    const select = `
      id,
      debit,
      credit,
      account:accounts!inner(name, type, code, subtype),
      journal_entry:journal_entries!inner(id, org_id, entry_date, source_type)
    `;

    // The period's lines are read one by one, because cash is classified by
    // entry. The opening cash only needs each account's total before the
    // period, which Postgres adds up (account_balance_totals).
    const [periodLines, openingLines] = await Promise.all([
      fetchAllRows<unknown>((from, to) => supabase
        .from('journal_lines')
        .select(select)
        .eq('journal_entries.org_id', orgId)
        .gte('journal_entries.entry_date', range.start)
        .lte('journal_entries.entry_date', range.end)
        .order('id')
        .range(from, to)),
      accountTotalLines(orgId, { to: addDaysIso(range.start, -1) }),
    ]);

    return aggregateCashFlow(normalizeLedgerLines(periodLines), openingLines);
  }

  static async getTrialBalance(orgId: string) {
    const lines = await accountTotalLines(orgId, {});

    const rows = lines.map((line) => {
      const net = Number(line.debit) - Number(line.credit);
      return {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debitCents: net > 0 ? net : 0,
        creditCents: net < 0 ? -net : 0,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));

    return { rows };
  }

  /**
   * The VAT position for a period: output VAT on invoices and sales receipts
   * less credit notes, input VAT on bills and expenses less supplier credits
   * (public.vat_summary), each split into standard-rated and zero-rated or
   * exempt by line, with the eTIMS queue.
   */
  static async getTaxSummary(orgId: string, period: string) {
    const supabase = getSupabase();
    const range = resolveReportDateRange(period, await organizationNow(orgId));

    const [orgResult, vat, etimsSubmissions] = await Promise.all([
      supabase
        .from('organizations')
        .select('tax_id')
        .eq('id', orgId)
        .maybeSingle(),
      supabase.rpc('vat_summary', { p_org_id: orgId, p_from: range.start, p_to: range.end }),
      fetchAllRows<{ status: string }>((from, to) => supabase
        .from('etims_submissions')
        .select('status, invoice:invoices!inner(org_id, date)')
        .eq('org_id', orgId)
        .eq('invoices.org_id', orgId)
        .gte('invoices.date', range.start)
        .lte('invoices.date', range.end)
        .order('id')
        .range(from, to)),
    ]);

    if (orgResult.error) throw orgResult.error;
    if (vat.error) throw vat.error;

    const rows = ((vat.data || []) as any[]).map((row) => ({
      side: row.side as 'OUTPUT' | 'INPUT',
      source: row.source as string,
      taxableCents: Number(row.taxable_cents) || 0,
      untaxedCents: Number(row.untaxed_cents) || 0,
      taxCents: Number(row.tax_cents) || 0,
      documents: Number(row.documents) || 0,
    }));
    const total = (side: 'OUTPUT' | 'INPUT', key: 'taxableCents' | 'untaxedCents' | 'taxCents') =>
      rows.filter((row) => row.side === side).reduce((sum, row) => sum + row[key], 0);
    const etimsVerifiedCount = etimsSubmissions.filter((submission) =>
      submission.status === 'VERIFIED' || submission.status === 'SUCCESS',
    ).length;
    const etimsPendingCount = etimsSubmissions.length - etimsVerifiedCount;
    const outputVatCents = total('OUTPUT', 'taxCents');
    const inputVatCents = total('INPUT', 'taxCents');

    return {
      period,
      range,
      kraPin: orgResult.data?.tax_id || null,
      outputVat: {
        standardRatedSalesCents: total('OUTPUT', 'taxableCents'),
        zeroRatedOrExemptSalesCents: total('OUTPUT', 'untaxedCents'),
        vatRatePercent: 16,
        taxAmountCents: outputVatCents,
      },
      inputVat: {
        claimablePurchasesCents: total('INPUT', 'taxableCents'),
        purchasesWithoutVatCents: total('INPUT', 'untaxedCents'),
        vatRatePercent: 16,
        taxAmountCents: inputVatCents,
      },
      breakdown: rows,
      withholdingTaxVat: {
        withholdingRatePercent: 2,
        withheldAmountCents: 0,
      },
      netVatPayableCents: outputVatCents - inputVatCents,
      etimsVerifiedCount,
      etimsPendingCount,
    };
  }

  static async getARAging(orgId: string) {
    const supabase = getSupabase();
    const invoices = await fetchAllRows<any>((from, to) => supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, due_date, amount_due_cents, status, customers(display_name)')
      .eq('org_id', orgId)
      .neq('status', 'VOID')
      .neq('status', 'PAID')
      .gt('amount_due_cents', 0)
      .order('id')
      .range(from, to));

    const credits = await this.openCredits(orgId, 'CUSTOMER');

    return this.bucketByDueDate([
      ...invoices.map((inv: any) => ({
        id: inv.id,
        referenceNo: inv.invoice_number,
        partyName: inv.customers?.display_name || 'Unknown Customer',
        dueDate: inv.due_date,
        amountDueCents: inv.amount_due_cents
      })),
      ...credits,
    ]);
  }

  static async getAPAging(orgId: string) {
    const supabase = getSupabase();
    const bills = await fetchAllRows<any>((from, to) => supabase
      .from('bills')
      .select('id, bill_number, vendor_id, due_date, amount_due_cents, status, vendors(display_name)')
      .eq('org_id', orgId)
      .neq('status', 'VOID')
      .neq('status', 'PAID')
      .gt('amount_due_cents', 0)
      .order('id')
      .range(from, to));

    const credits = await this.openCredits(orgId, 'SUPPLIER');

    return this.bucketByDueDate([
      ...bills.map((bill: any) => ({
        id: bill.id,
        referenceNo: bill.bill_number,
        partyName: bill.vendors?.display_name || 'Unknown Vendor',
        dueDate: bill.due_date,
        amountDueCents: bill.amount_due_cents
      })),
      ...credits,
    ]);
  }

  /** Credits not yet used, as negative amounts in the current column. */
  private static async openCredits(orgId: string, kind: 'CUSTOMER' | 'SUPPLIER') {
    const supabase = getSupabase();
    const credits = await fetchAllRows<any>((from, to) => supabase
      .from('credit_notes')
      .select('id, number, remaining_cents, customers(display_name), vendors(display_name)')
      .eq('org_id', orgId)
      .eq('kind', kind)
      .eq('status', 'OPEN')
      .order('id')
      .range(from, to));
    return credits.map((credit: any) => ({
      id: credit.id,
      referenceNo: credit.number,
      partyName: (kind === 'CUSTOMER' ? credit.customers?.display_name : credit.vendors?.display_name) || 'Unknown',
      dueDate: null,
      amountDueCents: -(Number(credit.remaining_cents) || 0),
    }));
  }

  private static bucketByDueDate(items: Array<{ id: string; referenceNo: string; partyName: string; dueDate: string | null; amountDueCents: number }>) {
    const today = new Date();
    const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    const rows = items.map(item => {
      const daysPastDue = item.dueDate
        ? Math.floor((today.getTime() - new Date(item.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      let bucket: keyof typeof buckets = 'current';
      if (daysPastDue > 90) bucket = 'days90plus';
      else if (daysPastDue > 60) bucket = 'days61to90';
      else if (daysPastDue > 30) bucket = 'days31to60';
      else if (daysPastDue > 0) bucket = 'days1to30';

      buckets[bucket] += item.amountDueCents;

      return { ...item, daysPastDue: Math.max(daysPastDue, 0), bucket };
    });

    return { rows, totals: buckets, grandTotalCents: Object.values(buckets).reduce((a, b) => a + b, 0) };
  }

  /**
   * Receivables and payables in the ledger against the open invoices and
   * bills behind them. Any difference means something reached account 1100
   * or 2000 without a document, and is shown as a problem to resolve.
   */
  static async getControlCheck(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('control_account_check', { p_org_id: orgId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) || {};
    const arLedgerCents = Math.round(Number(row.ar_ledger_cents) || 0);
    const openInvoiceCents = Math.round(Number(row.open_invoice_cents) || 0);
    const apLedgerCents = Math.round(Number(row.ap_ledger_cents) || 0);
    const openBillCents = Math.round(Number(row.open_bill_cents) || 0);
    return {
      receivables: { ledgerCents: arLedgerCents, documentsCents: openInvoiceCents, differenceCents: arLedgerCents - openInvoiceCents },
      payables: { ledgerCents: apLedgerCents, documentsCents: openBillCents, differenceCents: apLedgerCents - openBillCents },
      agrees: arLedgerCents === openInvoiceCents && apLedgerCents === openBillCents,
    };
  }

  /** Every line posted to one account, oldest first, with its entry's date and particulars. */
  static async getLedgerLinesForAccount(orgId: string, account: { id?: string; name?: string }) {
    const supabase = getSupabase();
    let accountId = account.id;
    if (!accountId) {
      const { data: accounts, error: accountError } = await supabase
        .from('accounts')
        .select('id')
        .eq('org_id', orgId)
        .eq('name', account.name || '')
        .order('code')
        .limit(1);
      if (accountError) throw accountError;
      if (!accounts || accounts.length === 0) return [];
      accountId = accounts[0].id;
    }

    const lines = await fetchAllRows<any>((from, to) => supabase
      .from('journal_lines')
      .select(`
        id,
        debit,
        credit,
        description,
        journal_entry:journal_entries!inner(id, entry_date, source_type, memo, org_id)
      `)
      .eq('account_id', accountId)
      .eq('journal_entries.org_id', orgId)
      .order('id')
      .range(from, to));

    return lines
      .map((line: any) => ({
        id: line.id,
        journalEntryId: line.journal_entry.id,
        date: line.journal_entry.entry_date,
        sourceType: line.journal_entry.source_type,
        memo: line.description || line.journal_entry.memo,
        debit: line.debit,
        credit: line.credit
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  }
}
