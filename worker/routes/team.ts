import { TeamService } from '../../src/server/team';
import { PlanService } from '../../src/server/plans';
import { bodyOf, DAY, enforceRateLimits, respondError } from '../http';
import { inviteSchema, roleSchema, uuid } from '../schemas';
import { requireOrganizationAdministrator, requireOrganizationOwner } from '../auth';
import type { Api } from './types';

export function registerTeamRoutes(api: Api) {
  api.get('/plan', async (c) => {
    try {
      const result = await PlanService.snapshot(c.get('orgId'));
      return c.json({ subscription: result?.snapshot || null });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/team', async (c) => {
    try {
      const team = await TeamService.getTeam(c.get('orgId'), c.get('userId'));
      // Pending invitations show email addresses of people outside the team:
      // administrators manage them, others see members only.
      const canManage = c.get('orgRole') === 'owner' || c.get('orgRole') === 'admin';
      return c.json({ members: team.members, invitations: canManage ? team.invitations : [] });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/team', requireOrganizationAdministrator, async (c) => {
    try {
      const body = inviteSchema.parse(await bodyOf(c));
      await PlanService.ensureCanInvite(c.get('orgId'), body.email);
      await enforceRateLimits(
        [
          { key: `invite:org:${c.get('orgId')}`, limit: 30, windowSeconds: DAY },
          { key: `invite:user:${c.get('userId')}`, limit: 50, windowSeconds: DAY },
        ],
        'That is the most invitations for one day. Try again tomorrow.',
      );
      return c.json(await TeamService.invite(c.get('orgId'), body.email, body.role, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.delete('/team/invitations/:id', requireOrganizationAdministrator, async (c) => {
    try {
      await TeamService.revokeInvitation(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId'));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/team/:id', requireOrganizationAdministrator, async (c) => {
    try {
      const body = roleSchema.parse(await bodyOf(c));
      await TeamService.updateMemberRole(c.get('orgId'), uuid.parse(c.req.param('id')), body.role, c.get('orgRole'));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.delete('/team/:id', requireOrganizationAdministrator, async (c) => {
    try {
      await TeamService.removeMember(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('orgRole'));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/team/:id/transfer-ownership', requireOrganizationOwner, async (c) => {
    try {
      await TeamService.transferOwnership(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId'));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
}
