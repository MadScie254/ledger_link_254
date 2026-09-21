import { getSupabase } from './supabase';
import { calculatePayslip } from '../utils/kenyaPayroll';

export { calculatePayslip } from '../utils/kenyaPayroll';
export type { PayslipBreakdown } from '../utils/kenyaPayroll';

const PAYROLL_ACCOUNT_CODES = {
  salaryExpense: '6100',
  employerExpense: '6110',
  cash: '1000',
  payePayable: '2110',
  nssfPayable: '2120',
  shifPayable: '2130',
  ahlPayable: '2140',
} as const;

type PayrollAccountKey = keyof typeof PAYROLL_ACCOUNT_CODES;

interface PayrollRpcPayslip {
  employeeId: string;
  grossCents: number;
  taxablePayCents: number;
  payeCents: number;
  nssfCents: number;
  shifCents: number;
  ahlCents: number;
  employerNssfCents: number;
  employerAhlCents: number;
  netCents: number;
  rateVersion: string;
}

export interface RunPayrollRpcPayload {
  p_org_id: string;
  p_period: string;
  p_pay_date: string;
  p_rate_version: string;
  p_created_by: string;
  p_idempotency_key: string;
  p_salary_expense_account_id: string;
  p_employer_expense_account_id: string;
  p_cash_account_id: string;
  p_paye_payable_account_id: string;
  p_nssf_payable_account_id: string;
  p_shif_payable_account_id: string;
  p_ahl_payable_account_id: string;
  p_payslips: PayrollRpcPayslip[];
}

async function getPayrollAccountIds(orgId: string): Promise<Record<PayrollAccountKey, string>> {
  const supabase = getSupabase();
  const codes = Object.values(PAYROLL_ACCOUNT_CODES);
  const { data, error } = await supabase
    .from('accounts')
    .select('id, code, is_active')
    .eq('org_id', orgId)
    .in('code', codes);

  if (error) throw error;

  const idByCode = new Map(
    (data || [])
      .filter((account: any) => account.is_active !== false)
      .map((account: any) => [account.code, account.id] as const),
  );
  const missingCodes = codes.filter((code) => !idByCode.has(code));
  if (missingCodes.length > 0) {
    throw new Error(`Payroll accounts are missing or inactive: ${missingCodes.join(', ')}.`);
  }

  return Object.fromEntries(
    Object.entries(PAYROLL_ACCOUNT_CODES).map(([key, code]) => [key, idByCode.get(code)!]),
  ) as Record<PayrollAccountKey, string>;
}

