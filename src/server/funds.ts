import { getSupabase } from './supabase';
import { UserError } from './errors';

export interface FundInput {
  code: string;
  name: string;
  restricted: boolean;
  incomeAccountId: string;
}

export interface GivingRuleInput {
  priority: number;
  matchType: 'MEMBER_NUMBER' | 'PREFIX' | 'EXACT';
  pattern?: string | null;
  fundId: string;
  incomeAccountId?: string | null;
}

async function requireIncomeAccount(orgId: string, accountId: string) {
  const { data, error } = await getSupabase().from('accounts').select('id,type,is_active')
    .eq('org_id', orgId).eq('id', accountId).maybeSingle();
  if (error) throw error;
  if (!data || data.type !== 'INCOME' || data.is_active === false) {
    throw new UserError('Choose an active income account of this church.');
  }
}

export class FundsService {
  static async list(orgId: string) {
    const { data, error } = await getSupabase().from('funds')
      .select('id,code,name,restricted,is_active,income_account_id,created_at,accounts(code,name)')
      .eq('org_id', orgId).order('code').limit(500);
    if (error) throw error;
    return data ?? [];
  }

  static async create(orgId: string, input: FundInput): Promise<string> {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new UserError('A fund code is 2 to 20 capital letters, digits or underscores, such as YOUTH.');
    await requireIncomeAccount(orgId, input.incomeAccountId);
    const { data, error } = await getSupabase().from('funds').insert({
      org_id: orgId, code, name: input.name.trim(), restricted: input.restricted, income_account_id: input.incomeAccountId,
    }).select('id').single();
    if (error) {
      if (error.code === '23505') throw new UserError(`The church already has a fund coded ${code}.`, 409);
      throw error;
    }
    return data.id as string;
  }

  /** The code stays as it is: reports and giving rules refer to it. */
  static async update(orgId: string, id: string, input: { name?: string; restricted?: boolean; isActive?: boolean; incomeAccountId?: string }) {
    const supabase = getSupabase();
    const { data: fund, error: readError } = await supabase.from('funds').select('code').eq('org_id', orgId).eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!fund) throw new UserError('Fund not found.', 404);
    if (fund.code === 'GENERAL' && input.isActive === false) {
      throw new UserError('The general fund stays open: lines posted without a fund belong to it.', 409);
    }
    if (input.incomeAccountId) await requireIncomeAccount(orgId, input.incomeAccountId);
    const changes: Record<string, unknown> = {};
    if (input.name !== undefined) changes.name = input.name.trim();
    if (input.restricted !== undefined) changes.restricted = input.restricted;
    if (input.isActive !== undefined) changes.is_active = input.isActive;
    if (input.incomeAccountId !== undefined) changes.income_account_id = input.incomeAccountId;
    if (!Object.keys(changes).length) return;
    const { error } = await supabase.from('funds').update(changes).eq('org_id', orgId).eq('id', id);
    if (error) throw error;
  }

  static async rules(orgId: string) {
    const { data, error } = await getSupabase().from('giving_rules')
      .select('id,priority,match_type,pattern,fund_id,income_account_id,is_active,funds(code,name),accounts(code,name)')
      .eq('org_id', orgId).order('priority').order('id').limit(500);
    if (error) throw error;
    return data ?? [];
  }

  static async createRule(orgId: string, input: GivingRuleInput): Promise<string> {
    const pattern = input.matchType === 'MEMBER_NUMBER' ? null : (input.pattern || '').trim().toUpperCase();
    if (input.matchType !== 'MEMBER_NUMBER' && !/^[A-Z0-9-]{1,20}$/.test(pattern || '')) {
      throw new UserError('A rule matches 1 to 20 letters, digits or hyphens, such as BLD or TITHE.');
    }
    if (input.incomeAccountId) await requireIncomeAccount(orgId, input.incomeAccountId);
    const { data, error } = await getSupabase().from('giving_rules').insert({
      org_id: orgId, priority: input.priority, match_type: input.matchType, pattern,
      fund_id: input.fundId, income_account_id: input.incomeAccountId || null,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }

  static async updateRule(orgId: string, id: string, input: { priority?: number; isActive?: boolean }) {
    const changes: Record<string, unknown> = {};
    if (input.priority !== undefined) changes.priority = input.priority;
    if (input.isActive !== undefined) changes.is_active = input.isActive;
    if (!Object.keys(changes).length) return;
    const { data, error } = await getSupabase().from('giving_rules').update(changes)
      .eq('org_id', orgId).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new UserError('Giving rule not found.', 404);
  }
}
