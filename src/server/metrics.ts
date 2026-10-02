import { getSupabase } from './supabase';
import { CurrencyService } from './currency';
import { AccountService, type AccountTotals } from './accounts';
import { fetchAllRows } from './pagination';
import {
  aggregateDashboardMetrics,
  firstTrendPeriod,
  OPEN_BILL_STATUSES,
  OPEN_INVOICE_STATUSES,
  type DashboardDocument,
} from '../utils/dashboardMetrics';
import type { ReportAccount, ReportAccountType, ReportLedgerLine } from '../utils/reportCalculations';

interface OpenDocumentRow {
  status: string;
  amount_due_cents: number | string | null;
  due_date: string | null;
}

function toDocuments(rows: OpenDocumentRow[]): DashboardDocument[] {
  return rows.map((row) => ({
    status: row.status,
    amountDueCents: row.amount_due_cents,
    dueDate: row.due_date,
  }));
}

function totalsLine(account: ReportAccount, totals: AccountTotals, entryDate?: string): ReportLedgerLine {
  return {
    debit: totals.debitCents,
    credit: totals.creditCents,
    account,
    journalEntry: entryDate ? { id: entryDate, entryDate } : null,
  };
}

export class DashboardService {
  static async getMetrics(orgId: string) {
    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);

    // Postgres adds the ledger up per account (all time) and per account per
    // month (the trend window), so the dashboard costs the same handful of
    // queries however long the ledger is. Invoice and bill reads page past
    // the API's per-request row cap.
    const [invoices, bills, accounts, allTime, monthly, organization] = await Promise.all([
      fetchAllRows<OpenDocumentRow>((from, to) => supabase
        .from('invoices')
        .select('id, status, amount_due_cents, due_date')
        .eq('org_id', orgId)
        .in('status', [...OPEN_INVOICE_STATUSES])
        .order('id')
        .range(from, to)),
      fetchAllRows<OpenDocumentRow>((from, to) => supabase
        .from('bills')
        .select('id, status, amount_due_cents, due_date')
        .eq('org_id', orgId)
        .in('status', [...OPEN_BILL_STATUSES])
        .order('id')
        .range(from, to)),
      fetchAllRows<{ id: string; code: string | null; name: string | null; type: string; subtype: string | null }>((from, to) => supabase
        .from('accounts')
        .select('id, code, name, type, subtype')
        .eq('org_id', orgId)
        .order('id')
        .range(from, to)),
      AccountService.getAccountTotals(orgId),
      fetchAllRows<{ period: string; account_id: string; debit_cents: number | string | null; credit_cents: number | string | null }>(
        (from, to) => supabase
          .rpc('account_monthly_totals', {
            p_org_id: orgId,
            p_from: `${firstTrendPeriod(today)}-01`,
            p_to: today,
          })
          .range(from, to),
      ),
      supabase.from('organizations').select('base_currency').eq('id', orgId).maybeSingle(),
    ]);
    if (organization.error) throw organization.error;

    const accountById = new Map<string, ReportAccount>(accounts.map((row) => [row.id, {
      code: String(row.code || ''),
      name: String(row.name || ''),
      type: row.type as ReportAccountType,
      subtype: row.subtype,
    }]));

    const lines: ReportLedgerLine[] = [];
    for (const [accountId, totals] of allTime) {
      const account = accountById.get(accountId);
      if (account) lines.push(totalsLine(account, totals));
    }
    const trendLines: ReportLedgerLine[] = [];
    for (const row of monthly) {
      const account = accountById.get(row.account_id);
      if (!account) continue;
      trendLines.push(totalsLine(account, {
        debitCents: Math.round(Number(row.debit_cents) || 0),
        creditCents: Math.round(Number(row.credit_cents) || 0),
      }, `${row.period}-01`));
    }

    const totals = aggregateDashboardMetrics({
      invoices: toDocuments(invoices),
      bills: toDocuments(bills),
      lines,
      trendLines,
      today,
    });

    let unrealizedFX = null;
    try {
      const baseCurrency = String(organization.data?.base_currency || 'KES').toUpperCase();
      unrealizedFX = await CurrencyService.calculateUnrealizedFX(orgId, baseCurrency);
    } catch (e) {
      console.warn('Failed to calculate unrealized FX:', e);
    }

    return { ...totals, unrealizedFX };
  }
}
