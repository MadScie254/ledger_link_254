import type { Context, Next } from 'hono';
import { getSupabase } from '../src/server/supabase';
import { runWithRequestContext } from '../src/server/requestContext';

// Must match the public.membership_role Postgres enum exactly
// (supabase/migrations/20260829221831_001_core_tables.sql, extended by
// 20260928150000_add_accountant_membership_role.sql).
export type OrganizationRole = 'owner' | 'admin' | 'member' | 'accountant';

export type Variables = {
  userId: string;
  orgId: string;
  orgRole: OrganizationRole;
};

// An accountant posts to the books like an admin, but never administers the
// organization: requireOrganizationAdministrator below stays owner/admin
// only, so team management and organization settings are unaffected.
const writeRoles = new Set<OrganizationRole>(['owner', 'admin', 'accountant']);
const ALL_ROLES: readonly OrganizationRole[] = ['owner', 'admin', 'member', 'accountant'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const INVITATION_RESPONSE = new RegExp(`^/api/invitations/${UUID_SEGMENT}/(accept|decline)$`, 'i');

/** Requests about the signed-in person themselves, not one organization. */
function isUserScopedRequest(c: Context) {
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  return (
    (path === '/api/organizations' && (method === 'GET' || method === 'POST')) ||
    (path === '/api/onboarding' && (method === 'GET' || method === 'PATCH')) ||
    (path === '/api/invitations' && method === 'GET') ||
    (INVITATION_RESPONSE.test(path) && method === 'POST')
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

  // Everything the request does from here on is attributed to this person,
  // and anything it posts is tagged with the class and location it names
  // (the database checks they are this organization's and active).
  const tag = (name: string) => {
    const value = c.req.header(name)?.trim();
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  };
  return runWithRequestContext(
    { actorId: user.id, classId: tag('x-ledger-class'), locationId: tag('x-ledger-location') },
    () => selectOrganization(c, next, user.id),
  );
}

async function selectOrganization(c: Context<{ Variables: Variables }>, next: Next, userId: string) {
  // Personal onboarding, invitation and organization collection requests are
  // authenticated but do not require an existing organization selection.
  if (isUserScopedRequest(c)) {
    return next();
  }
  const supabase = getSupabase();

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
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) {
    console.error('[Auth] Failed to verify organization membership:', membershipError);
    return c.json({ error: 'Failed to verify organization membership.' }, 500);
  }

  const role = membership?.role?.toLowerCase() as OrganizationRole | undefined;
  if (!role || !ALL_ROLES.includes(role)) {
    return c.json({ error: 'You do not have access to this organization.' }, 403);
  }

  // A read-only member may leave the organization, and may ask a question
  // about the books (a POST only because the question is in the body).
  const pathname = new URL(c.req.url).pathname;
  const isMemberPost = c.req.method === 'POST' && (
    pathname === '/api/membership/leave' || pathname === '/api/ai/ask'
    || pathname === '/api/court-events/calendar-token'
  );
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !writeRoles.has(role) && !isMemberPost) {
    return c.json({ error: 'Your organization role cannot modify data.' }, 403);
  }

  c.set('orgId', requestedOrgId);
  c.set('orgRole', role);
  await next();
}

export async function requireOrganizationOwner(c: Context<{ Variables: Variables }>, next: Next) {
  if (c.get('orgRole') !== 'owner') {
    return c.json({ error: 'Only the organization owner can do this.' }, 403);
  }
  await next();
}

export async function requireOrganizationAdministrator(c: Context<{ Variables: Variables }>, next: Next) {
  const orgRole = c.get('orgRole');
  if (orgRole !== 'owner' && orgRole !== 'admin') {
    return c.json({ error: 'An organization owner or admin role is required.' }, 403);
  }
  await next();
}

/**
 * Salaries, KRA PINs, bank details and payslips are personal data. The
 * read-only member role reads the books but not payroll; owners, admins and
 * accountants, who run payroll, can.
 */
export async function requirePayrollAccess(c: Context<{ Variables: Variables }>, next: Next) {
  if (!writeRoles.has(c.get('orgRole'))) {
    return c.json({ error: 'Payroll and employee records are open to the owner, administrators and accountants only.' }, 403);
  }
  await next();
}

export async function requireRequestedOrganization(c: Context<{ Variables: Variables }>, next: Next) {
  if (c.req.param('id') !== c.get('orgId')) {
    return c.json({ error: 'The requested organization does not match the active organization.' }, 403);
  }
  await next();
}
