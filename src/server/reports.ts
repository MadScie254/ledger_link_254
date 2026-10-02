import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { AccountService } from './accounts';
import {
  aggregateBalanceSheet,
  aggregateCashFlow,
  aggregateProfitAndLoss,
  aggregateTaxRows,
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
    const range = resolveReportDateRange(dateRange);
    return aggregateProfitAndLoss(await accountTotalLines(orgId, { from: range.start, to: range.end }));
  }

  static async getBalanceSheet(orgId: string, asOfDate: string) {
    const normalizedAsOfDate = normalizeAsOfDate(asOfDate || new Date().toISOString());
    return aggregateBalanceSheet(await accountTotalLines(orgId, { to: normalizedAsOfDate }));
  }

  static async getCashFlow(orgId: string, dateRange: string) {
    const supabase = getSupabase();
    const range = resolveReportDateRange(dateRange);
    const select = `
      id,
      debit,
      credit,
      account:accounts!inner(name, type, code, subtype),
      journal_entry:journal_entries!inner(id, org_id, entry_date, source_type)
    `;

    const [periodLines, openingLines] = await Promise.all([
      fetchAllRows<unknown>((from, to) => supabase
        .from('journal_lines')
        .select(select)
        .eq('journal_entries.org_id', orgId)
        .gte('journal_entries.entry_date', range.start)
        .lte('journal_entries.entry_date', range.end)
        .order('id')
        .range(from, to)),
      fetchAllRows<unknown>((from, to) => supabase
        .from('journal_lines')
        .select(select)
        .eq('journal_entries.org_id', orgId)
        .lt('journal_entries.entry_date', range.start)
        .order('id')
        .range(from, to)),
    ]);

    return aggregateCashFlow(
      normalizeLedgerLines(periodLines),
      normalizeLedgerLines(openingLines),
    );
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

  static async getTaxSummary(orgId: string, period: string) {
    const supabase = getSupabase();
    const range = resolveReportDateRange(period);

    const [orgResult, invoices, bills, etimsSubmissions] = await Promise.all([
      supabase
        .from('organizations')
        .select('tax_id')
        .eq('id', orgId)
        .maybeSingle(),
      fetchAllRows<{ subtotal_cents: number | string | null; tax_cents: number | string | null }>((from, to) => supabase
        .from('invoices')
        .select('subtotal_cents, tax_cents')
        .eq('org_id', orgId)
        .neq('status', 'VOID')
        .gte('date', range.start)
        .lte('date', range.end)
        .order('id')
        .range(from, to)),
      fetchAllRows<{ subtotal_cents: number | string | null; tax_cents: number | string | null }>((from, to) => supabase
        .from('bills')
        .select('subtotal_cents, tax_cents')
        .eq('org_id', orgId)
        .neq('status', 'VOID')
        .gte('date', range.start)
        .lte('date', range.end)
        .order('id')
        .range(from, to)),
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

    const tax = aggregateTaxRows(invoices, bills);
    const etimsVerifiedCount = etimsSubmissions.filter((submission) =>
      submission.status === 'VERIFIED' || submission.status === 'SUCCESS',
    ).length;
    const etimsPendingCount = etimsSubmissions.length - etimsVerifiedCount;

    return {
      period,
      kraPin: orgResult.data?.tax_id || null,
      outputVat: {
        standardRatedSalesCents: tax.standardRatedSalesCents,
        vatRatePercent: 16,
        taxAmountCents: tax.outputVatCents
      },
      inputVat: {
        claimablePurchasesCents: tax.claimablePurchasesCents,
        vatRatePercent: 16,
        taxAmountCents: tax.inputVatCents
      },
      withholdingTaxVat: {
        withholdingRatePercent: 2,
        withheldAmountCents: 0
      },
      netVatPayableCents: tax.outputVatCents - tax.inputVatCents,
      etimsVerifiedCount,
      etimsPendingCount
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

    return this.bucketByDueDate(invoices.map((inv: any) => ({
      id: inv.id,
      referenceNo: inv.invoice_number,
      partyName: inv.customers?.display_name || 'Unknown Customer',
      dueDate: inv.due_date,
      amountDueCents: inv.amount_due_cents
    })));
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

    return this.bucketByDueDate(bills.map((bill: any) => ({
      id: bill.id,
      referenceNo: bill.bill_number,
      partyName: bill.vendors?.display_name || 'Unknown Vendor',
      dueDate: bill.due_date,
      amountDueCents: bill.amount_due_cents
    })));
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

  static async getLedgerLinesForAccount(orgId: string, accountName: string) {
    const supabase = getSupabase();
    
    // Find account by name
    const { data: accounts, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('name', accountName)
      .limit(1);

    if (accountError || !accounts || accounts.length === 0) return [];
    const accountId = accounts[0].id;

    const lines = await fetchAllRows<any>((from, to) => supabase
      .from('journal_lines')
      .select(`
        id,
        debit,
        credit,
        journal_entry:journal_entries!inner(entry_date, source_type, memo, org_id)
      `)
      .eq('account_id', accountId)
      .eq('journal_entries.org_id', orgId)
      .order('id')
      .range(from, to));

    return lines.map((line: any) => ({
      id: line.id,
      date: line.journal_entry.entry_date,
      sourceType: line.journal_entry.source_type,
      memo: line.journal_entry.memo,
      debit: line.debit,
      credit: line.credit
    }));
  }
}
