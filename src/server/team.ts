import { getSupabase } from './supabase';
import { AuditService } from './audit';
import type { OrganizationRole } from '../../worker/auth';

const ASSIGNABLE_ROLES = new Set(['admin', 'member', 'accountant']);
type AssignableRole = 'admin' | 'member' | 'accountant';

export interface TeamMemberInput {
  orgId: string;
  email: string;
  role: AssignableRole;
  invitedBy?: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: OrganizationRole;
  status: 'Active' | 'Invited';
  isYou: boolean;
}

export class TeamService {
  static async getMembers(orgId: string, currentUserId?: string): Promise<TeamMember[]> {
    const supabase = getSupabase();

    const { data: memberships, error } = await supabase
      .from('memberships')
      .select('id, user_id, role, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!memberships || memberships.length === 0) return [];

    // One query for every member's email, instead of one Auth API call each.
    const { data: emailRows, error: emailError } = await supabase.rpc('organization_member_emails', { p_org_id: orgId });
    if (emailError) throw emailError;
    const emailByUserId = new Map<string, string>(
      ((emailRows || []) as Array<{ user_id: string; email: string | null }>).map((row) => [row.user_id, row.email || row.user_id]),
    );

    return memberships.map((m) => ({
      id: m.id,
      userId: m.user_id,
      email: emailByUserId.get(m.user_id) || m.user_id,
      role: m.role as OrganizationRole,
      status: 'Active' as const,
      isYou: m.user_id === currentUserId,
    }));
  }

  static async addMember(input: TeamMemberInput): Promise<string> {
    const supabase = getSupabase();
    const email = String(input.email ?? '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      throw new Error('A valid email address is required.');
    }
    if (!ASSIGNABLE_ROLES.has(input.role)) {
      throw new Error('Role must be admin, member or accountant.');
    }

    // Find an existing Supabase Auth user with this email first, since
    // inviteUserByEmail errors if the user already exists. One indexed
    // lookup; paging through every user in the project, across all
    // companies, took one Worker subrequest per 200 users.
    const { data: existingUserId, error: lookupError } = await supabase.rpc('auth_user_id_by_email', { p_email: email });
    if (lookupError) throw lookupError;
    let userId: string | null = typeof existingUserId === 'string' ? existingUserId : null;

    if (!userId) {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
      if (error) throw new Error(`Failed to invite ${email}: ${error.message}`);
      userId = data.user.id;
    }

    const { data: existingMembership } = await supabase
      .from('memberships')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingMembership) {
      throw new Error(`${email} is already a member of this organization.`);
    }

    const { data: newMembership, error: membershipError } = await supabase
      .from('memberships')
      .insert({ org_id: input.orgId, user_id: userId, role: input.role })
      .select('id')
      .single();

    if (membershipError) throw membershipError;

    if (input.invitedBy) {
      await AuditService.logEvent({
        orgId: input.orgId,
        userId: input.invitedBy,
        action: 'CREATE',
        resourceType: 'TEAM_MEMBER',
        resourceId: newMembership.id,
        details: { email, role: input.role }
      });
    }

    return newMembership.id;
  }

  static async updateMemberRole(orgId: string, membershipId: string, role: AssignableRole, updatedBy?: string): Promise<void> {
    const supabase = getSupabase();
    if (!ASSIGNABLE_ROLES.has(role)) {
      throw new Error('Role must be admin, member or accountant.');
    }

    const { data: membership, error: fetchError } = await supabase
      .from('memberships')
      .select('role')
      .eq('id', membershipId)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !membership) throw new Error('Team member not found.');
    if (membership.role === 'owner') {
      throw new Error("The organization owner's role cannot be changed.");
    }

    const { error } = await supabase
      .from('memberships')
      .update({ role })
      .eq('id', membershipId)
      .eq('org_id', orgId);

    if (error) throw error;

    if (updatedBy) {
      await AuditService.logEvent({
        orgId,
        userId: updatedBy,
        action: 'UPDATE',
        resourceType: 'TEAM_MEMBER',
        resourceId: membershipId,
        details: { role }
      });
    }
  }

  static async removeMember(orgId: string, membershipId: string, removedBy?: string): Promise<void> {
    const supabase = getSupabase();

    const { data: membership, error: fetchError } = await supabase
      .from('memberships')
      .select('role, user_id')
      .eq('id', membershipId)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !membership) throw new Error('Team member not found.');
    if (membership.role === 'owner') {
      throw new Error('The organization owner cannot be removed.');
    }

    const { error } = await supabase
      .from('memberships')
      .delete()
      .eq('id', membershipId)
      .eq('org_id', orgId);

    if (error) throw error;

    if (removedBy) {
      await AuditService.logEvent({
        orgId,
        userId: removedBy,
        action: 'DELETE',
        resourceType: 'TEAM_MEMBER',
        resourceId: membershipId,
        details: {}
      });
    }
  }
}
