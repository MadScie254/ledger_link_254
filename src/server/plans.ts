import { getSupabase } from './supabase';
import { UserError } from './errors';
import { canAddMember, canAddUser, limitMessage, nextPlanFor, type PlanLimits } from '../utils/planLimits';
import type { Edition } from '../utils/editions';

export interface PlanSnapshot {
  plan: PlanLimits;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  billingCycle: 'MONTHLY' | 'ANNUAL' | null;
  activeUsers: number;
  pendingInvitations: number;
}

/** Reads only the selected organization's plan; the Worker verifies membership first. */
export class PlanService {
  static async snapshot(orgId: string): Promise<{ snapshot: PlanSnapshot; plans: PlanLimits[] } | null> {
    const supabase = getSupabase();
    const { data: organization, error: organizationError } = await supabase.from('organizations')
      .select('edition').eq('id', orgId).maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization) throw new UserError('Organization not found.', 404);
    if (organization.edition === 'business' || !organization.edition) return null;

    const [subscriptionResult, plansResult, membersResult, invitationsResult] = await Promise.all([
      supabase.from('organization_subscriptions')
        .select('plan_id, status, trial_ends_at, current_period_end, billing_cycle')
        .eq('org_id', orgId).maybeSingle(),
      supabase.from('plans').select('id, edition, name, max_users, max_members, is_active').eq('edition', organization.edition),
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('organization_invitations').select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('status', 'PENDING'),
    ]);
    for (const result of [subscriptionResult, plansResult, membersResult, invitationsResult]) {
      if (result.error) throw result.error;
    }
    const plans: PlanLimits[] = (plansResult.data || []).map((row) => ({
      id: row.id, edition: row.edition as Edition, name: row.name,
      maxUsers: row.max_users, maxMembers: row.max_members, isActive: row.is_active,
    }));
    const subscription = subscriptionResult.data;
    const plan = plans.find((item) => item.id === subscription?.plan_id);
    if (!subscription || !plan) throw new UserError('This organization has no valid plan. Contact the Ledger Link team.', 409);
    return { snapshot: {
      plan, status: subscription.status, trialEndsAt: subscription.trial_ends_at,
      currentPeriodEnd: subscription.current_period_end, billingCycle: subscription.billing_cycle,
      activeUsers: membersResult.count || 0, pendingInvitations: invitationsResult.count || 0,
    }, plans };
  }

  static async ensureCanInvite(orgId: string, email: string): Promise<void> {
    const result = await this.snapshot(orgId);
    if (!result) return; // Existing business organizations have no edition plan.
    const { snapshot, plans } = result;
    const supabase = getSupabase();
    const { data: existing, error } = await supabase.from('organization_invitations')
      .select('id').eq('org_id', orgId).eq('email', email.trim().toLowerCase())
      .eq('status', 'PENDING').maybeSingle();
    if (error) throw error;
    if (existing) return; // A role change to a pending invitation uses its reserved seat.
    const currentUsers = snapshot.activeUsers + snapshot.pendingInvitations;
    if (!canAddUser(snapshot.plan, currentUsers)) {
      throw new UserError(limitMessage(snapshot.plan, nextPlanFor(snapshot.plan, plans, 'users'), 'users'), 409);
    }
  }

  /** E3 member creation calls this before writing a new church member. */
  static async ensureCanAddMember(orgId: string, currentMembers: number): Promise<void> {
    const result = await this.snapshot(orgId);
    if (!result) return;
    const { snapshot, plans } = result;
    if (!canAddMember(snapshot.plan, currentMembers)) {
      throw new UserError(limitMessage(snapshot.plan, nextPlanFor(snapshot.plan, plans, 'members'), 'members'), 409);
    }
  }
}
