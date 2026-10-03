import { getSupabase } from './supabase';
import { UserError } from './errors';
import { fetchAllRows } from './pagination';
import { calculatePayslip, isIsoCalendarDate, monthlyGrossCents, parsePayPeriod } from '../utils/kenyaPayroll';

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

/** Trimmed text, null when blank; refuses non-text values instead of storing them. */
function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > 200) throw new Error(`${label} must be 200 characters or fewer.`);
  return trimmed || null;
}

function optionalDate(value: unknown, label: string): string | null {
  const text = optionalText(value, label);
  if (text === null) return null;
  const date = text.slice(0, 10);
  if (!isIsoCalendarDate(date)) throw new Error(`${label} must be a date in YYYY-MM-DD form.`);
  return date;
}

/** A non-negative whole number of cents; blank is zero. */
function centsOrZero(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`${label} must be a whole, non-negative amount.`);
  return cents;
}

export class PayrollService {
  static async getEmployees(orgId: string) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => supabase
      .from('employees')
      .select('*')
      .eq('org_id', orgId)
      .order('last_name')
      .order('id')
      .range(from, to));

    return data.map(row => ({
      id: row.id,
      orgId: row.org_id,
      firstName: row.first_name,
      middleName: row.middle_name ?? null,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      department: row.department,
      jobTitle: row.job_title,
      hireDate: row.hire_date,
      baseSalaryCents: row.base_salary,
      housingAllowanceCents: Number(row.housing_allowance_cents) || 0,
      transportAllowanceCents: Number(row.transport_allowance_cents) || 0,
      grossPayCents: monthlyGrossCents({
        baseSalaryCents: row.base_salary,
        housingAllowanceCents: row.housing_allowance_cents,
        transportAllowanceCents: row.transport_allowance_cents,
      }),
      nationalId: row.national_id,
      employmentType: row.employment_type,
      mpesaNumber: row.mpesa_number,
      currency: row.currency,
      payFrequency: row.pay_frequency,
      kraPin: row.kra_pin,
      nssfNumber: row.nssf_number,
      nhifNumber: row.nhif_number,
      shifNumber: row.nhif_number,
      bankName: row.bank_name,
      bankAccount: row.bank_account,
      bankAccountNo: row.bank_account,
      status: row.status,
      createdAt: row.created_at
    }));
  }

  static async addEmployee(orgId: string, input: any) {
    const supabase = getSupabase();
    const firstName = optionalText(input.firstName, 'First name');
    const lastName = optionalText(input.lastName, 'Last name');
    if (!firstName || !lastName) throw new Error('First and last name are required.');

    const { data, error } = await supabase
      .from('employees')
      .insert({
        org_id: orgId,
        first_name: firstName,
        middle_name: optionalText(input.middleName, 'Middle name'),
        last_name: lastName,
        email: optionalText(input.email, 'Email'),
        phone: optionalText(input.phone, 'Phone'),
        department: optionalText(input.department, 'Department') || 'Operations',
        job_title: optionalText(input.jobTitle, 'Job title') || 'Staff',
        hire_date: optionalDate(input.hireDate, 'Hire date') || new Date().toISOString().substring(0, 10),
        base_salary: centsOrZero(input.baseSalaryCents, 'Base salary'),
        housing_allowance_cents: centsOrZero(input.housingAllowanceCents, 'Housing allowance'),
        transport_allowance_cents: centsOrZero(input.transportAllowanceCents, 'Transport allowance'),
        currency: 'KES',
        pay_frequency: 'Monthly',
        kra_pin: optionalText(input.kraPin, 'KRA PIN'),
        nssf_number: optionalText(input.nssfNumber, 'NSSF number'),
        nhif_number: optionalText(input.shifNumber, 'SHA number'),
        national_id: optionalText(input.nationalId, 'National ID'),
        employment_type: optionalText(input.employmentType, 'Employment type'),
        mpesa_number: optionalText(input.mpesaNumber, 'M-Pesa number'),
        bank_name: optionalText(input.bankName, 'Bank name'),
        bank_account: optionalText(input.bankAccountNo, 'Bank account'),
        status: 'Active'
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  static async updateEmployee(orgId: string, id: string, input: any) {
    const supabase = getSupabase();
    const updateData: Record<string, unknown> = {};
    if (input.firstName !== undefined) updateData.first_name = optionalText(input.firstName, 'First name');
    if (input.lastName !== undefined) updateData.last_name = optionalText(input.lastName, 'Last name');
    if (input.middleName !== undefined) updateData.middle_name = optionalText(input.middleName, 'Middle name');
    if (input.email !== undefined) updateData.email = optionalText(input.email, 'Email');
    if (input.phone !== undefined) updateData.phone = optionalText(input.phone, 'Phone');
    if (input.department !== undefined) updateData.department = optionalText(input.department, 'Department');
    if (input.jobTitle !== undefined) updateData.job_title = optionalText(input.jobTitle, 'Job title');
    if (input.hireDate !== undefined) updateData.hire_date = optionalDate(input.hireDate, 'Hire date');
    if (input.baseSalaryCents !== undefined) updateData.base_salary = centsOrZero(input.baseSalaryCents, 'Base salary');
    if (input.housingAllowanceCents !== undefined) updateData.housing_allowance_cents = centsOrZero(input.housingAllowanceCents, 'Housing allowance');
    if (input.transportAllowanceCents !== undefined) updateData.transport_allowance_cents = centsOrZero(input.transportAllowanceCents, 'Transport allowance');
    if (input.kraPin !== undefined) updateData.kra_pin = optionalText(input.kraPin, 'KRA PIN');
    if (input.nssfNumber !== undefined) updateData.nssf_number = optionalText(input.nssfNumber, 'NSSF number');
    if (input.shifNumber !== undefined) updateData.nhif_number = optionalText(input.shifNumber, 'SHA number');
    if (input.nationalId !== undefined) updateData.national_id = optionalText(input.nationalId, 'National ID');
    if (input.employmentType !== undefined) updateData.employment_type = optionalText(input.employmentType, 'Employment type');
    if (input.mpesaNumber !== undefined) updateData.mpesa_number = optionalText(input.mpesaNumber, 'M-Pesa number');
    if (input.bankName !== undefined) updateData.bank_name = optionalText(input.bankName, 'Bank name');
    if (input.bankAccountNo !== undefined) updateData.bank_account = optionalText(input.bankAccountNo, 'Bank account');
    if (updateData.first_name === null || updateData.last_name === null) {
      throw new Error('First and last name cannot be blank.');
    }
    if (Object.keys(updateData).length === 0) return;

    const { data, error } = await supabase
      .from('employees')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new UserError('Employee not found in this organization.', 404);
  }

  static async runPayroll(
    orgId: string,
    period: string,
    payDate: string,
    createdBy: string,
    idempotencyKey?: string,
  ): Promise<string> {
    // One canonical label per month, so "Aug 2026" and "August 2026" cannot
    // both be run, and rates read for the month earned rather than the day paid.
    const payPeriod = parsePayPeriod(String(period ?? ''));
    if (!payPeriod) throw new Error('Write the payroll period as a month and year, such as September 2026.');
    if (!isIsoCalendarDate(payDate)) throw new Error('The pay date must be a real date in YYYY-MM-DD form.');
    const normalizedPeriod = payPeriod.label;
    if (!createdBy?.trim()) throw new Error('A payroll actor is required.');

    // Selects the rate table for the period before any remote work. The same
    // shared function calculates every employee below.
    const rateProbe = calculatePayslip(0, payPeriod.rateDate);
    const supabase = getSupabase();
    const [employees, accountIds] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('employees')
        .select('id, first_name, last_name, base_salary, housing_allowance_cents, transport_allowance_cents')
        .eq('org_id', orgId)
        .eq('status', 'Active')
        .order('id')
        .range(from, to)),
      getPayrollAccountIds(orgId),
    ]);

    if (employees.length === 0) throw new Error('No active employees to run payroll for.');

    const payslips: PayrollRpcPayslip[] = employees.map((employee: any) => {
      const breakdown = calculatePayslip(monthlyGrossCents({
        baseSalaryCents: employee.base_salary,
        housingAllowanceCents: employee.housing_allowance_cents,
        transportAllowanceCents: employee.transport_allowance_cents,
      }), payPeriod.rateDate);
      if (breakdown.netCents < 0) {
        // The SHIF minimum can exceed very small pay; say who, instead of the
        // database refusing the whole run with an unexplained total.
        throw new Error(`Deductions for ${employee.first_name} ${employee.last_name} exceed their gross pay for ${normalizedPeriod}. Check their salary before running payroll.`);
      }
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
    if (error) throw error;
    if (typeof runId !== 'string' || !runId) {
      throw new Error('Payroll posting did not return a payroll run ID.');
    }

    return runId;
  }

  static async getPayrollRuns(orgId: string) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => supabase
      .from('payroll_runs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to));

    return data.map((row: any) => ({
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
      reversedAt: row.reversed_at ?? null,
      reversalReason: row.reversal_reason ?? null,
      createdAt: row.created_at
    }));
  }

  /**
   * Reverses a payroll run: a reversing entry is posted and the month is free
   * for a corrected run (public.reverse_payroll_run). The payslips stay on
   * record, marked with the run's reversal.
   */
  static async reversePayrollRun(orgId: string, runId: string, reversalDate: string, reason: string, actor: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('reverse_payroll_run', {
      p_org_id: orgId,
      p_run_id: runId,
      p_reversal_date: reversalDate,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { reversalJournalEntryId: string; period: string };
  }

  static async getPayslips(orgId: string, payrollRunId: string) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => supabase
      .from('payslips')
      .select('*, payroll_runs!inner(org_id), employees(first_name, last_name)')
      .eq('payroll_run_id', payrollRunId)
      .eq('payroll_runs.org_id', orgId)
      .order('id')
      .range(from, to));

    return data.map((row: any) => ({
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
