import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { lawTimeAmountCents } from '../utils/lawTime';

type MatterFilters = { search?: string; status?: string; stage?: string };
type TimeInput = { entryDate: string; hours: number; description?: string;
  billable: boolean; rateCents?: number };

export class MatterService {
  static async list(orgId: string, filters: MatterFilters = {}) {
    const supabase = getSupabase();
    const search = filters.search?.trim().replace(/[(),.%]/g, '').slice(0, 100);
    return fetchAllRows<any>((from, to) => {
      let query = supabase.from('matters')
        .select('*,customers(display_name)').eq('org_id', orgId)
        .order('opened_on', { ascending: false }).order('id').range(from, to);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.stage) query = query.eq('stage', filters.stage);
      if (search) query = query.or(`title.ilike.%${search}%,matter_number.ilike.%${search}%`);
      return query;
    });
  }

  static async get(orgId: string, matterId: string) {
    const { data, error } = await getSupabase().from('matters')
      .select('*,customers(display_name)').eq('org_id', orgId).eq('id', matterId).maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Matter not found.', 404);
    return data;
  }

  static async create(orgId: string, actor: string, details: Record<string, unknown>) {
    const { data, error } = await getSupabase().rpc('create_law_matter', {
      p_org_id: orgId, p_details: details, p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }

  static async update(orgId: string, matterId: string, fields: Record<string, unknown>) {
    const columns: Record<string, string> = {
      title: 'title', practiceArea: 'practice_area', matterType: 'matter_type',
      stage: 'stage', status: 'status', responsibleUserId: 'responsible_user_id',
      court: 'court', courtStation: 'court_station', caseNumber: 'case_number',
      judicialOfficer: 'judicial_officer', billingMethod: 'billing_method',
      defaultRateCents: 'default_rate_cents', fixedFeeCents: 'fixed_fee_cents',
      closedOn: 'closed_on', notes: 'notes',
    };
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (columns[key]) update[columns[key]] = value;
    }
    if (!Object.keys(update).length) throw new UserError('Choose a matter field to change.');
    const { data, error } = await getSupabase().from('matters').update(update)
      .eq('org_id', orgId).eq('id', matterId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Matter not found.', 404);
  }

  static async conflictCheck(orgId: string, query: string) {
    const { data, error } = await getSupabase().rpc('search_matter_conflicts', {
      p_org_id: orgId, p_query: query,
    });
    if (error) throw error;
    return data ?? [];
  }

  static async parties(orgId: string, matterId: string) {
    await this.get(orgId, matterId);
    const { data, error } = await getSupabase().from('matter_parties').select('*')
      .eq('org_id', orgId).eq('matter_id', matterId).order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  static async addParty(orgId: string, matterId: string, actor: string,
    party: { name: string; role: string; idOrRegNumber?: string; phone?: string; email?: string }) {
    await this.get(orgId, matterId);
    const { data, error } = await getSupabase().from('matter_parties').insert({
      org_id: orgId, matter_id: matterId, name: party.name, role: party.role,
      id_or_reg_number: party.idOrRegNumber, phone: party.phone,
      email: party.email, created_by: actor,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }

  static async unbilled(orgId: string, matterId: string) {
    await this.get(orgId, matterId);
    const supabase = getSupabase();
    const [time, disbursements] = await Promise.all([
      supabase.from('time_entries').select('*').eq('org_id', orgId)
        .eq('matter_id', matterId).eq('billable', true).is('invoice_id', null)
        .order('entry_date'),
      supabase.from('disbursements').select('*').eq('org_id', orgId)
        .eq('matter_id', matterId).eq('paid_from', 'OFFICE').is('invoice_id', null)
        .order('incurred_on'),
    ]);
    if (time.error) throw time.error;
    if (disbursements.error) throw disbursements.error;
    return { timeEntries: time.data ?? [], disbursements: disbursements.data ?? [] };
  }

  static async timeEntries(orgId: string, matterId: string) {
    await this.get(orgId, matterId);
    const { data, error } = await getSupabase().from('time_entries').select('*')
      .eq('org_id', orgId).eq('matter_id', matterId)
      .order('entry_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  static async logTime(orgId: string, matterId: string, actor: string, input: TimeInput) {
    const matter = await this.get(orgId, matterId);
    if (matter.status === 'CLOSED') throw new UserError('A closed matter cannot receive time.');
    const rate = input.rateCents ?? matter.default_rate_cents;
    if (input.billable && rate == null) {
      throw new UserError('Set an hourly rate on the matter or this time entry.');
    }
    const amount = input.billable ? lawTimeAmountCents(input.hours, Number(rate)) : 0;
    const { data, error } = await getSupabase().from('time_entries').insert({
      org_id: orgId, matter_id: matterId, project_id: null, user_id: actor,
      entry_date: input.entryDate, hours: input.hours, description: input.description,
      billable: input.billable, rate_cents: rate ?? null, amount_cents: amount,
      created_by: actor,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }
}
