import assert from 'node:assert/strict';
import test from 'node:test';
import { PayrollService } from '../../src/server/payroll';
import { calculatePayslip, findRateTable } from '../../src/utils/kenyaPayroll';
import { Hono } from 'hono';
import { requirePayrollAccess } from '../../worker/auth';
import { registerPayrollRoutes } from '../../worker/routes/payroll';
import { ORG, OWNER, refused, uuid } from './helpers';

test('payroll service loads the effective database version for the calculator', async () => {
  for (const [date, grossCents] of [
    ['2025-01-31', 4_800_000],
    ['2025-06-30', 8_500_000],
    ['2026-09-30', 100_000_000],
  ] as const) {
    const rates = await PayrollService.getStatutoryRateTable(date);
    const { adjustmentRules, ...baseRates } = rates;
    assert.deepEqual(baseRates, findRateTable(date));
    assert.equal(adjustmentRules?.length, 5);
    assert.deepEqual(calculatePayslip(grossCents, date, rates), calculatePayslip(grossCents, date));
  }
});

test('payroll rate API refuses members and returns rates for an authorized date', async () => {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('orgRole', c.req.header('x-test-role')); await next(); });
  api.use('/payroll/*', requirePayrollAccess);
  registerPayrollRoutes(api);
  const denied = await api.request('/payroll/rates?date=2026-09-30', { headers: { 'x-test-role': 'member' } });
  assert.equal(denied.status, 403);
  const allowed = await api.request('/payroll/rates?date=2026-09-30', { headers: { 'x-test-role': 'owner' } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).rates.version, 'KE-2026-02');
});

test('payroll uses pay-date rates and keeps the evidence snapshot after evidence changes', async () => {
  const employeeId = await PayrollService.addEmployee(ORG, { firstName: 'Rate', lastName: 'Test', baseSalaryCents: 10_000_000 });
  const evidenceId = await PayrollService.addEmployeeAdjustment(ORG, employeeId, {
    type: 'MORTGAGE_INTEREST', amountCents: 100_000, validFrom: '2026-01-01', validTo: null,
    referenceNumber: 'MORT-1', attachmentId: null,
  }, OWNER);
  const runId = await PayrollService.runPayroll(ORG, 'January 2026', '2026-02-01', OWNER, uuid());
  const slips = await PayrollService.getPayslips(ORG, runId);
  assert.equal(slips[0].rateVersion, 'KE-2026-02');
  assert.equal(slips[0].appliedAdjustments[0].id, evidenceId);
  assert.equal(slips[0].appliedAdjustments[0].appliedCents, 100_000);
  await PayrollService.endEmployeeAdjustment(ORG, employeeId, evidenceId, '2026-01-31');
  assert.deepEqual((await PayrollService.getPayslips(ORG, runId))[0].appliedAdjustments, slips[0].appliedAdjustments);
  await refused(PayrollService.addEmployeeAdjustment('00000000-0000-0000-0000-0000000000bb', employeeId, {
    type: 'MORTGAGE_INTEREST', amountCents: 100, validFrom: '2026-01-01', validTo: null, referenceNumber: 'X', attachmentId: null,
  }, OWNER), /foreign key|organization/i);
});
