-- The accountant role (20260928150000_add_accountant_membership_role.sql) was
-- meant to post to the books like an admin, and the Worker already lets it
-- write (worker/auth.ts). But private.require_financial_actor, which every
-- posting workflow calls (journals, invoices, bills, invoice and bill
-- payments, both voids, and payroll), still admitted only owner and admin,
-- so every post by an accountant was refused by the database.
--
-- This admits accountant to the financial guard only. Administering the
-- organization (settings, invitations, roles) stays owner and admin, through
-- public.user_is_org_admin and the Worker's requireOrganizationAdministrator,
-- neither of which changes here.

CREATE OR REPLACE FUNCTION private.require_financial_actor(
  p_org_id UUID,
  p_actor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_authenticated_user UUID := auth.uid();
  v_role public.membership_role;
BEGIN
  IF p_org_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Organization and actor are required.' USING ERRCODE = '22023';
  END IF;

  IF v_authenticated_user IS NOT NULL AND v_authenticated_user IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'The financial actor must match the authenticated user.' USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
  INTO v_role
  FROM public.memberships AS membership
  WHERE membership.org_id = p_org_id
    AND membership.user_id = p_actor_id;

  IF NOT FOUND OR v_role NOT IN ('owner', 'admin', 'accountant') THEN
    RAISE EXCEPTION 'An organization owner, administrator or accountant is required.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.require_financial_actor(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- Rollback: re-run the CREATE OR REPLACE above with
-- v_role NOT IN ('owner', 'admin') and the earlier message,
-- 'An organization owner or administrator is required.'
