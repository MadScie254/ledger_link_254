import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { PlanService } from './plans';
import { normaliseMemberNumber, type ImportedMember, type MemberStatus } from '../utils/memberImport';

export interface MemberInput {
  memberNumber: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  householdId?: string | null;
  status?: MemberStatus;
  dateOfBirth?: string | null;
  joinedOn?: string | null;
  consentMethod?: string | null;
  notes?: string | null;
}

// Members who count against the plan: everyone still part of the church.
const COUNTED = ['VISITOR', 'ADHERENT', 'MEMBER', 'BAPTISED_MEMBER'];
const MEMBER_COLUMNS = 'id,member_number,first_name,last_name,phone,email,household_id,status,date_of_birth,joined_on,consent_given_at,consent_method,notes,created_at,updated_at,households(name)';

const blank = (value: string | null | undefined) => (value === undefined ? undefined : (value?.trim() || null));

/** Search words safe to put inside a PostgREST or() filter. */
const searchTerm = (value: string) => value.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

function duplicateNumber(err: any, number: string): never {
  if (err?.code === '23505') throw new UserError(`Member number ${number} is already in the register.`, 409);
  throw err;
}

export class MembersService {
  static async countForPlan(orgId: string): Promise<number> {
    const { count, error } = await getSupabase().from('members').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).in('status', COUNTED);
    if (error) throw error;
    return count || 0;
  }

  static async list(orgId: string, filters: { search?: string; status?: MemberStatus; householdId?: string } = {}) {
    const supabase = getSupabase();
    const term = filters.search ? searchTerm(filters.search) : '';
    return fetchAllRows<any>((from, to) => {
      let query = supabase.from('members').select(MEMBER_COLUMNS).eq('org_id', orgId);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.householdId) query = query.eq('household_id', filters.householdId);
      if (term) {
        const like = `*${term.replace(/\s/g, '*')}*`;
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},member_number.ilike.${like},phone.ilike.${like}`);
      }
      return query.order('member_number').order('id').range(from, to);
    });
  }

  /** A member with their household and giving, newest first. */
  static async get(orgId: string, id: string) {
    const supabase = getSupabase();
    const [member, giving] = await Promise.all([
      supabase.from('members').select(MEMBER_COLUMNS).eq('org_id', orgId).eq('id', id).maybeSingle(),
      fetchAllRows<any>((from, to) => supabase.from('contributions')
        .select('id,amount_cents,method,received_on,reference,journal_entry_id,fund_id,funds(code,name)')
        .eq('org_id', orgId).eq('member_id', id)
        .order('received_on', { ascending: false }).order('id').range(from, to)),
    ]);
    if (member.error) throw member.error;
    if (!member.data) throw new UserError('Member not found.', 404);
    return { member: member.data, giving, givingTotalCents: giving.reduce((sum, row) => sum + Number(row.amount_cents), 0) };
  }

  private static row(orgId: string, userId: string | null, input: MemberInput) {
    const memberNumber = normaliseMemberNumber(input.memberNumber);
    if (!memberNumber) throw new UserError('A member number is 1 to 20 letters, digits or hyphens.');
    const phone = blank(input.phone) ?? null;
    const email = blank(input.email)?.toLowerCase() ?? null;
    const consentMethod = blank(input.consentMethod) ?? null;
    if ((phone || email) && !consentMethod) {
      throw new UserError('A phone number or email needs the member\'s consent. Say how it was given, for example "Signed form".');
    }
    return {
      org_id: orgId,
      member_number: memberNumber,
      first_name: input.firstName.trim(),
      last_name: blank(input.lastName) ?? null,
      phone, email,
      household_id: input.householdId || null,
      status: input.status || 'MEMBER',
      date_of_birth: input.dateOfBirth || null,
      joined_on: input.joinedOn || null,
      consent_method: phone || email ? consentMethod : null,
      consent_given_at: phone || email ? new Date().toISOString() : null,
      notes: blank(input.notes) ?? null,
      created_by: userId,
    };
  }

  static async create(orgId: string, userId: string, input: MemberInput): Promise<string> {
    const row = MembersService.row(orgId, userId, input);
    if (COUNTED.includes(row.status)) await PlanService.ensureCanAddMember(orgId, await MembersService.countForPlan(orgId));
    const { data, error } = await getSupabase().from('members').insert(row).select('id').single();
    if (error) duplicateNumber(error, row.member_number);
    return data.id;
  }

  static async update(orgId: string, id: string, input: Partial<MemberInput>) {
    const supabase = getSupabase();
    const { data: current, error: readError } = await supabase.from('members')
      .select('member_number,phone,email,consent_method,consent_given_at,status').eq('org_id', orgId).eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!current) throw new UserError('Member not found.', 404);
    const changes: Record<string, unknown> = {};
    if (input.memberNumber !== undefined) {
      const number = normaliseMemberNumber(input.memberNumber);
      if (!number) throw new UserError('A member number is 1 to 20 letters, digits or hyphens.');
      changes.member_number = number;
    }
    if (input.firstName !== undefined) changes.first_name = input.firstName.trim();
    for (const [key, column] of [['lastName', 'last_name'], ['notes', 'notes']] as const) {
      if (input[key] !== undefined) changes[column] = blank(input[key]) ?? null;
    }
    if (input.householdId !== undefined) changes.household_id = input.householdId || null;
    if (input.status !== undefined) changes.status = input.status;
    if (input.dateOfBirth !== undefined) changes.date_of_birth = input.dateOfBirth || null;
    if (input.joinedOn !== undefined) changes.joined_on = input.joinedOn || null;
    const phone = input.phone !== undefined ? blank(input.phone) ?? null : current.phone;
    const email = input.email !== undefined ? blank(input.email)?.toLowerCase() ?? null : current.email;
    const consentMethod = input.consentMethod !== undefined ? blank(input.consentMethod) ?? null : current.consent_method;
    if ((phone || email) && !consentMethod) {
      throw new UserError('A phone number or email needs the member\'s consent. Say how it was given, for example "Signed form".');
    }
    if (input.phone !== undefined) changes.phone = phone;
    if (input.email !== undefined) changes.email = email;
    if (input.consentMethod !== undefined || input.phone !== undefined || input.email !== undefined) {
      changes.consent_method = phone || email ? consentMethod : null;
      changes.consent_given_at = phone || email
        ? (input.consentMethod !== undefined && consentMethod !== current.consent_method ? new Date().toISOString() : current.consent_given_at || new Date().toISOString())
        : null;
    }
    // Bringing a transferred or inactive member back counts against the plan.
    if (input.status && COUNTED.includes(input.status) && !COUNTED.includes(current.status)) {
      await PlanService.ensureCanAddMember(orgId, await MembersService.countForPlan(orgId));
    }
    if (!Object.keys(changes).length) return;
    const { error } = await supabase.from('members').update(changes).eq('org_id', orgId).eq('id', id);
    if (error) duplicateNumber(error, String(changes.member_number ?? current.member_number));
  }

  /**
   * Members read from a CSV (src/utils/memberImport.ts), saved in one write
   * so a large register stays within the Worker's request budget. Numbers
   * already in the register, and the plan's member limit, are checked first;
   * households named in the file are found or made.
   */
  static async importMany(orgId: string, userId: string, members: ImportedMember[]) {
    if (!members.length) throw new UserError('The file has no members to import.');
    if (members.length > 5000) throw new UserError('Import at most 5,000 members at a time.');
    const supabase = getSupabase();
    const numbers = members.map((member) => normaliseMemberNumber(member.memberNumber));
    if (numbers.some((number) => !number)) throw new UserError('Every member needs a member number of 1 to 20 letters, digits or hyphens.');
    if (new Set(numbers).size !== numbers.length) throw new UserError('A member number appears twice in the file.');
    const existing = new Set((await fetchAllRows<any>((from, to) => supabase.from('members')
      .select('member_number').eq('org_id', orgId).order('id').range(from, to)))
      .map((row) => String(row.member_number).toUpperCase()));
    const taken = numbers.filter((number) => existing.has(number as string));
    if (taken.length) throw new UserError(`Already in the register: ${taken.slice(0, 10).join(', ')}${taken.length > 10 ? ` and ${taken.length - 10} more` : ''}.`, 409);

    const counted = members.filter((member) => COUNTED.includes(member.status)).length;
    if (counted) await PlanService.ensureCanAddMember(orgId, (await MembersService.countForPlan(orgId)) + counted - 1);

    const householdNames = [...new Set(members.map((member) => member.household?.trim()).filter(Boolean) as string[])];
    const households = new Map<string, string>();
    let householdsCreated = 0;
    if (householdNames.length) {
      const known = await fetchAllRows<any>((from, to) => supabase.from('households').select('id,name')
        .eq('org_id', orgId).order('id').range(from, to));
      for (const row of known) households.set(String(row.name).trim().toLowerCase(), row.id);
      const missing = householdNames.filter((name) => !households.has(name.toLowerCase()));
      if (missing.length) {
        const { data, error } = await supabase.from('households')
          .insert(missing.map((name) => ({ org_id: orgId, name, created_by: userId }))).select('id,name');
        if (error) throw error;
        for (const row of data ?? []) households.set(String(row.name).trim().toLowerCase(), row.id);
        householdsCreated = missing.length;
      }
    }
    const rows = members.map((member) => MembersService.row(orgId, userId, {
      ...member,
      householdId: member.household ? households.get(member.household.trim().toLowerCase()) ?? null : null,
    }));
    const { error } = await supabase.from('members').insert(rows);
    if (error) {
      if (error.code === '23505') throw new UserError('A member number in the file is already in the register.', 409);
      throw error;
    }
    return { imported: rows.length, householdsCreated };
  }

  static async households(orgId: string) {
    const supabase = getSupabase();
    const [households, members] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase.from('households').select('id,name,address,phone,created_at')
        .eq('org_id', orgId).order('name').order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase.from('members').select('household_id')
        .eq('org_id', orgId).not('household_id', 'is', null).order('id').range(from, to)),
    ]);
    const counts = new Map<string, number>();
    for (const row of members) counts.set(row.household_id, (counts.get(row.household_id) || 0) + 1);
    return households.map((household) => ({ ...household, memberCount: counts.get(household.id) || 0 }));
  }

  static async createHousehold(orgId: string, userId: string, input: { name: string; address?: string | null; phone?: string | null }) {
    const { data, error } = await getSupabase().from('households').insert({
      org_id: orgId, name: input.name.trim(), address: blank(input.address) ?? null, phone: blank(input.phone) ?? null, created_by: userId,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }
}
