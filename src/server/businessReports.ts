import { getSupabase } from './supabase';
import { organizationNow } from './organizationDates';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { resolveReportDateRange } from '../utils/reportCalculations';

const SOURCE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice',
  BILL: 'Bill',
  PAYMENT: 'Payment received',
  BILL_PAYMENT: 'Payment made',
  CREDIT_NOTE: 'Credit note',
  SUPPLIER_CREDIT: 'Supplier credit',
  CREDIT_REFUND: 'Refund',
  ADJUSTMENT: 'Reversal',
  BANK: 'Bank',
};

const PNL_TYPES = ['INCOME', 'COGS', 'EXPENSE'] as const;
type PnlType = (typeof PNL_TYPES)[number];

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split('-').map(Number);
  const [endYear, endMonth] = to.slice(0, 7).split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

/**
 * Statements for customers and suppliers, sales by customer and by item,
 * spending by supplier, and profit and loss month by month. The sums are
 * made in Postgres (20261005000800_business_reports.sql); this shapes them.
 */
export class BusinessReportService {
  /** A customer's or supplier's account for a period, from the ledger, with a running balance. */
  static async partyStatement(orgId: string, partyType: 'CUSTOMER' | 'VENDOR', partyId: string, from: string, to: string) {
    if (to < from) throw new UserError('The end of the period cannot be before its start.');
    const supabase = getSupabase();
    const table = partyType === 'CUSTOMER' ? 'customers' : 'vendors';
    const [{ data: party, error: partyError }, { data: rows, error }, openDocuments] = await Promise.all([
      supabase.from(table).select('id, display_name, email, phone, billing_address, kra_pin').eq('org_id', orgId).eq('id', partyId).maybeSingle(),
      supabase.rpc('party_statement', { p_org_id: orgId, p_party_type: partyType, p_party_id: partyId, p_from: from, p_to: to }),
      partyType === 'CUSTOMER'
        ? fetchAllRows<any>((f, t) => supabase.from('invoices').select('id, invoice_number, date, due_date, total_cents, amount_due_cents')
            .eq('org_id', orgId).eq('customer_id', partyId).not('status', 'in', '(PAID,VOID)').gt('amount_due_cents', 0)
            .order('due_date').order('id').range(f, t))
        : fetchAllRows<any>((f, t) => supabase.from('bills').select('id, bill_number, date, due_date, total_cents, amount_due_cents')
            .eq('org_id', orgId).eq('vendor_id', partyId).not('status', 'in', '(PAID,VOID)').gt('amount_due_cents', 0)
            .order('due_date').order('id').range(f, t)),
    ]);
    if (partyError) throw partyError;
    if (error) throw error;
    if (!party) throw new UserError(`${partyType === 'CUSTOMER' ? 'Customer' : 'Supplier'} not found in this organization.`, 404);

    const all = (rows || []) as any[];
    const opening = Number(all.find((r) => r.kind === 'OPENING')?.amount_cents) || 0;
    let running = opening;
    const lines = all.filter((r) => r.kind === 'LINE').map((r) => {
      const amountCents = Number(r.amount_cents) || 0;
      running += amountCents;
      return {
        date: r.entry_date,
        journalEntryId: r.journal_entry_id,
        kind: SOURCE_LABEL[r.source_type] || 'Entry',
        reference: r.reference_no,
        particulars: r.memo || r.description || '',
        chargeCents: amountCents > 0 ? amountCents : 0,
        creditCents: amountCents < 0 ? -amountCents : 0,
        balanceCents: running,
      };
    });
    return {
      party: {
        id: party.id,
        name: (party as any).display_name,
        email: (party as any).email ?? null,
        phone: (party as any).phone ?? null,
        address: (party as any).billing_address ?? null,
        kraPin: (party as any).kra_pin ?? null,
      },
      from,
      to,
      openingBalanceCents: opening,
      closingBalanceCents: running,
      lines,
      openDocuments: openDocuments.map((doc) => ({
        id: doc.id,
        number: doc.invoice_number ?? doc.bill_number,
        date: doc.date,
        dueDate: doc.due_date,
        totalCents: Number(doc.total_cents) || 0,
        amountDueCents: Number(doc.amount_due_cents) || 0,
      })),
    };
  }

