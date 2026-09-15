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

  static async updateProject(orgId: string, id: string, input: any) {
    const supabase = getSupabase();
    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.projectCode !== undefined) updateData.project_code = input.projectCode;
    if (input.customerId !== undefined) updateData.customer_id = input.customerId;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.startDate !== undefined) updateData.start_date = input.startDate;
    if (input.endDate !== undefined) updateData.end_date = input.endDate;
    if (input.budgetCents !== undefined) updateData.budget_cents = input.budgetCents;
    if (input.managerId !== undefined) updateData.manager_id = input.managerId;

    const { error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;
  }

  static async getTimeEntries(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('time_entries')
      .select('id, project_id, user_id, entry_date, hours, description, created_at, projects!inner(name)')
      .eq('org_id', orgId)
      .order('entry_date', { ascending: false })
      .limit(100);

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.projects?.name || 'Unknown Project',
      userId: row.user_id,
      entryDate: row.entry_date,
      hours: Number(row.hours),
      description: row.description,
      createdAt: row.created_at
    }));
  }

  static async submitTimeEntry(orgId: string, userId: string | undefined, input: { projectId: string; entryDate: string; hours: number; description?: string }) {
    const supabase = getSupabase();
    if (!input.projectId) throw new Error('A project is required.');
    if (!input.hours || input.hours <= 0 || input.hours > 24) {
      throw new Error('Hours must be between 0 and 24.');
    }

    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        org_id: orgId,
        project_id: input.projectId,
        user_id: userId || null,
        entry_date: input.entryDate,
        hours: input.hours,
        description: input.description || null
      })
      .select('id')
      .single();

    if (error) throw error;
    // Note: this only records logged hours. Projects have no per-project
    // billing/cost rate in the schema, so hours are not converted into a
    // dollar cost here — doing so would mean inventing a rate. Job Costing's
    // "Cost to Date" is driven by projects.cost_cents, entered separately.
    return data.id;
  }
}
