import { monthRange, nairobiToday } from '../utils/churchReports';
import { givingPlanStatus } from '../utils/givingPlans';
import { UserError } from './errors';
import { assertChurchEdition } from './churchAccess';
import { fetchAllRows } from './pagination';
import { getSupabase } from './supabase';

interface PlanInput { memberId: string; fundId: string; monthlyCents: number; startsOn: string }

async function requireBookkeeper(orgId: string, actor: string) {
  await assertChurchEdition(orgId);
  const { data, error } = await getSupabase().from('memberships').select('role')
    .eq('org_id', orgId).eq('user_id', actor).maybeSingle();
  if (error) throw error;
  if (!['owner', 'admin', 'accountant'].includes(data?.role ?? '')) {
    throw new UserError('Only a church bookkeeper can change giving plans.', 403);
  }
}

export class GivingPlanService {
  static async list(orgId: string, month: string) {
    await assertChurchEdition(orgId);
    const range = monthRange(month);
    if (!range) throw new UserError('Choose a month as YYYY-MM.');
    const supabase = getSupabase();
    const [plans, progress] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase.from('church_giving_plans')
        .select('id,member_id,fund_id,monthly_cents,starts_on,ends_on,members(member_number,first_name,last_name),funds(code,name)')
        .eq('org_id', orgId).lte('starts_on', range.to).or(`ends_on.is.null,ends_on.gte.${range.from}`)
        .order('starts_on').order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase.rpc('church_giving_plan_monthly', { p_org_id: orgId, p_month: range.from }).range(from, to)),
    ]);
    const byId = new Map(progress.map((row) => [row.plan_id, row]));
    return { month, from: range.from, to: range.to, plans: plans.map((plan) => {
      const receivedCents = Number(byId.get(plan.id)?.received_cents ?? 0);
      const monthlyCents = Number(plan.monthly_cents);
      return { id: plan.id, memberId: plan.member_id, member: plan.members,
        fundId: plan.fund_id, fund: plan.funds, monthlyCents, receivedCents,
        startsOn: plan.starts_on, endsOn: plan.ends_on,
        status: givingPlanStatus(monthlyCents, receivedCents, month, nairobiToday().slice(0, 7)) };
    }) };
  }

  static async create(orgId: string, actor: string, input: PlanInput): Promise<string> {
    await requireBookkeeper(orgId, actor);
    if (!Number.isSafeInteger(input.monthlyCents) || input.monthlyCents <= 0) throw new UserError('Monthly giving must be positive whole cents.');
    if (!/^\d{4}-\d{2}-01$/.test(input.startsOn)) throw new UserError('A giving plan starts on the first day of a month.');
    const supabase = getSupabase();
    const [member, fund] = await Promise.all([
      supabase.from('members').select('id').eq('org_id', orgId).eq('id', input.memberId).maybeSingle(),
      supabase.from('funds').select('id,is_active').eq('org_id', orgId).eq('id', input.fundId).maybeSingle(),
    ]);
    if (member.error) throw member.error;
    if (fund.error) throw fund.error;
    if (!member.data) throw new UserError('Member not found in this church.', 404);
    if (!fund.data?.is_active) throw new UserError('Choose an open fund in this church.', 404);
    const { data, error } = await supabase.from('church_giving_plans').insert({ org_id: orgId,
      member_id: input.memberId, fund_id: input.fundId, monthly_cents: input.monthlyCents,
      starts_on: input.startsOn, created_by: actor }).select('id').single();
    if (error?.code === '23514') throw new UserError('Giving plans overlap for this member and fund.', 409);
    if (error) throw error;
    const audit = await supabase.from('audit_logs').insert({ org_id: orgId, user_id: actor, action: 'CREATE',
      resource_type: 'CHURCH_GIVING_PLAN', resource_id: data.id, details: input });
    if (audit.error) throw audit.error;
    return data.id;
  }

  static async stop(orgId: string, actor: string, planId: string, endsOn: string) {
    await requireBookkeeper(orgId, actor);
    const range = monthRange(endsOn.slice(0, 7));
    if (!range || range.to !== endsOn) throw new UserError('A giving plan stops at the end of a month.');
    const supabase = getSupabase();
    const { data: plan, error } = await supabase.from('church_giving_plans').select('id,starts_on,ends_on')
      .eq('org_id', orgId).eq('id', planId).maybeSingle();
    if (error) throw error;
    if (!plan) throw new UserError('Giving plan not found in this church.', 404);
    if (plan.ends_on) return { id: planId, endsOn: plan.ends_on };
    if (endsOn < plan.starts_on) throw new UserError('The plan cannot stop before it starts.');
    const saved = await supabase.from('church_giving_plans').update({ ends_on: endsOn })
      .eq('org_id', orgId).eq('id', planId).select('id').single();
    if (saved.error) throw saved.error;
    const audit = await supabase.from('audit_logs').insert({ org_id: orgId, user_id: actor, action: 'UPDATE',
      resource_type: 'CHURCH_GIVING_PLAN', resource_id: planId, details: { endsOn } });
    if (audit.error) throw audit.error;
    return { id: planId, endsOn };
  }
}
