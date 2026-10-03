import { OrganizationService } from '../../src/server/organizations';
import { OnboardingService } from '../../src/server/onboarding';
import { TeamService } from '../../src/server/team';
import { bodyOf, DAY, enforceRateLimits, respondError } from '../http';
import { onboardingSchema, organizationCreateSchema, organizationUpdateSchema, uuid } from '../schemas';
import { requireOrganizationAdministrator, requireRequestedOrganization } from '../auth';
import type { Api } from './types';

/** The signed-in person's own state: onboarding, organizations, invitations, membership. */
export function registerOrganizationRoutes(api: Api) {
  api.get('/onboarding', async (c) => {
    try {
      return c.json(await OnboardingService.getState(c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/onboarding', async (c) => {
    try {
      const state = onboardingSchema.parse(await bodyOf(c));
      return c.json(await OnboardingService.updateState(c.get('userId'), state as any));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/organizations', async (c) => {
    try {
      return c.json({ organizations: await OrganizationService.getOrganizations(c.get('userId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/organizations', async (c) => {
    try {
      const body = organizationCreateSchema.parse(await bodyOf(c));
      await enforceRateLimits(
        [{ key: `org-create:user:${c.get('userId')}`, limit: 5, windowSeconds: DAY }],
        'You have created several organizations today. Try again tomorrow.',
      );
      const id = await OrganizationService.createOrganization(body as any, c.get('userId'));
      return c.json({ id, message: 'Organization created.' });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/organizations/:id', requireRequestedOrganization, async (c) => {
    try {
      const org = await OrganizationService.getOrganization(c.get('orgId'));
      if (!org) return c.json({ error: 'Organization not found.' }, 404);
      return c.json({ organization: org });
    } catch (err) { return respondError(c, err); }
  });

  api.put('/organizations/:id', requireRequestedOrganization, requireOrganizationAdministrator, async (c) => {
    try {
      const body = organizationUpdateSchema.parse(await bodyOf(c));
      await OrganizationService.updateOrganization(c.get('orgId'), body as any);
      return c.json({ success: true, message: 'Organization updated.' });
    } catch (err) { return respondError(c, err); }
  });

  // Invitations addressed to the signed-in person's confirmed email.
  api.get('/invitations', async (c) => {
    try {
      return c.json({ invitations: await TeamService.myInvitations(c.get('userId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/invitations/:id/accept', async (c) => {
    try {
      const invitationId = uuid.parse(c.req.param('id'));
      return c.json(await TeamService.respond(invitationId, c.get('userId'), true));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/invitations/:id/decline', async (c) => {
    try {
      const invitationId = uuid.parse(c.req.param('id'));
      return c.json(await TeamService.respond(invitationId, c.get('userId'), false));
    } catch (err) { return respondError(c, err); }
  });

  // Leaving the active organization; open to every role but the owner.
  api.post('/membership/leave', async (c) => {
    try {
      await TeamService.leave(c.get('orgId'), c.get('userId'));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
}
