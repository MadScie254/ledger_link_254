import { UserError } from './errors';
import { assertChurchEdition } from './churchAccess';
import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

interface CampaignInput {
  fundId: string; name: string; goalCents: number; startsOn: string; endsOn: string | null;
}
interface PledgeInput {
  memberId: string; pledgedCents: number; pledgedOn: string; dueOn: string | null; note: string | null;
}

async function requireEditor(orgId: string, actor: string, adminOnly = false) {
  await assertChurchEdition(orgId);
  const { data, error } = await getSupabase().from('memberships').select('role')
    .eq('org_id', orgId).eq('user_id', actor).maybeSingle();
  if (error) throw error;
  const allowed = adminOnly ? ['owner', 'admin'] : ['owner', 'admin', 'accountant'];
  if (!allowed.includes(data?.role ?? '')) throw new UserError(
    adminOnly ? 'Only an owner or admin can change campaigns.' : 'Only a church bookkeeper can record a pledge.', 403);
}

export class ChurchCampaignService {
  static async close(orgId: string, actor: string, campaignId: string, endsOn: string) {
    await requireEditor(orgId, actor, true);
    const supabase = getSupabase();
    const { data: campaign, error } = await supabase.from('church_campaigns')
      .select('id,fund_id,starts_on,status,ends_on').eq('org_id', orgId).eq('id', campaignId).maybeSingle();
    if (error) throw error;
    if (!campaign) throw new UserError('Campaign not found in this church.', 404);
    if (campaign.status === 'CLOSED') return { id: campaign.id, endsOn: campaign.ends_on };
    if (endsOn < campaign.starts_on) throw new UserError('The campaign end must follow its start.');
    const [laterGift, laterPledge] = await Promise.all([
      supabase.from('contributions').select('id').eq('org_id', orgId).eq('fund_id', campaign.fund_id)
        .gte('received_on', campaign.starts_on).gt('received_on', endsOn).limit(1),
      supabase.from('church_pledges').select('id').eq('org_id', orgId).eq('campaign_id', campaignId)
        .gt('pledged_on', endsOn).limit(1),
    ]);
    if (laterGift.error) throw laterGift.error;
    if (laterPledge.error) throw laterPledge.error;
    if (laterGift.data?.length || laterPledge.data?.length) {
      throw new UserError('The end date cannot leave recorded gifts or pledges outside the campaign.', 409);
    }
    const saved = await supabase.from('church_campaigns').update({ status: 'CLOSED', ends_on: endsOn })
      .eq('org_id', orgId).eq('id', campaignId).select('id').single();
    if (saved.error) throw saved.error;
    const audit = await supabase.from('audit_logs').insert({ org_id: orgId, user_id: actor, action: 'UPDATE',
      resource_type: 'CHURCH_CAMPAIGN', resource_id: campaignId, details: { status: 'CLOSED', endsOn } });
    if (audit.error) throw audit.error;
    return { id: campaignId, endsOn };
  }