  static async salesByCustomer(orgId: string, dateRange: string) {
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    const { data, error } = await getSupabase().rpc('sales_by_customer', { p_org_id: orgId, p_from: range.start, p_to: range.end });
    if (error) throw error;
    const rows = ((data || []) as any[]).map((r) => ({
      customerId: r.customer_id,
      name: r.customer_name,
      invoicedCents: Number(r.invoiced_cents) || 0,
      cashSalesCents: Number(r.cash_sales_cents) || 0,
      creditedCents: Number(r.credited_cents) || 0,
      netCents: Number(r.net_cents) || 0,
      documents: Number(r.documents) || 0,
    }));
    return { range, rows, totalCents: rows.reduce((sum, r) => sum + r.netCents, 0) };
  }

  static async salesByItem(orgId: string, dateRange: string) {
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    const { data, error } = await getSupabase().rpc('sales_by_item', { p_org_id: orgId, p_from: range.start, p_to: range.end });
    if (error) throw error;
    const rows = ((data || []) as any[]).map((r) => ({
      itemId: r.item_id,
      name: r.item_name,
      quantity: Number(r.quantity) || 0,
      amountCents: Number(r.amount_cents) || 0,
      lines: Number(r.lines) || 0,
    }));
    return { range, rows, totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0) };
  }

  static async expensesBySupplier(orgId: string, dateRange: string) {
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    const { data, error } = await getSupabase().rpc('expenses_by_supplier', { p_org_id: orgId, p_from: range.start, p_to: range.end });
    if (error) throw error;
    const rows = ((data || []) as any[]).map((r) => ({
      vendorId: r.vendor_id,
      name: r.vendor_name,
      billedCents: Number(r.billed_cents) || 0,
      paidNowCents: Number(r.paid_now_cents) || 0,
      creditedCents: Number(r.credited_cents) || 0,
      netCents: Number(r.net_cents) || 0,
      documents: Number(r.documents) || 0,
    }));
    return { range, rows, totalCents: rows.reduce((sum, r) => sum + r.netCents, 0) };
  }

  /** Income, cost of sales and expenses for each month of a period, by account. */
  static async monthlyProfitAndLoss(orgId: string, dateRange: string) {
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    const supabase = getSupabase();
    const [{ data: totals, error }, accounts] = await Promise.all([
      supabase.rpc('account_monthly_totals', { p_org_id: orgId, p_from: range.start, p_to: range.end }),
      fetchAllRows<{ id: string; code: string | null; name: string | null; type: string }>((f, t) => supabase
        .from('accounts').select('id, code, name, type').eq('org_id', orgId).order('id').range(f, t)),
    ]);
    if (error) throw error;
    const months = monthsBetween(range.start, range.end);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const rows = new Map<string, { accountId: string; code: string; name: string; type: PnlType; months: number[]; totalCents: number }>();
    for (const total of (totals || []) as any[]) {
      const account = byId.get(total.account_id);
      if (!account || !PNL_TYPES.includes(account.type as PnlType)) continue;
      const index = months.indexOf(total.period);
      if (index === -1) continue;
      const debit = Number(total.debit_cents) || 0;
      const credit = Number(total.credit_cents) || 0;
      const amount = Math.round(account.type === 'INCOME' ? credit - debit : debit - credit);
      const row = rows.get(account.id) || {
        accountId: account.id, code: account.code || '', name: account.name || 'Unnamed account',
        type: account.type as PnlType, months: months.map(() => 0), totalCents: 0,
      };
      row.months[index] += amount;
      row.totalCents += amount;
      rows.set(account.id, row);
    }
    const sorted = [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
    const section = (type: PnlType) => {
      const sectionRows = sorted.filter((r) => r.type === type);
      return {
        rows: sectionRows,
        months: months.map((_, i) => sectionRows.reduce((sum, r) => sum + r.months[i], 0)),
        totalCents: sectionRows.reduce((sum, r) => sum + r.totalCents, 0),
      };
    };
    const income = section('INCOME');
    const cogs = section('COGS');
    const expenses = section('EXPENSE');
    const net = months.map((_, i) => income.months[i] - cogs.months[i] - expenses.months[i]);
    return {
      range,
      months,
      income,
      costOfSales: cogs,
      expenses,
      netMonths: net,
      netTotalCents: income.totalCents - cogs.totalCents - expenses.totalCents,
    };
  }
}