export class PayrollService {
  static async getEmployees(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('org_id', orgId)
      .order('last_name');
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      department: row.department,
      jobTitle: row.job_title,
      hireDate: row.hire_date,
      baseSalaryCents: row.base_salary,
      currency: row.currency,
      payFrequency: row.pay_frequency,
      kraPin: row.kra_pin,
      nssfNumber: row.nssf_number,
      nhifNumber: row.nhif_number,
      bankName: row.bank_name,
      bankAccount: row.bank_account,
      status: row.status,
      createdAt: row.created_at
    }));
  }

  static async addEmployee(orgId: string, input: any) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('employees')
      .insert({
        org_id: orgId,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email || null,
        phone: input.phone || null,
        department: input.department || 'Operations',
        job_title: input.jobTitle || 'Staff',
        hire_date: input.hireDate || new Date().toISOString().substring(0, 10),
        base_salary: input.baseSalaryCents || 0,
        currency: 'KES',
        pay_frequency: 'Monthly',
        kra_pin: input.kraPin || null,
        nssf_number: input.nssfNumber || null,
        nhif_number: input.shifNumber || null,
        bank_name: input.bankName || null,
        bank_account: input.bankAccountNo || null,
        status: 'Active'
      })
      .select('id')
      .single();
      
    if (error) throw error;
    return data.id;
  }

  static async updateEmployee(orgId: string, id: string, input: any) {
    const supabase = getSupabase();
    const updateData: any = {};
    if (input.firstName !== undefined) updateData.first_name = input.firstName;
    if (input.lastName !== undefined) updateData.last_name = input.lastName;
    if (input.email !== undefined) updateData.email = input.email;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.department !== undefined) updateData.department = input.department;
    if (input.jobTitle !== undefined) updateData.job_title = input.jobTitle;
    if (input.hireDate !== undefined) updateData.hire_date = input.hireDate;
    if (input.baseSalaryCents !== undefined) updateData.base_salary = input.baseSalaryCents;
    if (input.kraPin !== undefined) updateData.kra_pin = input.kraPin;
    if (input.nssfNumber !== undefined) updateData.nssf_number = input.nssfNumber;
    if (input.shifNumber !== undefined) updateData.nhif_number = input.shifNumber;
    if (input.bankName !== undefined) updateData.bank_name = input.bankName;
    if (input.bankAccountNo !== undefined) updateData.bank_account = input.bankAccountNo;

    const { error } = await supabase
      .from('employees')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;
  }

  static async runPayroll(
    orgId: string,
    period: string,
    payDate: string,
    createdBy: string,
    idempotencyKey?: string,
  ): Promise<string> {
    const normalizedPeriod = period.trim();
    if (!normalizedPeriod) throw new Error('A payroll period is required.');
    if (normalizedPeriod.length > 100) throw new Error('Payroll period must be 100 characters or fewer.');
    if (!createdBy?.trim()) throw new Error('A payroll actor is required.');

    // Validates the pay date and selects the effective table before any remote
    // work. The same shared function calculates every employee below.
    const rateProbe = calculatePayslip(0, payDate);
    const supabase = getSupabase();
    const [employeeResult, accountIds] = await Promise.all([
      supabase
        .from('employees')
        .select('id, base_salary')
        .eq('org_id', orgId)
        .eq('status', 'Active'),
      getPayrollAccountIds(orgId),
    ]);

    if (employeeResult.error) throw employeeResult.error;
    const employees = employeeResult.data || [];
    if (employees.length === 0) throw new Error('No active employees to run payroll for.');

    const payslips: PayrollRpcPayslip[] = employees.map((employee: any) => {
      const breakdown = calculatePayslip(employee.base_salary ?? 0, payDate);
      return {
        employeeId: employee.id,
        grossCents: breakdown.grossCents,
        taxablePayCents: breakdown.taxablePayCents,
        payeCents: breakdown.payeCents,
        nssfCents: breakdown.nssfCents,
        shifCents: breakdown.shifCents,
        ahlCents: breakdown.ahlCents,
        employerNssfCents: breakdown.nssfCents,
        employerAhlCents: breakdown.ahlCents,
        netCents: breakdown.netCents,
        rateVersion: breakdown.rateVersion,
      };
    });

    const effectiveIdempotencyKey = idempotencyKey?.trim()
      || `payroll:${orgId}:${normalizedPeriod.toLowerCase()}:${payDate}`;
    const payload: RunPayrollRpcPayload = {
      p_org_id: orgId,
      p_period: normalizedPeriod,
      p_pay_date: payDate,
      p_rate_version: rateProbe.rateVersion,
      p_created_by: createdBy,
      p_idempotency_key: effectiveIdempotencyKey,
      p_salary_expense_account_id: accountIds.salaryExpense,
      p_employer_expense_account_id: accountIds.employerExpense,
      p_cash_account_id: accountIds.cash,
      p_paye_payable_account_id: accountIds.payePayable,
      p_nssf_payable_account_id: accountIds.nssfPayable,
      p_shif_payable_account_id: accountIds.shifPayable,
      p_ahl_payable_account_id: accountIds.ahlPayable,
      p_payslips: payslips,
    };

    const { data: runId, error } = await supabase.rpc('run_payroll_with_journal', payload);
    if (error) throw new Error(`Payroll could not be posted atomically: ${error.message}`);
    if (typeof runId !== 'string' || !runId) {
      throw new Error('Payroll posting did not return a payroll run ID.');
    }

    return runId;
  }

  static async getPayrollRuns(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      period: row.period,
      payDate: row.pay_date,
      totalGrossCents: row.total_gross_cents,
      totalNetCents: row.total_net_cents,
      totalPayeCents: row.total_paye_cents,
      totalNssfCents: row.total_nssf_cents,
      totalShifCents: row.total_shif_cents,
      totalAhlCents: row.total_ahl_cents,
      totalEmployerNssfCents: row.total_employer_nssf_cents,
      totalEmployerAhlCents: row.total_employer_ahl_cents,
      rateVersion: row.rate_version,
      createdAt: row.created_at
    }));
  }

  static async getPayslips(orgId: string, payrollRunId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('payslips')
      .select('*, payroll_runs!inner(org_id), employees(first_name, last_name)')
      .eq('payroll_run_id', payrollRunId)
      .eq('payroll_runs.org_id', orgId);

    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employees ? `${row.employees.first_name} ${row.employees.last_name}` : 'Unknown',
      grossCents: row.gross_cents,
      taxablePayCents: row.taxable_pay_cents,
      payeCents: row.paye_cents,
      nssfCents: row.nssf_cents,
      shifCents: row.shif_cents,
      ahlCents: row.ahl_cents,
      employerNssfCents: row.employer_nssf_cents,
      employerAhlCents: row.employer_ahl_cents,
      rateVersion: row.rate_version,
      netCents: row.net_cents
    }));
  }
}
