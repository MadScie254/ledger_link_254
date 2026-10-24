// A church's giving page through the Worker's routes and PostgREST: an owner
// makes the link, anyone opens the page without signing in, and a
// withdrawn link stops working.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { OrganizationService } from '../../src/server/organizations';
import { registerChurchRoutes } from '../../worker/routes/church';
import { registerInvoiceLinkPublicRoutes } from '../../worker/routes/invoiceLinks';
import { OWNER, sql } from './helpers';

test('an owner shares the giving page and anyone opens it', async () => {
  const church = await OrganizationService.createOrganization({ name: 'St Mark Parish', country: 'Kenya', edition: 'church' } as any, OWNER);
  const apiAs = (role: string) => {
    const api = new Hono<any>();
    api.use('*', async (c, next) => { c.set('orgId', church); c.set('userId', OWNER); c.set('orgRole', role); await next(); });
    registerChurchRoutes(api);
    return api;
  };
  const publicApp = new Hono<any>();
  registerInvoiceLinkPublicRoutes(publicApp);

  assert.equal((await apiAs('accountant').request('/church/giving-page', { method: 'POST' })).status, 403);
  const made = await (await apiAs('owner').request('/church/giving-page', { method: 'POST' })).json();
  assert.match(made.url, /^http:\/\/localhost\/give\/[0-9a-f]{64}$/);
  const token = made.url.split('/').at(-1);

  sql(`INSERT INTO public.org_integrations (org_id, kind, shortcode, environment, status, callback_token_hash, created_by)
    VALUES ('${church}', 'MPESA_C2B', '247247', 'SANDBOX', 'REGISTERED', repeat('0', 64), '${OWNER}')`);
  const page = await (await publicApp.request(`/api/public/give/${token}`)).json();
  assert.equal(page.church, 'St Mark Parish');
  assert.equal(page.paybill, '247247');
  assert.ok(page.ways.some((way: any) => way.kind === 'MEMBER_NUMBER'), 'member numbers are a way to give');

  assert.deepEqual(await (await apiAs('owner').request('/church/giving-page', { method: 'DELETE' })).json(), { withdrawn: true });
  assert.equal((await publicApp.request(`/api/public/give/${token}`)).status, 404);
});
