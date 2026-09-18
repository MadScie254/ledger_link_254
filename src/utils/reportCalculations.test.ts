import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateBalanceSheet,
  aggregateCashFlow,
  aggregateProfitAndLoss,
  aggregateTaxRows,
  isNonCurrentAsset,
  normalizeAsOfDate,
  resolveReportDateRange,
  type ReportAccount,
  type ReportLedgerLine,
} from './reportCalculations.ts';

const account = (
  code: string,
  name: string,
  type: ReportAccount['type'],
  subtype: string | null = null,
): ReportAccount => ({ code, name, type, subtype });

const line = (
  entryId: string,
  ledgerAccount: ReportAccount,
  debit: number,
  credit: number,
): ReportLedgerLine => ({
  debit,
  credit,
  account: ledgerAccount,
  journalEntry: { id: entryId },
});

test('resolves every period format used by the report screens', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  assert.deepEqual(resolveReportDateRange('This Month', now), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(resolveReportDateRange('This Quarter', now), { start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(resolveReportDateRange('This Year-to-date', now), { start: '2026-01-01', end: '2026-09-17' });
  assert.deepEqual(resolveReportDateRange('Last Financial Year', now), { start: '2025-01-01', end: '2025-12-31' });
  assert.deepEqual(resolveReportDateRange('2026-02', now), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(resolveReportDateRange('August 2026', now), { start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(resolveReportDateRange('Q2 2026', now), { start: '2026-04-01', end: '2026-06-30' });
  assert.throws(() => resolveReportDateRange('All time', now), /Unsupported report period/);
});

test('validates and normalizes balance-sheet dates', () => {
  assert.equal(normalizeAsOfDate('2026-09-17'), '2026-09-17');
  assert.equal(normalizeAsOfDate('2026-09-17T12:00:00.000Z'), '2026-09-17');
  assert.throws(() => normalizeAsOfDate('2026-02-30'), /invalid/);
  assert.throws(() => normalizeAsOfDate('17 September 2026'), /YYYY-MM-DD/);
});

test('aggregates profit and loss in each account normal-balance direction', () => {
  const revenue = account('4000', 'Sales', 'INCOME');
  const cogs = account('5000', 'Cost of sales', 'COGS');
  const expense = account('6000', 'Operating expenses', 'EXPENSE');

  assert.deepEqual(aggregateProfitAndLoss([
    line('sale', revenue, 0, 10_000),
    line('refund', revenue, 1_000, 0),
    line('cost', cogs, 3_000, 0),
    line('expense', expense, 2_000, 0),
  ]), {
    income: [{ name: 'Sales', amountCents: 9_000 }],
    costOfSales: [{ name: 'Cost of sales', amountCents: 3_000 }],
    expenses: [{ name: 'Operating expenses', amountCents: 2_000 }],
  });
});

test('classifies assets by subtype then account code and includes unclosed earnings', () => {
  const cash = account('1000', 'Cash', 'ASSET');
  const inventory = account('1200', 'Inventory', 'ASSET');
  const vehicle = account('1600', 'Delivery van', 'ASSET');
  const fixedBySubtype = account('1250', 'Leasehold fit-out', 'ASSET', 'Fixed Asset');
  const payable = account('2000', 'Accounts payable', 'LIABILITY');
  const capital = account('3000', 'Share capital', 'EQUITY');
  const revenue = account('4000', 'Sales', 'INCOME');
  const expense = account('6000', 'Expenses', 'EXPENSE');

  assert.equal(isNonCurrentAsset(vehicle), true);
  assert.equal(isNonCurrentAsset(fixedBySubtype), true);
  assert.equal(isNonCurrentAsset(inventory), false);

  const result = aggregateBalanceSheet([
    line('1', cash, 10_000, 0),
    line('2', inventory, 2_000, 0),
    line('3', vehicle, 3_000, 0),
    line('4', fixedBySubtype, 1_000, 0),
    line('5', payable, 0, 4_000),
    line('6', capital, 0, 6_000),
    line('7', revenue, 0, 8_000),
    line('8', expense, 2_000, 0),
  ]);

  assert.deepEqual(result.currentAssets, [
    { name: 'Cash', amountCents: 10_000 },
    { name: 'Inventory', amountCents: 2_000 },
  ]);
  assert.deepEqual(result.nonCurrentAssets, [
    { name: 'Leasehold fit-out', amountCents: 1_000 },
    { name: 'Delivery van', amountCents: 3_000 },
  ]);
  assert.deepEqual(result.currentLiabilities, [{ name: 'Accounts payable', amountCents: 4_000 }]);
  assert.deepEqual(result.equity, [
    { name: 'Share capital', amountCents: 6_000 },
    { name: 'Current-period earnings (unclosed)', amountCents: 6_000 },
  ]);

  const assets = [...result.currentAssets, ...result.nonCurrentAssets].reduce((sum, row) => sum + row.amountCents, 0);
  const liabilitiesAndEquity = [...result.currentLiabilities, ...result.equity].reduce((sum, row) => sum + row.amountCents, 0);
  assert.equal(assets, liabilitiesAndEquity);
});

test('builds a reconciled indirect cash-flow statement from journal entries', () => {
  const cash = account('1000', 'Cash', 'ASSET', 'Bank');
  const receivable = account('1100', 'Accounts receivable', 'ASSET');
  const vehicle = account('1600', 'Delivery van', 'ASSET', 'Fixed Asset');
  const payable = account('2000', 'Accounts payable', 'LIABILITY');
  const capital = account('3000', 'Share capital', 'EQUITY');
  const revenue = account('4000', 'Sales', 'INCOME');
  const expense = account('6000', 'Expenses', 'EXPENSE');

  const opening = [line('opening', cash, 5_000, 0)];
  const period = [
    line('invoice', receivable, 1_500, 0),
    line('invoice', revenue, 0, 1_500),
    line('receipt', cash, 1_000, 0),
    line('receipt', receivable, 0, 1_000),
    line('accrual', expense, 500, 0),
    line('accrual', payable, 0, 500),
    line('supplier-payment', payable, 200, 0),
    line('supplier-payment', cash, 0, 200),
    line('vehicle-purchase', vehicle, 400, 0),
    line('vehicle-purchase', cash, 0, 400),
    line('capital-injection', cash, 700, 0),
    line('capital-injection', capital, 0, 700),
  ];

  const result = aggregateCashFlow(period, opening);
  assert.deepEqual(result, {
    operating: [
      { name: 'Net income', amountCents: 1_000 },
      { name: 'Change in Accounts receivable', amountCents: -500 },
      { name: 'Change in Accounts payable', amountCents: 300 },
    ],
    investing: [{ name: 'Delivery van', amountCents: -400 }],
    financing: [{ name: 'Share capital', amountCents: 700 }],
    beginningCashCents: 5_000,
  });

  const change = [...result.operating, ...result.investing, ...result.financing]
    .reduce((sum, row) => sum + row.amountCents, 0);
  assert.equal(change, 1_100);
  assert.equal(result.beginningCashCents + change, 6_100);
});

test('cash flow removes non-cash profit items and classifies only cash-bearing asset activity as investing', () => {
  const cash = account('1000', 'Cash', 'ASSET', 'Bank');
  const equipment = account('1600', 'Equipment', 'ASSET', 'Fixed Asset');
  const disposalGain = account('4200', 'Gain on disposal', 'INCOME');
  const depreciation = account('6300', 'Depreciation', 'EXPENSE', 'Non-cash expense');

  const result = aggregateCashFlow([
    line('sale', cash, 100, 0),
    line('sale', equipment, 0, 80),
    line('sale', disposalGain, 0, 20),
    line('depreciation', depreciation, 30, 0),
    line('depreciation', equipment, 0, 30),
  ], []);

  assert.deepEqual(result.operating, [
    { name: 'Net income', amountCents: -10 },
    { name: 'Non-cash and other operating adjustments', amountCents: 10 },
  ]);
  assert.deepEqual(result.investing, [{ name: 'Equipment', amountCents: 100 }]);
  assert.deepEqual(result.financing, []);
});

test('aggregates tax rows without losing numeric values returned as strings', () => {
  assert.deepEqual(aggregateTaxRows(
    [
      { subtotal_cents: '10000', tax_cents: '1600' },
      { subtotal_cents: 5_000, tax_cents: 800 },
    ],
    [{ subtotal_cents: '4000', tax_cents: '640' }],
  ), {
    standardRatedSalesCents: 15_000,
    outputVatCents: 2_400,
    claimablePurchasesCents: 4_000,
    inputVatCents: 640,
  });
});
