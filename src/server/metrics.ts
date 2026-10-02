import { getSupabase } from './supabase';
import { CurrencyService } from './currency';
import { fetchAllRows, normalizeLedgerLines } from './reports';
import {
  aggregateDashboardMetrics,
  OPEN_BILL_STATUSES,
  OPEN_INVOICE_STATUSES,
  type DashboardDocument,
} from '../utils/dashboardMetrics';

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

export class DashboardService {
  static async getMetrics(orgId: string) {
    const supabase = getSupabase();

    // Every read pages past the API's per-request row cap, so a company with
    // more than a thousand invoices, bills or ledger lines is not under-counted.
    const [invoices, bills, lines] = await Promise.all([
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
      fetchAllRows<unknown>((from, to) => supabase
        .from('journal_lines')
        .select(`
          id,
          debit,
          credit,
          account:accounts!inner(name, type, code, subtype),
          journal_entry:journal_entries!inner(id, org_id, entry_date)
        `)
        .eq('journal_entries.org_id', orgId)
        .order('id')
        .range(from, to)),
    ]);

    const totals = aggregateDashboardMetrics({
      invoices: toDocuments(invoices),
      bills: toDocuments(bills),
      lines: normalizeLedgerLines(lines),
      today: new Date().toISOString().slice(0, 10),
    });

    let unrealizedFX = null;
    try {
      unrealizedFX = await CurrencyService.calculateUnrealizedFX(orgId, 'KES');
    } catch (e) {
      console.warn('Failed to calculate unrealized FX:', e);
    }

    return { ...totals, unrealizedFX };
  }
}
