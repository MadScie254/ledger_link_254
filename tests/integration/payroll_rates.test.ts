import assert from 'node:assert/strict';
import test from 'node:test';
import { PayrollService } from '../../src/server/payroll';
import { calculatePayslip, findRateTable } from '../../src/utils/kenyaPayroll';

test('payroll service loads the effective database version for the calculator', async () => {
  for (const [date, grossCents] of [
    ['2025-01-31', 4_800_000],
    ['2025-06-30', 8_500_000],
    ['2026-09-30', 100_000_000],
  ] as const) {
    const rates = await PayrollService.getStatutoryRateTable(date);
    assert.deepEqual(rates, findRateTable(date));
    assert.deepEqual(calculatePayslip(grossCents, date, rates), calculatePayslip(grossCents, date));
  }
});
