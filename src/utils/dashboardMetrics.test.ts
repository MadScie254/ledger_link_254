import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateDashboardMetrics, type DashboardDocument } from './dashboardMetrics.ts';
import type { ReportAccount, ReportLedgerLine } from './reportCalculations.ts';

const account = (
  code: string,
  name: string,
  type: ReportAccount['type'],
  subtype: string | null = null,
): ReportAccount => ({ code, name, type, subtype });

const bank = account('1000', 'Bank', 'ASSET');
const mpesa = account('1050', 'M-Pesa clearing', 'ASSET', 'MOBILE_MONEY');
const receivables = account('1100', 'Accounts receivable', 'ASSET');
const inventory = account('1200', 'Inventory', 'ASSET');
const sales = account('4000', 'Sales', 'INCOME');
const cogs = account('5000', 'Cost of goods sold', 'COGS');
const rent = account('6000', 'Rent', 'EXPENSE');
const equity = account('3000', 'Owner capital', 'EQUITY');

const line = (
  entryDate: string,
  ledgerAccount: ReportAccount,
  debit: number,
  credit: number,
): ReportLedgerLine => ({
  debit,
  credit,
  account: ledgerAccount,
  journalEntry: { id: `je-${entryDate}`, entryDate },
});

const invoice = (status: string, amountDueCents: number, dueDate: string | null = null): DashboardDocument =>
  ({ status, amountDueCents, dueDate });

const empty = { invoices: [], bills: [], lines: [], today: '2026-10-02' };

test('money in counts only what is still owed on issued invoices', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    invoices: [
      invoice('SENT', 100_000, '2026-10-30'),
      // Part-paid: 120,000 total, 30,000 still due.
      invoice('PARTIALLY_PAID', 30_000, '2026-10-30'),
      invoice('VOID', 0),
      invoice('PAID', 0),
      // A draft has not been sent, so nothing is owed on it yet.
      invoice('DRAFT', 50_000, '2026-01-01'),
    ],
  });

  assert.equal(result.moneyInCents, 130_000);
  assert.equal(result.overdueInvoices, 0);
});

test('void invoices are excluded even when their amount due was never cleared', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    invoices: [invoice('VOID', 75_000, '2026-01-01'), invoice('SENT', 10_000, '2026-01-01')],
  });

  assert.equal(result.moneyInCents, 10_000);
  assert.equal(result.overdueInvoices, 1);
  assert.equal(result.overdueCents, 10_000);
});

test('an invoice is overdue the day after its due date, not on it', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    invoices: [
      invoice('SENT', 10_000, '2026-10-02'),
      invoice('SENT', 20_000, '2026-10-01'),
      invoice('PARTIALLY_PAID', 5_000, '2026-09-15'),
      invoice('SENT', 7_000, null),
    ],
  });

  assert.equal(result.overdueInvoices, 2);
  assert.equal(result.overdueCents, 25_000);
});

test('money out counts amount due on open and part-paid bills only', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    bills: [
      invoice('OPEN', 40_000),
      invoice('PARTIALLY_PAID', 15_000),
      invoice('PAID', 0),
      invoice('VOID', 99_000),
      invoice('DRAFT', 12_000),
    ],
  });

  assert.equal(result.moneyOutCents, 55_000);
});

test('cash position is bank, cash and M-Pesa only, not every asset', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    lines: [
      line('2026-09-01', bank, 500_000, 0),
      line('2026-09-01', equity, 0, 500_000),
      line('2026-09-05', mpesa, 80_000, 0),
      line('2026-09-05', sales, 0, 80_000),
      line('2026-09-10', receivables, 200_000, 0),
      line('2026-09-10', sales, 0, 200_000),
      line('2026-09-12', inventory, 60_000, 0),
      line('2026-09-12', bank, 0, 60_000),
    ],
  });

  assert.equal(result.cashPositionCents, 500_000 + 80_000 - 60_000);
});

test('profit totals cover all posted periods', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    lines: [
      line('2024-03-01', receivables, 100_000, 0),
      line('2024-03-01', sales, 0, 100_000),
      line('2026-09-01', cogs, 30_000, 0),
      line('2026-09-01', inventory, 0, 30_000),
      line('2026-09-02', rent, 25_000, 0),
      line('2026-09-02', bank, 0, 25_000),
    ],
  });

  assert.equal(result.totalIncomeCents, 100_000);
  assert.equal(result.totalCogsCents, 30_000);
  assert.equal(result.totalExpenseCents, 25_000);
  assert.equal(result.netProfitCents, 45_000);
});

