import type { NextFunction, Request, Response } from 'express';
import { getSupabase } from './supabase';

// Must match the public.membership_role Postgres enum exactly
// (supabase/migrations/20260829221831_001_core_tables.sql) — 'editor'/'viewer'
// were never valid enum values, so any membership row other than 'owner' or
// 'admin' would previously fail the role check below and get a 403 despite
// being a legitimate member.
export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  orgId?: string;
  orgRole?: OrganizationRole;
}

const writeRoles = new Set<OrganizationRole>(['owner', 'admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOrganizationCollectionRequest(req: Request) {
  return req.path === '/organizations' && (req.method === 'GET' || req.method === 'POST');
}

/**
 * Verifies the Supabase access token with Supabase Auth, then confirms that the
 * user belongs to the requested organization before a service-role query runs.
 * The organization header is a selector only; it is never trusted as authority.
 */
export async function requireAuthenticationAndOrganization(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ error: 'Authentication is required.' });
  }

  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData.user;

  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }

  req.userId = user.id;

  // Users can list their organizations or create their first one without an
  // existing organization selection.
  if (isOrganizationCollectionRequest(req)) {
    return next();
  }

  const requestedOrgId = req.headers['x-org-id'];
  if (typeof requestedOrgId !== 'string' || !requestedOrgId) {
    return res.status(400).json({ error: 'Missing x-org-id header.' });
  }
  if (!UUID_PATTERN.test(requestedOrgId)) {
    // Not a real org id (e.g. a client sent a placeholder before an
    // organization was selected) — reject cleanly instead of letting an
    // invalid UUID hit Postgres and surface as a raw 500.
    return res.status(400).json({ error: 'Invalid x-org-id header.' });
  }

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', requestedOrgId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    console.error('[Auth] Failed to verify organization membership:', membershipError);
    return res.status(500).json({ error: 'Failed to verify organization membership.' });
  }

  const role = membership?.role?.toLowerCase() as OrganizationRole | undefined;
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return res.status(403).json({ error: 'You do not have access to this organization.' });
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !writeRoles.has(role)) {
    return res.status(403).json({ error: 'Your organization role cannot modify data.' });
  }

  req.orgId = requestedOrgId;
  req.orgRole = role;
  next();
}

export function requireOrganizationAdministrator(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.orgRole !== 'owner' && req.orgRole !== 'admin') {
    return res.status(403).json({ error: 'An organization owner or admin role is required.' });
  }

  next();
}

export function requireRequestedOrganization(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.params.id !== req.orgId) {
    return res.status(403).json({ error: 'The requested organization does not match the active organization.' });
  }

  next();
}
