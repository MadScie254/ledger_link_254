import { getSupabase } from './supabase';
import { UserError } from './errors';
import type { OrganizationRole } from '../../worker/auth';

type AssignableRole = 'admin' | 'member' | 'accountant';

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: OrganizationRole;
  status: 'Active';
  isYou: boolean;
  joinedAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: AssignableRole;
  status: 'Invited';
  invitedAt: string;
}

export interface MyInvitation {
  id: string;
  orgId: string;
  organizationName: string;
  role: AssignableRole;
  invitedByEmail: string | null;
  invitedAt: string;
}

/**
 * Team membership. Invitations are pending until the invited person accepts
 * them, signed in with that confirmed email address (public.invite_member,
 * public.respond_to_invitation); nobody is added to an organization without
 * agreeing to it. Only the owner manages administrators. Membership changes
 * are written to the audit log by the database.
 */
export class TeamService {
  static async getTeam(orgId: string, currentUserId: string): Promise<{ members: TeamMember[]; invitations: PendingInvitation[] }> {
    const supabase = getSupabase();
    const [membershipsResult, emailsResult, invitationsResult] = await Promise.all([
      supabase
        .from('memberships')
        .select('id, user_id, role, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true }),
      supabase.rpc('organization_member_emails', { p_org_id: orgId }),
      supabase
        .from('organization_invitations')
        .select('id, email, role, created_at')
        .eq('org_id', orgId)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true }),
    ]);
    if (membershipsResult.error) throw membershipsResult.error;
    if (emailsResult.error) throw emailsResult.error;
    if (invitationsResult.error) throw invitationsResult.error;

    const emailByUserId = new Map<string, string>(
      ((emailsResult.data || []) as Array<{ user_id: string; email: string | null }>).map((row) => [row.user_id, row.email || row.user_id]),
    );

    return {
      members: (membershipsResult.data || []).map((m) => ({
        id: m.id,
        userId: m.user_id,
        email: emailByUserId.get(m.user_id) || m.user_id,
        role: m.role as OrganizationRole,
        status: 'Active' as const,
        isYou: m.user_id === currentUserId,
        joinedAt: m.created_at,
      })),
      invitations: (invitationsResult.data || []).map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role as AssignableRole,
        status: 'Invited' as const,
        invitedAt: invitation.created_at,
      })),
    };
  }

  /**
   * Records an invitation. A person without an account yet is also sent
   * Supabase's sign-up invitation email; one who has an account sees the
   * invitation the next time they sign in.
   */
  static async invite(orgId: string, email: string, role: AssignableRole, invitedBy: string): Promise<{ invitationId: string; emailed: boolean }> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('invite_member', {
      p_org_id: orgId,
      p_email: email,
      p_role: role,
      p_actor: invitedBy,
    });
    if (error) throw error;
    const result = data as { invitationId: string; hasAccount: boolean };

    let emailed = false;
    if (!result.hasAccount) {
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);
      // The invitation stands either way: it is waiting for them when they sign up.
      if (!inviteError) emailed = true;
      else console.warn('[Team] Sign-up invitation email was not sent:', inviteError.status ?? '-', inviteError.code ?? '-');
    }
    return { invitationId: result.invitationId, emailed };
  }

  static async revokeInvitation(orgId: string, invitationId: string, actor: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('revoke_invitation', {
      p_org_id: orgId,
      p_invitation_id: invitationId,
      p_actor: actor,
    });
    if (error) throw error;
  }

  static async myInvitations(userId: string): Promise<MyInvitation[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('pending_invitations', { p_user_id: userId });
    if (error) throw error;
    return ((data || []) as any[]).map((row) => ({
      id: row.invitation_id,
      orgId: row.org_id,
      organizationName: row.organization_name,
      role: row.role,
      invitedByEmail: row.invited_by_email,
      invitedAt: row.created_at,
    }));
  }

  static async respond(invitationId: string, userId: string, accept: boolean): Promise<{ orgId: string; accepted: boolean }> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('respond_to_invitation', {
      p_invitation_id: invitationId,
      p_user_id: userId,
      p_accept: accept,
    });
    if (error) throw error;
    return data as { orgId: string; accepted: boolean };
  }

  private static async membership(orgId: string, membershipId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('memberships')
      .select('id, user_id, role')
      .eq('id', membershipId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Team member not found.', 404);
    return data;
  }

  /**
   * Changes a member's role. The owner's role never changes this way; only
   * the owner makes, unmakes or changes an administrator.
   */
  static async updateMemberRole(orgId: string, membershipId: string, role: AssignableRole, actorRole: OrganizationRole): Promise<void> {
    const supabase = getSupabase();
    const membership = await this.membership(orgId, membershipId);
    if (membership.role === 'owner') {
      throw new UserError("The owner's role cannot be changed. The owner can transfer ownership instead.");
    }
    if ((membership.role === 'admin' || role === 'admin') && actorRole !== 'owner') {
      throw new UserError('Only the owner adds or changes administrators.', 403);
    }
    const { error } = await supabase
      .from('memberships')
      .update({ role })
      .eq('id', membershipId)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  static async removeMember(orgId: string, membershipId: string, actorRole: OrganizationRole): Promise<void> {
    const supabase = getSupabase();
    const membership = await this.membership(orgId, membershipId);
    if (membership.role === 'owner') {
      throw new UserError('The owner cannot be removed. The owner can transfer ownership instead.');
    }
    if (membership.role === 'admin' && actorRole !== 'owner') {
      throw new UserError('Only the owner removes administrators.', 403);
    }
    const { error } = await supabase
      .from('memberships')
      .delete()
      .eq('id', membershipId)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  static async transferOwnership(orgId: string, membershipId: string, actor: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('transfer_ownership', {
      p_org_id: orgId,
      p_new_owner_membership_id: membershipId,
      p_actor: actor,
    });
    if (error) throw error;
  }

  static async leave(orgId: string, userId: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('leave_organization', { p_org_id: orgId, p_user_id: userId });
    if (error) throw error;
  }
}
