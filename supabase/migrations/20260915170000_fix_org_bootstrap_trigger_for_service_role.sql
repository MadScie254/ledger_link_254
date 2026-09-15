-- CRITICAL BUG: handle_new_organization() (from
-- fix_organization_signup_bootstrap) inserts the founding membership using
-- (SELECT auth.uid()) as user_id. That resolves correctly only when the
-- INSERT runs through a real user's JWT-authenticated PostgREST session.
-- Every organization created via this app's Express server goes through
-- the SERVICE ROLE key instead (src/server/supabase.ts), where auth.uid()
-- is always NULL — so the trigger tried to insert a NULL user_id, violated
-- the memberships NOT NULL constraint, and rolled back the entire
-- organization insert. Nobody could ever create their first organization
-- through the actual app.
--
-- OrganizationService.createOrganization (src/server/organizations.ts)
-- already explicitly inserts the correct membership row with the real
-- owner id right after creating the org — so when auth.uid() is unavailable
-- (service-role context), the trigger should simply do nothing and let the
-- application layer handle it, rather than fail the whole insert.

CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (NEW.id, auth.uid(), 'owner')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
