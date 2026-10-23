import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { PayrollService } from '../../src/server/payroll';
import { getSupabase } from '../../src/server/supabase';
import { requirePayrollAccess } from '../../worker/auth';
import { registerPayrollRoutes } from '../../worker/routes/payroll';
import { BANK, ORG, OWNER, refused, uuid } from './helpers';

test('new runs accrue net salaries and salary payment has its own bank entry and reversal', async () => {
  await PayrollService.addEmployee(ORG, { firstName: 'Salary', lastName: 'Test', baseSalaryCents: 10_000_000 });
  const runId = await PayrollService.runPayroll(ORG, 'September 2026', '2026-09-30', OWNER, uuid());
  const [run] = await PayrollService.getPayrollRuns(ORG);
  assert.equal(run.id, runId);
  assert.equal(run.netPayAccountId, '00000000-0000-0000-0000-00000000a216');
  const db = getSupabase();
  const { data: accrual } = await db.from('journal_lines').select('account_id, debit, credit')
    .eq('org_id', ORG).eq('journal_entry_id', (await db.from('payroll_runs').select('journal_entry_id').eq('org_id', ORG).eq('id', runId).single()).data!.journal_entry_id);
  assert.ok(accrual?.some((line) => line.account_id === run.netPayAccountId && Number(line.credit) === run.totalNetCents));
  assert.ok(!accrual?.some((line) => line.account_id === BANK));
  await refused(PayrollService.paySalaries(ORG, runId, BANK, '2026-09-29', OWNER, uuid()), /predate/i);
  const requestKey = uuid();
  const payment = await PayrollService.paySalaries(ORG, runId, BANK, '2026-10-01', OWNER, requestKey);
  assert.deepEqual(await PayrollService.paySalaries(ORG, runId, BANK, '2026-10-01', OWNER, requestKey), payment);
  await refused(PayrollService.paySalaries(ORG, runId, BANK, '2026-10-01', OWNER, uuid()), /already been paid/i);
  const { data: paymentLines } = await db.from('journal_lines').select('account_id, debit, credit')
    .eq('org_id', ORG).eq('journal_entry_id', payment.journalEntryId);
  assert.ok(paymentLines?.some((line) => line.account_id === BANK && Number(line.credit) === run.totalNetCents));
  assert.ok(paymentLines?.some((line) => line.account_id === run.netPayAccountId && Number(line.debit) === run.totalNetCents));
  await refused(PayrollService.reversePayrollRun(ORG, runId, '2026-10-02', 'Wrong salary', OWNER), /reverse that salary payment first/i);
  assert.equal((await PayrollService.getSalaryPayments(ORG, runId))[0].reversedAt, null);
  const reversal = await PayrollService.reverseSalaryPayment(ORG, runId, payment.id, '2026-10-03', 'Wrong bank payment', OWNER);
  assert.equal((await PayrollService.getSalaryPayments(ORG, runId))[0].reversedAt !== null, true);
  assert.deepEqual(await PayrollService.reverseSalaryPayment(ORG, runId, payment.id, '2026-10-03', 'Retry', OWNER), reversal);
  const runReversal = await PayrollService.reversePayrollRun(ORG, runId, '2026-10-03', 'Wrong salary', OWNER);
  assert.ok(runReversal.reversalJournalEntryId);
  await refused(PayrollService.paySalaries('00000000-0000-0000-0000-0000000000bb', runId, BANK, '2026-10-04', OWNER, uuid()), /organization|access|membership|not found/i);
});

test('salary payment routes require payroll access', async () => {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('userId', OWNER); c.set('orgRole', c.req.header('x-test-role')); await next(); });
  api.use('/payroll/*', requirePayrollAccess);
  registerPayrollRoutes(api);
  const runId = uuid();
  const denied = await api.request(`/payroll/runs/${runId}/salary-payments`, { headers: { 'x-test-role': 'member' } });
  assert.equal(denied.status, 403);
  const allowed = await api.request(`/payroll/runs/${runId}/salary-payments`, { headers: { 'x-test-role': 'owner' } });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).payments, []);
});
