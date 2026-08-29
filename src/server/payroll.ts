import { getSupabase } from './supabase';

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
      baseSalary: row.base_salary,
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
}
