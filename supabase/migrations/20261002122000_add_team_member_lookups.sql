-- Inviting a team member paged through every user in the whole Supabase
-- project, across all companies, 200 at a time, to find one email address.
-- That is one Worker subrequest per 200 users, so invitations failed outright
-- once the project held about 10,000 users (the Workers Free plan allows 50
-- subrequests per request). Listing a team called the Auth API once per
-- member.
--
-- These two lookups answer each question in one query. They read auth.users,
-- so they run with their owner's rights, and only the Worker's service role
-- may call them.

CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  -- Supabase Auth stores email addresses in lower case.
  SELECT auth_user.id
  FROM auth.users AS auth_user
  WHERE auth_user.email = pg_catalog.lower(pg_catalog.btrim(p_email))
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.organization_member_emails(p_org_id UUID)
RETURNS TABLE (user_id UUID, email TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT membership.user_id, auth_user.email::TEXT
  FROM public.memberships AS membership
  JOIN auth.users AS auth_user ON auth_user.id = membership.user_id
  WHERE membership.org_id = p_org_id
  ORDER BY membership.user_id;
$function$;

REVOKE ALL ON FUNCTION public.auth_user_id_by_email(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organization_member_emails(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.organization_member_emails(UUID) TO service_role;

-- Rollback:
-- DROP FUNCTION public.organization_member_emails(UUID);
-- DROP FUNCTION public.auth_user_id_by_email(TEXT);
