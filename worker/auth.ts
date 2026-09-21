import type { Context, Next } from 'hono';
import { getSupabase } from '../src/server/supabase';

// Must match the public.membership_role Postgres enum exactly
// (supabase/migrations/20260829221831_001_core_tables.sql).
export type OrganizationRole = 'owner' | 'admin' | 'member';

export type Variables = {
  userId: string;
  orgId: string;
  orgRole: OrganizationRole;
};

const writeRoles = new Set<OrganizationRole>(['owner', 'admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUserScopedRequest(c: Context) {
  const path = new URL(c.req.url).pathname;
  return (
    (path === '/api/organizations' && (c.req.method === 'GET' || c.req.method === 'POST')) ||
    (path === '/api/onboarding' && (c.req.method === 'GET' || c.req.method === 'PATCH'))
  );
}

/**
 * Verifies the Supabase access token with Supabase Auth, then confirms that
 * the user belongs to the requested organization before a service-role
 * query runs. The organization header is a selector only; it is never
 * trusted as authority.
 */
export async function requireAuthenticationAndOrganization(c: Context<{ Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token) {
    return c.json({ error: 'Authentication is required.' }, 401);
  }

  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;

  if (authError || !user) {
    return c.json({ error: 'Invalid or expired authentication token.' }, 401);
  }

  c.set('userId', user.id);

  // Personal onboarding and organization collection requests are authenticated
  // but do not require an existing organization selection.
  if (isUserScopedRequest(c)) {
    return next();
  }

  const requestedOrgId = c.req.header('x-org-id');
  if (!requestedOrgId) {
    return c.json({ error: 'Missing x-org-id header.' }, 400);
  }
  if (!UUID_PATTERN.test(requestedOrgId)) {
    return c.json({ error: 'Invalid x-org-id header.' }, 400);
  }

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', requestedOrgId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    console.error('[Auth] Failed to verify organization membership:', membershipError);
    return c.json({ error: 'Failed to verify organization membership.' }, 500);
  }

  const role = membership?.role?.toLowerCase() as OrganizationRole | undefined;
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return c.json({ error: 'You do not have access to this organization.' }, 403);
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !writeRoles.has(role)) {
    return c.json({ error: 'Your organization role cannot modify data.' }, 403);
  }

  c.set('orgId', requestedOrgId);
  c.set('orgRole', role);
  await next();
}

export async function requireOrganizationAdministrator(c: Context<{ Variables: Variables }>, next: Next) {
  const orgRole = c.get('orgRole');
  if (orgRole !== 'owner' && orgRole !== 'admin') {
    return c.json({ error: 'An organization owner or admin role is required.' }, 403);
  }
  await next();
}

export async function requireRequestedOrganization(c: Context<{ Variables: Variables }>, next: Next) {
  if (c.req.param('id') !== c.get('orgId')) {
    return c.json({ error: 'The requested organization does not match the active organization.' }, 403);
  }
  await next();
}