  static async list(orgId: string) {
    await assertChurchEdition(orgId);
    const supabase = getSupabase();
    const [campaigns, pledges, campaignProgress, pledgeProgress] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase.from('church_campaigns').select('id,fund_id,name,goal_cents,starts_on,ends_on,status,funds(code,name,restricted)')
        .eq('org_id', orgId).order('starts_on', { ascending: false }).order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase.from('church_pledges')
        .select('id,campaign_id,member_id,pledged_cents,pledged_on,due_on,status,note,members(member_number,first_name,last_name)')
        .eq('org_id', orgId).order('pledged_on', { ascending: false }).order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase.rpc('church_campaign_progress', { p_org_id: orgId }).range(from, to)),
      fetchAllRows<any>((from, to) => supabase.rpc('church_pledge_progress', { p_org_id: orgId }).range(from, to)),
    ]);
    const byCampaign = new Map(campaignProgress.map((row) => [row.campaign_id, row]));
    const byPledge = new Map(pledgeProgress.map((row) => [row.pledge_id, row]));
    return { campaigns: campaigns.map((campaign) => ({
      id: campaign.id, fundId: campaign.fund_id, fund: campaign.funds, name: campaign.name,
      goalCents: Number(campaign.goal_cents), startsOn: campaign.starts_on, endsOn: campaign.ends_on,
      status: campaign.status, givenCents: Number(byCampaign.get(campaign.id)?.given_cents ?? 0),
      pledgedCents: Number(byCampaign.get(campaign.id)?.pledged_cents ?? 0),
      pledges: pledges.filter((pledge) => pledge.campaign_id === campaign.id).map((pledge) => ({
        id: pledge.id, memberId: pledge.member_id, member: pledge.members,
        pledgedCents: Number(pledge.pledged_cents), receivedCents: Number(byPledge.get(pledge.id)?.received_cents ?? 0),
        pledgedOn: pledge.pledged_on, dueOn: pledge.due_on, status: pledge.status, note: pledge.note,
      })),
    })) };
  }

  static async create(orgId: string, actor: string, input: CampaignInput): Promise<string> {
    await requireEditor(orgId, actor, true);
    if (!Number.isSafeInteger(input.goalCents) || input.goalCents <= 0) throw new UserError('The campaign goal must be positive whole cents.');
    const supabase = getSupabase();
    const { data: fund, error: fundError } = await supabase.from('funds').select('is_active')
      .eq('org_id', orgId).eq('id', input.fundId).maybeSingle();
    if (fundError) throw fundError;
    if (!fund?.is_active) throw new UserError('Choose an open fund in this church.', 404);
    const { data, error } = await supabase.from('church_campaigns').insert({
      org_id: orgId, fund_id: input.fundId, name: input.name.trim(), goal_cents: input.goalCents,
      starts_on: input.startsOn, ends_on: input.endsOn, created_by: actor,
    }).select('id').single();
    if (error?.code === '23514') throw new UserError('Campaign dates overlap for this fund.', 409);
    if (error) throw error;
    const audit = await supabase.from('audit_logs').insert({ org_id: orgId, user_id: actor, action: 'CREATE',
      resource_type: 'CHURCH_CAMPAIGN', resource_id: data.id, details: { fundId: input.fundId, goalCents: input.goalCents } });
    if (audit.error) throw audit.error;
    return data.id;
  }

  static async pledge(orgId: string, actor: string, campaignId: string, input: PledgeInput): Promise<string> {
    await requireEditor(orgId, actor);
    if (!Number.isSafeInteger(input.pledgedCents) || input.pledgedCents <= 0) throw new UserError('The pledge must be positive whole cents.');
    const supabase = getSupabase();
    const { data: campaign, error: campaignError } = await supabase.from('church_campaigns')
      .select('id,starts_on,ends_on,status').eq('org_id', orgId).eq('id', campaignId).maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) throw new UserError('Campaign not found in this church.', 404);
    if (campaign.status !== 'OPEN' || input.pledgedOn < campaign.starts_on
      || (campaign.ends_on && input.pledgedOn > campaign.ends_on)) {
      throw new UserError('The pledge date must fall within an open campaign.', 409);
    }
    const { data: member, error: memberError } = await supabase.from('members').select('id')
      .eq('org_id', orgId).eq('id', input.memberId).maybeSingle();
    if (memberError) throw memberError;
    if (!member) throw new UserError('Member not found in this church.', 404);
    const { data, error } = await supabase.from('church_pledges').insert({ org_id: orgId,
      campaign_id: campaignId, member_id: input.memberId, pledged_cents: input.pledgedCents,
      pledged_on: input.pledgedOn, due_on: input.dueOn, note: input.note?.trim() || null, created_by: actor,
    }).select('id').single();
    if (error?.code === '23505') throw new UserError('This member already has a pledge for the campaign.', 409);
    if (error) throw error;
    const audit = await supabase.from('audit_logs').insert({ org_id: orgId, user_id: actor, action: 'CREATE',
      resource_type: 'CHURCH_PLEDGE', resource_id: data.id, details: { campaignId, memberId: input.memberId, pledgedCents: input.pledgedCents } });
    if (audit.error) throw audit.error;
    return data.id;
  }
}
