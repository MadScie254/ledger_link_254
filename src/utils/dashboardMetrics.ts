import { isCashAccount, type ReportLedgerLine } from './reportCalculations.ts';

/** An invoice or bill as the dashboard needs it. */
export interface DashboardDocument {
  status: string;
  amountDueCents: number | string | null;
  dueDate: string | null;
}

export interface DashboardTrendMonth {
  /** Calendar month, YYYY-MM, which is also the sort key. */
  period: string;
  /** Short month name, e.g. "Sep". Unique within the twelve-month window. */
  month: string;
  year: number;
  /** Whole currency units, kept for the chart's existing scale. */
  revenue: number;
  expense: number;
  revenueCents: number;
  expenseCents: number;
}

export interface DashboardTotals {
  cashPositionCents: number;
  moneyInCents: number;
  overdueInvoices: number;
  overdueCents: number;
  moneyOutCents: number;
  totalIncomeCents: number;
  totalCogsCents: number;
  totalExpenseCents: number;
  netProfitCents: number;
  monthlyTrends: DashboardTrendMonth[];
}

// Statuses that still have money owed. DRAFT has not been issued; PAID and
// VOID owe nothing.
export const OPEN_INVOICE_STATUSES = ['SENT', 'PARTIALLY_PAID'] as const;
export const OPEN_BILL_STATUSES = ['OPEN', 'PARTIALLY_PAID'] as const;

export const TREND_MONTHS = 12;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function amount(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value: string | null | undefined): string | null {
  const match = (value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

/** The first YYYY-MM inside the trend window that ends in today's month. */
export function firstTrendPeriod(today: string): string {
  const year = Number(today.slice(0, 4));
  const monthIndex = Number(today.slice(5, 7)) - 1 - (TREND_MONTHS - 1);
  const start = new Date(Date.UTC(year, monthIndex, 1));
  return start.toISOString().slice(0, 7);
}

/**
 * Builds the dashboard figures from open invoices, open bills and posted
 * ledger lines.
 *
 * - Money in and money out are what is still owed (amount due), so part
 *   payments count and void, paid and draft documents do not.
 * - Cash position is bank, cash and M-Pesa accounts only, the same accounts
 *   the cash-flow report treats as cash, not every asset.
 * - Income, cost of sales and expenses cover all posted periods.
 * - Trends cover the twelve calendar months ending in today's month, keyed
 *   by year and month so the same month in different years never merges.
 *
 * `today` is a YYYY-MM-DD date. An invoice is overdue the day after its due
 * date, not on it.
 *
 * `lines` feed the all-time figures. `trendLines`, when given, feed the trend
 * instead; each needs journalEntry.entryDate. The server passes per-account
 * totals for both, so the dashboard never reads the whole ledger.
 */
export function aggregateDashboardMetrics(input: {
  invoices: DashboardDocument[];
  bills: DashboardDocument[];
  lines: ReportLedgerLine[];
  trendLines?: ReportLedgerLine[];
  today: string;
}): DashboardTotals {
  const today = dateOnly(input.today);
  if (!today) throw new Error('The dashboard date must use YYYY-MM-DD.');

  let moneyInCents = 0;
  let overdueInvoices = 0;
  let overdueCents = 0;
  for (const invoice of input.invoices) {
    if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) continue;
    const due = amount(invoice.amountDueCents);
    if (due <= 0) continue;
    moneyInCents += due;
    const dueDate = dateOnly(invoice.dueDate);
    if (dueDate && dueDate < today) {
      overdueInvoices++;
      overdueCents += due;
    }
  }

  let moneyOutCents = 0;
  for (const bill of input.bills) {
    if (!(OPEN_BILL_STATUSES as readonly string[]).includes(bill.status)) continue;
    const due = amount(bill.amountDueCents);
    if (due > 0) moneyOutCents += due;
  }

  const firstPeriod = firstTrendPeriod(today);
  const lastPeriod = today.slice(0, 7);
  const monthly = new Map<string, { revenueCents: number; expenseCents: number }>();

  let cashPositionCents = 0;
  let totalIncomeCents = 0;
  let totalCogsCents = 0;
  let totalExpenseCents = 0;

  for (const line of input.lines) {
    const debitMinusCredit = amount(line.debit) - amount(line.credit);
    const { type } = line.account;

    if (isCashAccount(line.account)) cashPositionCents += debitMinusCredit;
    if (type === 'INCOME') totalIncomeCents -= debitMinusCredit;
    if (type === 'COGS') totalCogsCents += debitMinusCredit;
    if (type === 'EXPENSE') totalExpenseCents += debitMinusCredit;
  }

  for (const line of input.trendLines ?? input.lines) {
    const debitMinusCredit = amount(line.debit) - amount(line.credit);
    const { type } = line.account;
    const period = dateOnly(line.journalEntry?.entryDate)?.slice(0, 7);
    if (!period || period < firstPeriod || period > lastPeriod) continue;

    const bucket = monthly.get(period) || { revenueCents: 0, expenseCents: 0 };
    if (type === 'INCOME') bucket.revenueCents -= debitMinusCredit;
    if (type === 'EXPENSE') bucket.expenseCents += debitMinusCredit;
    monthly.set(period, bucket);
  }

  const monthlyTrends = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, bucket]) => ({
      period,
      month: MONTH_NAMES[Number(period.slice(5, 7)) - 1],
      year: Number(period.slice(0, 4)),
      revenue: Math.round(bucket.revenueCents / 100),
      expense: Math.round(bucket.expenseCents / 100),
      revenueCents: Math.round(bucket.revenueCents),
      expenseCents: Math.round(bucket.expenseCents),
    }));

  return {
    cashPositionCents: Math.round(cashPositionCents),
    moneyInCents: Math.round(moneyInCents),
    overdueInvoices,
    overdueCents: Math.round(overdueCents),
    moneyOutCents: Math.round(moneyOutCents),
    totalIncomeCents: Math.round(totalIncomeCents),
    totalCogsCents: Math.round(totalCogsCents),
    totalExpenseCents: Math.round(totalExpenseCents),
    netProfitCents: Math.round(totalIncomeCents - totalCogsCents - totalExpenseCents),
    monthlyTrends,
  };
}
