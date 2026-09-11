-- CRITICAL FUNCTIONAL BUG: there was no way for anyone to ever finish signing up. Creating an
-- organization succeeded, but organizations_select_policy requires an existing membership row to
-- see it, and memberships_insert_policy requires user_is_org_admin() to insert a membership —
-- which is impossible for a brand-new org with zero members. Nobody could become the first owner
-- of their own org. Fix: a trigger auto-creates the founding 'owner' membership right after the
-- organization is inserted, running with elevated privilege so it isn't subject to the
-- admin-only membership policy.

CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (NEW.id, (SELECT auth.uid()), 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_organization_created ON public.organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_organization();

-- Also wire up the updated_at trigger that already existed as a function but was never attached
-- to any table, so organizations.updated_at was frozen at creation time forever.
DROP TRIGGER IF EXISTS set_organizations_updated_at ON public.organizations;
CREATE TRIGGER set_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Tighten organizations_insert_policy: it currently has no auth check at all (with_check: true),
-- meaning even an anonymous, logged-out request could create organization rows. Restrict to
-- authenticated users only.
DROP POLICY IF EXISTS organizations_insert_policy ON public.organizations;
CREATE POLICY organizations_insert_policy ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- Fix the RLS initplan performance warning on organizations_select_policy while we're in here.
DROP POLICY IF EXISTS organizations_select_policy ON public.organizations;
CREATE POLICY organizations_select_policy ON public.organizations
  FOR SELECT
  USING (id IN (SELECT memberships.org_id FROM memberships WHERE memberships.user_id = (SELECT auth.uid())));
