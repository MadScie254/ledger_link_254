-- Invitations that need consent, leaving an organization, atomic
-- organization creation and ownership transfer.
--
-- An administrator used to add any existing account to their organization
-- directly, with no acceptance, and a member could not leave. Anyone who
-- signed up could therefore place their organization in another person's
-- company list. Invitations are now pending until the invited person,
-- signed in with that confirmed email address, accepts them.
--
-- Creating an organization was three separate writes (the organization, the
-- owner's membership, the chart of accounts); a failure part-way left an
-- organization without accounts and a retry made a duplicate.
-- public.create_organization does all three in one transaction, keyed so a
-- retry returns the same organization, and limits how many organizations one
-- person can own.

CREATE TABLE public.organization_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         public.membership_role NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT organization_invitations_email_check
    CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND length(email) <= 320),
  CONSTRAINT organization_invitations_role_check CHECK (role IN ('admin', 'member', 'accountant')),
  CONSTRAINT organization_invitations_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED'))
);

CREATE UNIQUE INDEX organization_invitations_pending_key
  ON public.organization_invitations(org_id, email) WHERE status = 'PENDING';
CREATE INDEX idx_organization_invitations_email ON public.organization_invitations(email) WHERE status = 'PENDING';

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.organization_invitations TO service_role;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creation_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_creator_creation_key
  ON public.organizations(created_by, creation_key) WHERE creation_key IS NOT NULL;

-- The role a person holds in an organization, or NULL.
CREATE OR REPLACE FUNCTION private.member_role(p_org_id UUID, p_user_id UUID)
RETURNS public.membership_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT membership.role FROM public.memberships AS membership
  WHERE membership.org_id = p_org_id AND membership.user_id = p_user_id;
$function$;