test('trends cover the twelve months ending this month, in calendar order, without merging years', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    lines: [
      // October 2025 is thirteen months back from October 2026, so it is left
      // out, and in particular is not merged into October 2026.
      line('2025-10-15', sales, 0, 100_000),
      line('2025-10-15', receivables, 100_000, 0),
      line('2026-10-01', sales, 0, 250_000),
      line('2026-10-01', receivables, 250_000, 0),
      // November 2025 is the first month of the window.
      line('2025-11-30', rent, 70_000, 0),
      line('2025-11-30', bank, 0, 70_000),
      line('2026-01-20', rent, 40_000, 0),
      line('2026-01-20', bank, 0, 40_000),
    ],
  });

  assert.deepEqual(
    result.monthlyTrends.map(({ period, month, year, revenueCents, expenseCents }) => ({ period, month, year, revenueCents, expenseCents })),
    [
      { period: '2025-11', month: 'Nov', year: 2025, revenueCents: 0, expenseCents: 70_000 },
      { period: '2026-01', month: 'Jan', year: 2026, revenueCents: 0, expenseCents: 40_000 },
      { period: '2026-10', month: 'Oct', year: 2026, revenueCents: 250_000, expenseCents: 0 },
    ],
  );
  // All-time totals still include the month outside the trend window.
  assert.equal(result.totalIncomeCents, 350_000);
});

test('the trend window crosses a year boundary correctly in January', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    today: '2027-01-05',
    lines: [
      line('2026-01-31', rent, 10_000, 0),
      line('2026-01-31', bank, 0, 10_000),
      line('2026-02-01', rent, 20_000, 0),
      line('2026-02-01', bank, 0, 20_000),
    ],
  });

  assert.deepEqual(result.monthlyTrends.map((d) => d.period), ['2026-02']);
});

test('trend units are rounded once per month, not once per line', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    lines: [
      line('2026-10-01', sales, 0, 149),
      line('2026-10-01', sales, 0, 149),
      line('2026-10-01', sales, 0, 149),
      line('2026-10-01', receivables, 447, 0),
    ],
  });

  // 447 cents is 4.47, which rounds to 4. Rounding each 1.49 line first would give 3.
  assert.equal(result.monthlyTrends[0].revenue, 4);
  assert.equal(result.monthlyTrends[0].revenueCents, 447);
});

test('amounts arriving as numeric strings are summed as numbers', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    invoices: [{ status: 'SENT', amountDueCents: '1500', dueDate: null }],
    lines: [
      { debit: '2500', credit: '0', account: bank, journalEntry: { id: 'a', entryDate: '2026-10-01' } },
      { debit: '0', credit: '2500', account: sales, journalEntry: { id: 'a', entryDate: '2026-10-01' } },
    ],
  });

  assert.equal(result.moneyInCents, 1500);
  assert.equal(result.cashPositionCents, 2500);
  assert.equal(result.totalIncomeCents, 2500);
});

test('a malformed date is refused rather than silently misdated', () => {
  assert.throws(() => aggregateDashboardMetrics({ ...empty, today: 'October' }), /YYYY-MM-DD/);
});

test('trend lines can come separately from the all-time lines', () => {
  const result = aggregateDashboardMetrics({
    ...empty,
    // All-time totals per account, undated.
    lines: [
      { debit: 0, credit: 900_000, account: sales },
      { debit: 900_000, credit: 0, account: bank },
    ],
    // Monthly totals per account, dated to the first of the month.
    trendLines: [
      { debit: 0, credit: 400_000, account: sales, journalEntry: { id: '2026-09', entryDate: '2026-09-01' } },
      { debit: 0, credit: 500_000, account: sales, journalEntry: { id: '2026-10', entryDate: '2026-10-01' } },
    ],
  });

  assert.equal(result.totalIncomeCents, 900_000);
  assert.equal(result.cashPositionCents, 900_000);
  assert.deepEqual(result.monthlyTrends.map((d) => [d.period, d.revenueCents]), [['2026-09', 400_000], ['2026-10', 500_000]]);
});
