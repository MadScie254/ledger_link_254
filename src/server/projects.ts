import { getSupabase } from './supabase';

export class ProjectService {
  static async getProjects(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      projectCode: row.project_code,
      customerId: row.customer_id,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      budgetCents: row.budget_cents,
      costCents: row.cost_cents,
      revenueCents: row.revenue_cents,
      managerId: row.manager_id,
      createdAt: row.created_at
    }));
  }

  static async createProject(orgId: string, input: any) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('projects')
      .insert({
        org_id: orgId,
        name: input.name,
        customer_id: input.customerId || null,
        budget_cents: input.budgetCents || 0,
        status: 'Planned'
      })
      .select('id')
      .single();
      
    if (error) throw error;
    return data.id;
  }
}