REVOKE ALL ON FUNCTION private.member_role(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- The confirmed email address of an account, lower case, or NULL.
CREATE OR REPLACE FUNCTION private.confirmed_email(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT lower(auth_user.email::TEXT) FROM auth.users AS auth_user
  WHERE auth_user.id = p_user_id AND auth_user.email_confirmed_at IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION private.confirmed_email(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.invite_member(
  p_org_id UUID,
  p_email TEXT,
  p_role TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email TEXT := lower(btrim(COALESCE(p_email, '')));
  v_actor_role public.membership_role := private.member_role(p_org_id, p_actor);
  v_existing UUID;
  v_id UUID;
  v_has_account BOOLEAN;
BEGIN
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator invites people.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'member', 'accountant') THEN
    RAISE EXCEPTION 'Role must be admin, member or accountant.' USING ERRCODE = '22023';
  END IF;
  IF p_role = 'admin' AND v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner invites administrators.' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'A valid email address is required.' USING ERRCODE = '22023';
  END IF;

  SELECT membership.id INTO v_existing
  FROM public.memberships AS membership
  JOIN auth.users AS auth_user ON auth_user.id = membership.user_id
  WHERE membership.org_id = p_org_id AND lower(auth_user.email::TEXT) = v_email;
  IF FOUND THEN
    RAISE EXCEPTION '% is already a member of this organization.', v_email USING ERRCODE = '23505';
  END IF;

  SELECT invitation.id INTO v_existing
  FROM public.organization_invitations AS invitation
  WHERE invitation.org_id = p_org_id AND invitation.email = v_email AND invitation.status = 'PENDING';
  IF FOUND THEN
    UPDATE public.organization_invitations SET role = p_role::public.membership_role
    WHERE id = v_existing;
    v_id := v_existing;
  ELSE
    INSERT INTO public.organization_invitations (org_id, email, role, invited_by)
    VALUES (p_org_id, v_email, p_role::public.membership_role, p_actor)
    RETURNING id INTO v_id;
  END IF;

  v_has_account := EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE lower(auth_user.email::TEXT) = v_email);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'INVITE', 'TEAM_MEMBER', v_id, jsonb_build_object('email', v_email, 'role', p_role));

  RETURN jsonb_build_object('invitationId', v_id, 'hasAccount', v_has_account);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_invitation(
  p_org_id UUID,
  p_invitation_id UUID,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_role public.membership_role := private.member_role(p_org_id, p_actor);
  v_email TEXT;
BEGIN
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator withdraws invitations.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_invitations
  SET status = 'REVOKED', responded_at = now(), responded_by = p_actor
  WHERE org_id = p_org_id AND id = p_invitation_id AND status = 'PENDING'
  RETURNING email INTO v_email;
  IF FOUND THEN
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
    VALUES (p_org_id, p_actor, 'REVOKE', 'TEAM_MEMBER', p_invitation_id, jsonb_build_object('email', v_email));
  END IF;
END;
$function$;

-- Invitations waiting for this person, found by their confirmed email.
CREATE OR REPLACE FUNCTION public.pending_invitations(p_user_id UUID)
RETURNS TABLE (invitation_id UUID, org_id UUID, organization_name TEXT, role TEXT, invited_by_email TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT invitation.id, invitation.org_id, org.name, invitation.role::TEXT, inviter.email::TEXT, invitation.created_at
  FROM public.organization_invitations AS invitation
  JOIN public.organizations AS org ON org.id = invitation.org_id
  LEFT JOIN auth.users AS inviter ON inviter.id = invitation.invited_by
  WHERE invitation.status = 'PENDING'
    AND invitation.email = private.confirmed_email(p_user_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.memberships AS membership
      WHERE membership.org_id = invitation.org_id AND membership.user_id = p_user_id
    )
  ORDER BY invitation.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_invitation(
  p_invitation_id UUID,
  p_user_id UUID,
  p_accept BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invitation RECORD;
  v_email TEXT := private.confirmed_email(p_user_id);
BEGIN
  SELECT invitation.id, invitation.org_id, invitation.email, invitation.role, invitation.status
  INTO v_invitation
  FROM public.organization_invitations AS invitation
  WHERE invitation.id = p_invitation_id
  FOR UPDATE;
  IF NOT FOUND OR v_email IS NULL OR v_invitation.email <> v_email THEN
    RAISE EXCEPTION 'This invitation is not addressed to your confirmed email address.' USING ERRCODE = '42501';
  END IF;
  IF v_invitation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This invitation is no longer open.' USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_actor(p_user_id);
  UPDATE public.organization_invitations
  SET status = CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'DECLINED' END,
      responded_at = now(), responded_by = p_user_id
  WHERE id = p_invitation_id;

  IF p_accept THEN
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_invitation.org_id, p_user_id, v_invitation.role)
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('orgId', v_invitation.org_id, 'accepted', p_accept);
END;
$function$;

-- Anyone but the owner can leave; the owner transfers ownership first.
CREATE OR REPLACE FUNCTION public.leave_organization(p_org_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.membership_role := private.member_role(p_org_id, p_user_id);
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'The owner cannot leave. Transfer ownership to another member first.' USING ERRCODE = '23514';
  END IF;
  PERFORM private.set_actor(p_user_id);
  DELETE FROM public.memberships WHERE org_id = p_org_id AND user_id = p_user_id;
END;
$function$;

-- The owner hands the organization to another member; the old owner becomes
-- an administrator.
CREATE OR REPLACE FUNCTION public.transfer_ownership(
  p_org_id UUID,
  p_new_owner_membership_id UUID,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_target RECORD;
BEGIN
  IF private.member_role(p_org_id, p_actor) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner transfers ownership.' USING ERRCODE = '42501';
  END IF;
  SELECT membership.id, membership.user_id, membership.role INTO v_target
  FROM public.memberships AS membership
  WHERE membership.org_id = p_org_id AND membership.id = p_new_owner_membership_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team member not found.' USING ERRCODE = '23503';
  END IF;
  IF v_target.user_id = p_actor THEN
    RETURN;
  END IF;
  PERFORM private.set_actor(p_actor);
  UPDATE public.memberships SET role = 'admin' WHERE org_id = p_org_id AND user_id = p_actor;
  UPDATE public.memberships SET role = 'owner' WHERE org_id = p_org_id AND id = p_new_owner_membership_id;
END;
$function$;

-- One transaction: the organization, its owner and its chart of accounts.
-- p_organization: name, legalName, baseCurrency, country, taxId,
-- fiscalYearStart, industry, businessType, themeAccent, address, city,
-- phone, email, website. p_accounts: [{code, name, type, currency,
-- isBankAccount}].
CREATE OR REPLACE FUNCTION public.create_organization(
  p_owner UUID,
  p_organization JSONB,
  p_accounts JSONB,
  p_creation_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_org_id UUID;
  v_owned INTEGER;
  v_name TEXT := NULLIF(btrim(COALESCE(p_organization ->> 'name', '')), '');
  v_currency TEXT := upper(btrim(COALESCE(p_organization ->> 'baseCurrency', 'KES')));
BEGIN
  IF p_owner IS NULL THEN
    RAISE EXCEPTION 'An owner is required.' USING ERRCODE = '22023';
  END IF;
  IF p_creation_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::TEXT || ':org:' || p_creation_key, 0));
    SELECT org.id INTO v_org_id FROM public.organizations AS org
    WHERE org.created_by = p_owner AND org.creation_key = p_creation_key;
    IF FOUND THEN
      RETURN v_org_id;
    END IF;
  END IF;
  IF v_name IS NULL OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'An organization name of up to 200 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Base currency must be a three-letter ISO code, such as KES.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_owned FROM public.memberships WHERE user_id = p_owner AND role = 'owner';
  IF v_owned >= 25 THEN
    RAISE EXCEPTION 'One person can own at most 25 organizations.' USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_actor(p_owner);
  INSERT INTO public.organizations (
    name, legal_name, base_currency, country, tax_id, fiscal_year_start, industry, business_type,
    theme_accent, address, city, phone, email, website, is_default, is_demo, created_by, creation_key
  ) VALUES (
    v_name,
    COALESCE(NULLIF(btrim(p_organization ->> 'legalName'), ''), v_name),
    v_currency,
    COALESCE(NULLIF(btrim(p_organization ->> 'country'), ''), 'Kenya'),
    COALESCE(btrim(p_organization ->> 'taxId'), ''),
    COALESCE(NULLIF(btrim(p_organization ->> 'fiscalYearStart'), ''), 'January'),
    COALESCE(NULLIF(btrim(p_organization ->> 'industry'), ''), 'General Business'),
    NULLIF(p_organization ->> 'businessType', '')::public.organization_business_type,
    COALESCE(NULLIF(p_organization ->> 'themeAccent', ''), 'oxblood')::public.organization_theme_accent,
    COALESCE(btrim(p_organization ->> 'address'), ''),
    COALESCE(btrim(p_organization ->> 'city'), ''),
    COALESCE(btrim(p_organization ->> 'phone'), ''),
    COALESCE(btrim(p_organization ->> 'email'), ''),
    COALESCE(btrim(p_organization ->> 'website'), ''),
    false, false, p_owner, p_creation_key
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org_id, p_owner, 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner';

  INSERT INTO public.accounts (org_id, code, name, type, currency, is_active, is_bank_account)
  SELECT v_org_id, btrim(account ->> 'code'), btrim(account ->> 'name'),
         (account ->> 'type')::public.account_type,
         COALESCE(NULLIF(upper(btrim(account ->> 'currency')), ''), v_currency),
         true, COALESCE((account ->> 'isBankAccount')::BOOLEAN, false)
  FROM jsonb_array_elements(COALESCE(p_accounts, '[]'::JSONB)) AS account
  ON CONFLICT (org_id, code) DO NOTHING;

  RETURN v_org_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.invite_member(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_invitation(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pending_invitations(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_to_invitation(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_organization(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_ownership(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_organization(UUID, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_member(UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pending_invitations(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_invitation(UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.leave_organization(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_ownership(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_organization(UUID, JSONB, JSONB, TEXT) TO service_role;

-- Rollback: drop the functions above, the two organizations columns and
-- public.organization_invitations.
