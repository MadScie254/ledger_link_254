import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ledgerSurplusCents, monthRange, nairobiToday, reconcileFunds, sundayOnOrBefore, treasurerReport,
  type FundBalance, type TreasurerLine,
} from './churchReports.ts';

const funds: FundBalance[] = [
  { fundId: 'g', code: 'GENERAL', name: 'General fund', restricted: false, isActive: true, openingCents: 50_000, incomeCents: 1_510_000, expenseCents: 13_300, closingCents: 1_546_700 },
  { fundId: 'b', code: 'BUILDING', name: 'Building fund', restricted: true, isActive: true, openingCents: 0, incomeCents: 200_000, expenseCents: 30_000, closingCents: 170_000 },
  { fundId: 'm', code: 'MISSIONS', name: 'Missions fund', restricted: true, isActive: true, openingCents: 0, incomeCents: 0, expenseCents: 0, closingCents: 0 },
];
const lines: TreasurerLine[] = [
  { kind: 'INCOME', fundId: 'g', accountId: 'a4020', accountCode: '4020', accountName: 'Offerings', amountCents: 1_360_000 },
  { kind: 'INCOME', fundId: 'g', accountId: 'a4010', accountCode: '4010', accountName: 'Tithes', amountCents: 150_000 },
  { kind: 'INCOME', fundId: 'b', accountId: 'a4040', accountCode: '4040', accountName: 'Building and project giving', amountCents: 200_000 },
  { kind: 'EXPENSE', fundId: 'g', accountId: 'a6400', accountCode: '6400', accountName: 'Bank and M-Pesa charges', amountCents: 13_300 },
  { kind: 'EXPENSE', fundId: 'b', accountId: 'a6310', accountCode: '6310', accountName: 'Ministry and department costs', amountCents: 30_000 },
  { kind: 'EXPENSE', fundId: 'm', accountId: 'a6330', accountCode: '6330', accountName: 'Missions support', amountCents: 0 },
  { kind: 'MONEY', fundId: null, accountId: 'a1050', accountCode: '1050', accountName: 'M-Pesa', amountCents: 340_000 },
  { kind: 'MONEY', fundId: null, accountId: 'a1000', accountCode: '1000', accountName: 'Bank', amountCents: 1_350_000 },
  { kind: 'MONEY', fundId: null, accountId: 'a1040', accountCode: '1040', accountName: 'Cash on hand', amountCents: 0 },
];

test('a month runs from its first to its last day', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(monthRange('2026-13'), null);
  assert.equal(monthRange('Oct 2026'), null);
});

test('this Sunday is the Sunday on or before today, in Nairobi', () => {
  assert.equal(sundayOnOrBefore('2026-10-04'), '2026-10-04', 'a Sunday is its own Sunday');
  assert.equal(sundayOnOrBefore('2026-10-08'), '2026-10-04');
  assert.equal(sundayOnOrBefore('2026-11-01'), '2026-11-01');
  assert.equal(sundayOnOrBefore('2026-03-03'), '2026-03-01');
  // 22:30 UTC on 3 October is already 4 October in Nairobi.
  assert.equal(nairobiToday(new Date('2026-10-03T22:30:00Z')), '2026-10-04');
});

test('the treasurer report groups income and expenses by fund, in fund order', () => {
  const report = treasurerReport({ from: '2026-10-01', to: '2026-10-31' }, lines, funds,
    { unmatchedCount: 2, unmatchedCents: 30_000, cashNotBankedCents: 0 });
  assert.equal(report.openingCents, 50_000);
  assert.equal(report.incomeCents, 1_710_000);
  assert.equal(report.expenseCents, 43_300);
  assert.equal(report.closingCents, 50_000 + 1_710_000 - 43_300);
  assert.deepEqual(report.incomeByFund.map((s) => [s.code, s.totalCents, s.accounts.map((a) => a.code)]), [
    ['GENERAL', 1_510_000, ['4010', '4020']],
    ['BUILDING', 200_000, ['4040']],
  ]);
  assert.equal(report.incomeByFund[1].restricted, true);
  assert.deepEqual(report.expensesByFund.map((s) => s.code), ['GENERAL', 'BUILDING'], 'nil lines are left out');
  assert.deepEqual(report.money.map((m) => m.code), ['1000', '1040', '1050']);
  assert.equal(report.moneyTotalCents, 1_690_000);
  assert.equal(report.unmatchedCount, 2);
});

test('funds reconcile to the ledger surplus, and a gap is shown in cents', () => {
  const surplus = ledgerSurplusCents([
    { type: 'INCOME', debitCents: 0, creditCents: 1_760_000 },
    { type: 'EXPENSE', debitCents: 43_300, creditCents: 0 },
    { type: 'ASSET', debitCents: 1_690_000, creditCents: 0 },
  ]);
  assert.equal(surplus, 1_716_700);
  const ok = reconcileFunds(funds, { surplusToDateCents: surplus, periodSurplusCents: 1_666_700 });
  assert.equal(ok.fundsClosingCents, 1_716_700);
  assert.equal(ok.reconciles, true);
  const off = reconcileFunds(funds, { surplusToDateCents: surplus + 500, periodSurplusCents: 1_666_700 });
  assert.equal(off.reconciles, false);
  assert.equal(off.closingDifferenceCents, -500);
});
