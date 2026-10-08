-- E1.3: create edition organizations, accounts and trial subscription together.
-- Church's 3200/3300 fund codes cannot coexist with nonprofit's 3200/3300.
ALTER TABLE public.organizations ADD CONSTRAINT organizations_church_nonprofit_check
  CHECK (edition <> 'church' OR business_type IS DISTINCT FROM 'nonprofit'::public.organization_business_type);

CREATE OR REPLACE FUNCTION public.create_organization(
  p_owner UUID,
  p_organization JSONB,
  p_accounts JSONB,
  p_creation_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org_id UUID;
  v_owned INTEGER;
  v_name TEXT := NULLIF(btrim(COALESCE(p_organization ->> 'name', '')), '');
  v_currency TEXT := upper(btrim(COALESCE(p_organization ->> 'baseCurrency', 'KES')));
  v_edition public.organization_edition :=
    COALESCE(NULLIF(p_organization ->> 'edition', ''), 'business')::public.organization_edition;
  v_plan_id TEXT;
BEGIN
  IF p_owner IS NULL THEN
    RAISE EXCEPTION 'An owner is required.' USING ERRCODE = '22023';
  END IF;
  IF p_creation_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::TEXT || ':org:' || p_creation_key, 0));
    SELECT org.id INTO v_org_id FROM public.organizations AS org
    WHERE org.created_by = p_owner AND org.creation_key = p_creation_key;
    IF FOUND THEN RETURN v_org_id; END IF;
  END IF;
  IF v_name IS NULL OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'An organization name of up to 200 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Base currency must be a three-letter ISO code, such as KES.' USING ERRCODE = '22023';
  END IF;
  IF v_edition = 'church' AND p_organization ->> 'businessType' = 'nonprofit' THEN
    RAISE EXCEPTION 'A church edition cannot use the nonprofit business type because fund account codes overlap.'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_owned FROM public.memberships WHERE user_id = p_owner AND role = 'owner';
  IF v_owned >= 25 THEN
    RAISE EXCEPTION 'One person can own at most 25 organizations.' USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_actor(p_owner);
  INSERT INTO public.organizations (
    name, legal_name, base_currency, country, tax_id, fiscal_year_start, industry,
    business_type, edition, theme_accent, address, city, phone, email, website,
    is_default, is_demo, created_by, creation_key
  ) VALUES (
    v_name,
    COALESCE(NULLIF(btrim(p_organization ->> 'legalName'), ''), v_name),
    v_currency,
    COALESCE(NULLIF(btrim(p_organization ->> 'country'), ''), 'Kenya'),
    COALESCE(btrim(p_organization ->> 'taxId'), ''),
    COALESCE(NULLIF(btrim(p_organization ->> 'fiscalYearStart'), ''), 'January'),
    COALESCE(NULLIF(btrim(p_organization ->> 'industry'), ''), 'General Business'),
    NULLIF(p_organization ->> 'businessType', '')::public.organization_business_type,
    v_edition,
    COALESCE(NULLIF(p_organization ->> 'themeAccent', ''), 'oxblood')::public.organization_theme_accent,
    COALESCE(btrim(p_organization ->> 'address'), ''),
    COALESCE(btrim(p_organization ->> 'city'), ''),
    COALESCE(btrim(p_organization ->> 'phone'), ''),
    COALESCE(btrim(p_organization ->> 'email'), ''),
    COALESCE(btrim(p_organization ->> 'website'), ''),
    false, false, p_owner, p_creation_key
  ) RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org_id, p_owner, 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner';

  -- One statement for the whole chart; avoid Worker subrequest amplification.
  INSERT INTO public.accounts (org_id, code, name, type, currency, is_active, is_bank_account)
  SELECT v_org_id, btrim(account ->> 'code'), btrim(account ->> 'name'),
         (account ->> 'type')::public.account_type,
         COALESCE(NULLIF(upper(btrim(account ->> 'currency')), ''), v_currency),
         true, COALESCE((account ->> 'isBankAccount')::BOOLEAN, false)
  FROM jsonb_array_elements(COALESCE(p_accounts, '[]'::JSONB)) AS account
  ON CONFLICT (org_id, code) DO NOTHING;

  v_plan_id := CASE v_edition WHEN 'law' THEN 'law_solo'
    WHEN 'church' THEN 'church_seed' ELSE NULL END;
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.organization_subscriptions (org_id, plan_id, status, trial_ends_at)
    VALUES (v_org_id, v_plan_id, 'TRIAL', now() + interval '30 days');
  END IF;
  RETURN v_org_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_organization(UUID, JSONB, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(UUID, JSONB, JSONB, TEXT) TO service_role;
