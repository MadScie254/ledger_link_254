import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetPeriodRange, fiscalYearStartMonth } from './budgetPeriods.ts';

test('a monthly budget covers the calendar month, including a short February', () => {
  assert.deepEqual(budgetPeriodRange('MONTHLY', '2026-10-02'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(budgetPeriodRange('MONTHLY', '2028-02-15'), { from: '2028-02-01', to: '2028-02-29' });
});

test('quarters and years follow a January financial year by default', () => {
  assert.deepEqual(budgetPeriodRange('QUARTERLY', '2026-10-02'), { from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(budgetPeriodRange('QUARTERLY', '2026-05-31', null), { from: '2026-04-01', to: '2026-06-30' });
  assert.deepEqual(budgetPeriodRange('YEARLY', '2026-10-02'), { from: '2026-01-01', to: '2026-12-31' });
});

test('a July financial year spans two calendar years', () => {
  assert.deepEqual(budgetPeriodRange('YEARLY', '2026-10-02', 'July'), { from: '2026-07-01', to: '2027-06-30' });
  assert.deepEqual(budgetPeriodRange('YEARLY', '2026-03-10', 'July'), { from: '2025-07-01', to: '2026-06-30' });
  // Q3 of a July year is January to March.
  assert.deepEqual(budgetPeriodRange('QUARTERLY', '2027-02-14', 'July'), { from: '2027-01-01', to: '2027-03-31' });
});

test('unknown financial-year months fall back to January', () => {
  assert.equal(fiscalYearStartMonth('Julember'), 0);
  assert.equal(fiscalYearStartMonth(' april '), 3);
});

test('a malformed date is refused', () => {
  assert.throws(() => budgetPeriodRange('MONTHLY', '02/10/2026'), /YYYY-MM-DD/);
});
