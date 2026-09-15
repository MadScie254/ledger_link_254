import { getSupabase } from './supabase';
import { AuditService } from './audit';
import type { OrganizationRole } from '../../worker/auth';

export interface TeamMemberInput {
  orgId: string;
  email: string;
  role: 'admin' | 'member';
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

    const members = await Promise.all(
      memberships.map(async (m) => {
        let email = m.user_id;
        try {
          const { data: userData } = await supabase.auth.admin.getUserById(m.user_id);
          if (userData?.user?.email) email = userData.user.email;
        } catch {
          // Fall back to showing the user id if the auth lookup fails
        }

        return {
          id: m.id,
          userId: m.user_id,
          email,
          role: m.role as OrganizationRole,
          status: 'Active' as const,
          isYou: m.user_id === currentUserId,
        };
      })
    );

    return members;
  }

  static async addMember(input: TeamMemberInput): Promise<string> {
    const supabase = getSupabase();
    const email = input.email.trim().toLowerCase();

    if (!email || !email.includes('@')) {
      throw new Error('A valid email address is required.');
    }
    if (input.role !== 'admin' && input.role !== 'member') {
      throw new Error('Role must be either admin or member.');
    }

    // Try to find an existing Supabase Auth user with this email first —
    // inviteUserByEmail errors if the user already exists.
    let userId: string | null = null;
    let page = 1;
    while (!userId) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const users = data.users as Array<{ id: string; email?: string }>;
      const match = users.find((u) => u.email?.toLowerCase() === email);
      if (match) userId = match.id;
      if (users.length < 200) break; // last page
      page += 1;
    }

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

  static async updateMemberRole(orgId: string, membershipId: string, role: 'admin' | 'member', updatedBy?: string): Promise<void> {
    const supabase = getSupabase();
    if (role !== 'admin' && role !== 'member') {
      throw new Error('Role must be either admin or member.');
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
