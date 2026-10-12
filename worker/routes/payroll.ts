import { PayrollService } from '../../src/server/payroll';
import { bodyOf, respondError } from '../http';
import { employeeSchema, employeeUpdateSchema, employeeAdjustmentSchema, endEmployeeAdjustmentSchema, isoDate, payrollRunSchema, salaryPaymentSchema, reversalSchema, uuid } from '../schemas';
import type { Api } from './types';
import type { EmployeeAdjustment } from '../../src/utils/employeeAdjustments';

/** Employee and payroll records: personal data, open to owner, admin and accountant only (see worker/index.ts). */
export function registerPayrollRoutes(api: Api) {
  api.get('/payroll/runs/:id/salary-payments', async (c) => {
    try { return c.json({ payments: await PayrollService.getSalaryPayments(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/payroll/runs/:id/salary-payments', async (c) => {
    try {
      const input = salaryPaymentSchema.parse(await bodyOf(c));
      return c.json(await PayrollService.paySalaries(c.get('orgId'), uuid.parse(c.req.param('id')), input.bankAccountId, input.paymentDate, c.get('userId'), input.idempotencyKey));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/payroll/runs/:id/salary-payments/:paymentId/reverse', async (c) => {
    try {
      const input = reversalSchema.parse(await bodyOf(c));
      return c.json(await PayrollService.reverseSalaryPayment(c.get('orgId'), uuid.parse(c.req.param('id')), uuid.parse(c.req.param('paymentId')), input.reversalDate, input.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
  api.get('/payroll/adjustments', async (c) => {
    try { return c.json({ adjustments: await PayrollService.getEmployeeAdjustments(c.get('orgId')) }); }
    catch (err) { return respondError(c, err); }
  });
  api.get('/employees/:id/adjustments', async (c) => {
    try { return c.json({ adjustments: await PayrollService.getEmployeeAdjustments(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/employees/:id/adjustments', async (c) => {
    try {
      const input = employeeAdjustmentSchema.parse(await bodyOf(c));
      return c.json({ id: await PayrollService.addEmployeeAdjustment(c.get('orgId'), uuid.parse(c.req.param('id')), input as Omit<EmployeeAdjustment, 'id'>, c.get('userId')) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.patch('/employees/:id/adjustments/:adjustmentId', async (c) => {
    try {
      const input = endEmployeeAdjustmentSchema.parse(await bodyOf(c));
      await PayrollService.endEmployeeAdjustment(c.get('orgId'), uuid.parse(c.req.param('id')), uuid.parse(c.req.param('adjustmentId')), input.validTo);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/payroll/rates', async (c) => {
    try {
      const date = isoDate.parse(c.req.query('date'));
      return c.json({ rates: await PayrollService.getStatutoryRateTable(date) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/employees', async (c) => {
    try {
      return c.json({ employees: await PayrollService.getEmployees(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/employees', async (c) => {
    try {
      const body = employeeSchema.parse(await bodyOf(c));
      return c.json({ id: await PayrollService.addEmployee(c.get('orgId'), body) });
    } catch (err) { return respondError(c, err); }
  });

  // Every change, bank and M-Pesa details included, is recorded in the audit
  // log with who made it.
  api.patch('/employees/:id', async (c) => {
    try {
      const body = employeeUpdateSchema.parse(await bodyOf(c));
      await PayrollService.updateEmployee(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/payroll/runs', async (c) => {
    try {
      return c.json({ runs: await PayrollService.getPayrollRuns(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/payroll/runs/:id/payslips', async (c) => {
    try {
      return c.json({ payslips: await PayrollService.getPayslips(c.get('orgId'), uuid.parse(c.req.param('id'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/payroll/runs', async (c) => {
    try {
      const body = payrollRunSchema.parse(await bodyOf(c));
      return c.json({ id: await PayrollService.runPayroll(c.get('orgId'), body.period, body.payDate, c.get('userId'), body.idempotencyKey) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/payroll/runs/:id/reverse', async (c) => {
    try {
      const body = reversalSchema.parse(await bodyOf(c));
      return c.json(await PayrollService.reversePayrollRun(c.get('orgId'), uuid.parse(c.req.param('id')), body.reversalDate, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
}
