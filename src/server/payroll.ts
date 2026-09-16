import { getSupabase } from './supabase';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';

export interface PayslipBreakdown {
  grossCents: number;
  payeCents: number;
  nssfCents: number;
  shifCents: number;
  ahlCents: number;
  netCents: number;
}

/**
 * Kenyan statutory payroll deductions, per the Finance Act 2023 / NSSF Act
 * (2013, amended 2023) / SHIF Act 2023 rates in effect for 2024/2025.
 * Bands can change by legislation — verify against current KRA/NSSF/SHA
 * guidance before relying on this for a real filing.
 */
export function calculatePayslip(grossCents: number): PayslipBreakdown {
  const gross = grossCents / 100;

  // PAYE — graduated monthly bands (KES), then KES 2,400/month personal relief.
  const bands = [
    { upTo: 24000, rate: 0.10 },
    { upTo: 32333, rate: 0.25 },
    { upTo: 500000, rate: 0.30 },
    { upTo: 800000, rate: 0.325 },
    { upTo: Infinity, rate: 0.35 }
  ];
  let remaining = gross;
  let lowerBound = 0;
  let taxBeforeRelief = 0;
  for (const band of bands) {
    if (remaining <= 0) break;
    const bandWidth = band.upTo - lowerBound;
    const taxableInBand = Math.min(remaining, bandWidth);
    taxBeforeRelief += taxableInBand * band.rate;
    remaining -= taxableInBand;
    lowerBound = band.upTo;
  }
  const PERSONAL_RELIEF = 2400;
  const paye = Math.max(taxBeforeRelief - PERSONAL_RELIEF, 0);

  // NSSF — 6% employee contribution, Tier I + Tier II, capped at the
  // upper earnings limit (KES 36,000/month as of Feb 2025).
  const NSSF_UEL = 36000;
  const nssf = Math.min(gross, NSSF_UEL) * 0.06;

  // SHIF (replaced NHIF in Oct 2024) — 2.75% of gross, minimum KES 300.
  const shif = Math.max(gross * 0.0275, 300);

  // Affordable Housing Levy — 1.5% of gross (employee portion).
  const ahl = gross * 0.015;

  const totalDeductions = paye + nssf + shif + ahl;
  const net = gross - totalDeductions;

  return {
    grossCents: Math.round(gross * 100),
    payeCents: Math.round(paye * 100),
    nssfCents: Math.round(nssf * 100),
    shifCents: Math.round(shif * 100),
    ahlCents: Math.round(ahl * 100),
    netCents: Math.round(net * 100)
  };
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

  static async runPayroll(orgId: string, period: string, payDate: string, createdBy?: string): Promise<string> {
    const supabase = getSupabase();

    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('id, base_salary, status')
      .eq('org_id', orgId)
      .eq('status', 'Active');

    if (empError) throw empError;
    if (!employees || employees.length === 0) throw new Error('No active employees to run payroll for.');

    const { data: existingRun } = await supabase
      .from('payroll_runs')
      .select('id')
      .eq('org_id', orgId)
      .eq('period', period)
      .maybeSingle();
    if (existingRun) throw new Error(`Payroll for ${period} has already been processed.`);

    const salaryAccount = await AccountService.getAccountByCode(orgId, '6100');
    const cashAccount = await AccountService.getAccountByCode(orgId, '1000');
    const vatPayableAccount = await AccountService.getAccountByCode(orgId, '2100');
    if (!salaryAccount || !cashAccount) {
      throw new Error('Salaries Expense (6100) or Cash (1000) account not found. Seed the chart of accounts first.');
    }

    const breakdowns = employees.map((emp: any) => ({
      employeeId: emp.id,
      ...calculatePayslip(emp.base_salary || 0)
    }));

    const totals = breakdowns.reduce((acc, b) => ({
      grossCents: acc.grossCents + b.grossCents,
      payeCents: acc.payeCents + b.payeCents,
      nssfCents: acc.nssfCents + b.nssfCents,
      shifCents: acc.shifCents + b.shifCents,
      ahlCents: acc.ahlCents + b.ahlCents,
      netCents: acc.netCents + b.netCents
    }), { grossCents: 0, payeCents: 0, nssfCents: 0, shifCents: 0, ahlCents: 0, netCents: 0 });

    const totalStatutoryCents = totals.payeCents + totals.nssfCents + totals.shifCents + totals.ahlCents;

    // Post: Debit Salaries Expense (gross), Credit Cash (net pay),
    // Credit a statutory payable account (all withholdings owed to KRA/NSSF/SHA).
    const journalEntryId = await LedgerService.postJournalEntry({
      orgId,
      entryDate: payDate,
      memo: `Payroll run ${period}`,
      sourceType: 'PAYROLL',
      referenceNo: period,
      createdBy,
      lines: [
        { accountId: salaryAccount.id, debit: totals.grossCents, credit: 0, description: `Gross salaries — ${period}` },
        { accountId: cashAccount.id, debit: 0, credit: totals.netCents, description: `Net pay disbursed — ${period}` },
        ...(vatPayableAccount && totalStatutoryCents > 0
          ? [{ accountId: vatPayableAccount.id, debit: 0, credit: totalStatutoryCents, description: `PAYE/NSSF/SHIF/AHL withheld — ${period}` }]
          : [])
      ]
    });

    const { data: run, error: runError } = await supabase
      .from('payroll_runs')
      .insert({
        org_id: orgId,
        period,
        pay_date: payDate,
        journal_entry_id: journalEntryId,
        total_gross_cents: totals.grossCents,
        total_net_cents: totals.netCents,
        total_paye_cents: totals.payeCents,
        total_nssf_cents: totals.nssfCents,
        total_shif_cents: totals.shifCents,
        total_ahl_cents: totals.ahlCents,
        created_by: createdBy || null
      })
      .select('id')
      .single();

    if (runError) throw runError;

    const { error: payslipsError } = await supabase
      .from('payslips')
      .insert(breakdowns.map(b => ({
        payroll_run_id: run.id,
        employee_id: b.employeeId,
        gross_cents: b.grossCents,
        paye_cents: b.payeCents,
        nssf_cents: b.nssfCents,
        shif_cents: b.shifCents,
        ahl_cents: b.ahlCents,
        net_cents: b.netCents
      })));

    if (payslipsError) throw payslipsError;

    return run.id;
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
      payeCents: row.paye_cents,
      nssfCents: row.nssf_cents,
      shifCents: row.shif_cents,
      ahlCents: row.ahl_cents,
      netCents: row.net_cents
    }));
  }
}
