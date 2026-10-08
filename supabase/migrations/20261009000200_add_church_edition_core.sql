-- Kundi pilot records: members and households, funds and the rules that
-- route M-Pesa giving to them, M-Pesa receipts, contributions, two-person
-- cash counts, and each church's M-Pesa C2B integration. They live beside
-- the shared organization ledger; money moves only through the functions in
-- 20261009000300_church_money_functions.sql.
--
-- Member records are personal data under the Data Protection Act, 2019: no
-- marital status is kept, and a phone number or email is stored only with
-- the member's recorded consent.

CREATE TABLE public.households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address TEXT CHECK (address IS NULL OR length(address) <= 500),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT households_org_id_id_key UNIQUE (org_id, id)
);
CREATE INDEX households_org_name ON public.households(org_id, lower(name));

CREATE TABLE public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Also the account reference a member gives when paying by M-Pesa.
  member_number TEXT NOT NULL CHECK (member_number ~ '^[A-Za-z0-9-]{1,20}$'),
  first_name TEXT NOT NULL CHECK (length(btrim(first_name)) BETWEEN 1 AND 100),
  last_name TEXT CHECK (last_name IS NULL OR length(last_name) <= 100),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  email TEXT CHECK (email IS NULL OR length(email) <= 320),
  household_id UUID,
  status TEXT NOT NULL DEFAULT 'MEMBER' CHECK (status IN
    ('VISITOR','ADHERENT','MEMBER','BAPTISED_MEMBER','TRANSFERRED','DECEASED','INACTIVE')),
  date_of_birth DATE,
  joined_on DATE,
  consent_given_at TIMESTAMPTZ,
  consent_method TEXT CHECK (consent_method IS NULL OR length(btrim(consent_method)) BETWEEN 1 AND 100),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT members_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT members_org_household_fkey FOREIGN KEY (org_id, household_id)
    REFERENCES public.households(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT members_contact_consent_check CHECK (
    (phone IS NULL AND email IS NULL) OR (consent_given_at IS NOT NULL AND consent_method IS NOT NULL)
  )
);
-- Numbers are matched without regard to case ("mem12" is "MEM12").
CREATE UNIQUE INDEX members_org_number_key ON public.members(org_id, upper(member_number));
CREATE INDEX members_org_name ON public.members(org_id, lower(last_name), lower(first_name));
CREATE INDEX members_org_household ON public.members(org_id, household_id) WHERE household_id IS NOT NULL;

CREATE TABLE public.funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  restricted BOOLEAN NOT NULL DEFAULT false,
  income_account_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT funds_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT funds_org_code_key UNIQUE (org_id, code),
  CONSTRAINT funds_org_account_fkey FOREIGN KEY (org_id, income_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.giving_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 10000),
  match_type TEXT NOT NULL CHECK (match_type IN ('MEMBER_NUMBER','PREFIX','EXACT')),
  pattern TEXT CHECK (pattern IS NULL OR pattern ~ '^[A-Za-z0-9-]{1,20}$'),
  fund_id UUID NOT NULL,
  income_account_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT giving_rules_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT giving_rules_org_account_fkey FOREIGN KEY (org_id, income_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT giving_rules_pattern_required_check CHECK (match_type = 'MEMBER_NUMBER' OR pattern IS NOT NULL)
);
CREATE INDEX giving_rules_org_priority ON public.giving_rules(org_id, priority);

CREATE TABLE public.mpesa_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trans_id TEXT NOT NULL CHECK (trans_id ~ '^[A-Za-z0-9]{6,30}$'),
  trans_time TIMESTAMPTZ NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  bill_ref_number TEXT CHECK (bill_ref_number IS NULL OR length(bill_ref_number) <= 100),
  -- Safaricom may send this masked or hashed; it is never used for matching.
  msisdn TEXT CHECK (msisdn IS NULL OR length(msisdn) <= 100),
  first_name TEXT CHECK (first_name IS NULL OR length(first_name) <= 100),
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  source TEXT NOT NULL CHECK (source IN ('C2B_CALLBACK','STATEMENT_UPLOAD')),
  status TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (status IN ('UNMATCHED','POSTED','IGNORED')),
  member_id UUID,
  fund_id UUID,
  journal_entry_id UUID,
  ignored_reason TEXT CHECK (ignored_reason IS NULL OR length(ignored_reason) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mpesa_receipts_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT mpesa_receipts_org_trans_key UNIQUE (org_id, trans_id),
  CONSTRAINT mpesa_receipts_org_member_fkey FOREIGN KEY (org_id, member_id)
    REFERENCES public.members(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_receipts_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_receipts_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_receipts_posted_check CHECK ((status = 'POSTED') = (journal_entry_id IS NOT NULL)),
  CONSTRAINT mpesa_receipts_ignored_check CHECK ((status = 'IGNORED') = (ignored_reason IS NOT NULL))
);
CREATE INDEX mpesa_receipts_org_status ON public.mpesa_receipts(org_id, status, trans_time DESC);

CREATE TABLE public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  collection_number TEXT NOT NULL,
  service_date DATE NOT NULL,
  service_name TEXT NOT NULL CHECK (length(btrim(service_name)) BETWEEN 1 AND 100),
  fund_id UUID NOT NULL,
  -- Notes and coins counted, by face value in shillings: {"1000": 3, "50": 4}.
  denominations JSONB NOT NULL,
  second_denominations JSONB,
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  counted_by_1 UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  counted_by_2 UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'AWAITING_SECOND_COUNT'
    CHECK (status IN ('AWAITING_SECOND_COUNT','COUNTED','BANKED')),
  journal_entry_id UUID,
  banked_on DATE,
  bank_account_id UUID,
  bank_reference TEXT CHECK (bank_reference IS NULL OR length(bank_reference) <= 100),
  banked_cents BIGINT CHECK (banked_cents IS NULL OR banked_cents > 0),
  variance_cents BIGINT,
  banking_journal_entry_id UUID,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT collections_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT collections_org_number_key UNIQUE (org_id, collection_number),
  CONSTRAINT collections_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT collections_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT collections_org_bank_fkey FOREIGN KEY (org_id, bank_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT collections_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT collections_org_banking_journal_fkey FOREIGN KEY (org_id, banking_journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT collections_two_counters_check CHECK (counted_by_2 IS NULL OR counted_by_2 <> counted_by_1),
  CONSTRAINT collections_stage_check CHECK (
    (status = 'AWAITING_SECOND_COUNT' AND counted_by_2 IS NULL AND journal_entry_id IS NULL AND banked_on IS NULL)
    OR (status = 'COUNTED' AND counted_by_2 IS NOT NULL AND journal_entry_id IS NOT NULL AND banked_on IS NULL)
    OR (status = 'BANKED' AND counted_by_2 IS NOT NULL AND journal_entry_id IS NOT NULL AND banked_on IS NOT NULL
        AND banked_cents IS NOT NULL AND variance_cents = banked_cents - total_cents AND banking_journal_entry_id IS NOT NULL)
  )
);
CREATE INDEX collections_org_status ON public.collections(org_id, status, service_date DESC);

CREATE TABLE public.contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id UUID,
  fund_id UUID NOT NULL,
  income_account_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('MPESA','CASH','BANK','CHEQUE')),
  received_on DATE NOT NULL,
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 100),
  mpesa_receipt_id UUID,
  collection_id UUID,
  journal_entry_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contributions_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT contributions_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT contributions_org_member_fkey FOREIGN KEY (org_id, member_id)
    REFERENCES public.members(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT contributions_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT contributions_org_account_fkey FOREIGN KEY (org_id, income_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT contributions_org_receipt_fkey FOREIGN KEY (org_id, mpesa_receipt_id)
    REFERENCES public.mpesa_receipts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT contributions_org_collection_fkey FOREIGN KEY (org_id, collection_id)
    REFERENCES public.collections(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT contributions_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX contributions_receipt_key ON public.contributions(org_id, mpesa_receipt_id) WHERE mpesa_receipt_id IS NOT NULL;
CREATE INDEX contributions_org_received ON public.contributions(org_id, received_on DESC);
CREATE INDEX contributions_org_member ON public.contributions(org_id, member_id) WHERE member_id IS NOT NULL;

-- A church's M-Pesa C2B link. The confirmation URL carries a random token
-- whose SHA-256 is kept here; the Daraja consumer key and secret live in
-- Supabase Vault, named by vault_secret_id, and never leave the database
-- except to the Worker that calls Daraja.
CREATE TABLE public.org_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('MPESA_C2B')),
  shortcode TEXT CHECK (shortcode IS NULL OR shortcode ~ '^[0-9]{5,10}$'),
  environment TEXT NOT NULL DEFAULT 'SANDBOX' CHECK (environment IN ('SANDBOX','PRODUCTION')),
  callback_token_hash TEXT CHECK (callback_token_hash IS NULL OR callback_token_hash ~ '^[0-9a-f]{64}$'),
  vault_secret_id UUID,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REGISTERED','DISABLED')),
  registered_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_integrations_org_kind_key UNIQUE (org_id, kind),
  CONSTRAINT org_integrations_token_key UNIQUE (callback_token_hash)
);

-- Church records belong to church organizations only.
CREATE FUNCTION private.require_church_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.org_id AND edition = 'church') THEN
    RAISE EXCEPTION 'These records belong to Kundi church organizations.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_church_org() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER households_require_church BEFORE INSERT OR UPDATE OF org_id ON public.households
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER members_require_church BEFORE INSERT OR UPDATE OF org_id ON public.members
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER funds_require_church BEFORE INSERT OR UPDATE OF org_id ON public.funds
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER giving_rules_require_church BEFORE INSERT OR UPDATE OF org_id ON public.giving_rules
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER mpesa_receipts_require_church BEFORE INSERT OR UPDATE OF org_id ON public.mpesa_receipts
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER collections_require_church BEFORE INSERT OR UPDATE OF org_id ON public.collections
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER contributions_require_church BEFORE INSERT OR UPDATE OF org_id ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER org_integrations_require_church BEFORE INSERT OR UPDATE OF org_id ON public.org_integrations
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();

-- Giving, counts and receipts are kept; they change only through the money
-- functions (which run as the table owner) and are never deleted.
CREATE TRIGGER contributions_permanent BEFORE UPDATE OR DELETE ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();
CREATE TRIGGER collections_permanent BEFORE UPDATE OR DELETE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();
CREATE TRIGGER mpesa_receipts_permanent BEFORE UPDATE OR DELETE ON public.mpesa_receipts
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

CREATE FUNCTION private.touch_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.touch_member() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER members_touch BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION private.touch_member();

-- The plan's member limit, counted over the people still with the church.
CREATE FUNCTION private.enforce_church_member_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_limit INTEGER;
  v_plan TEXT;
  v_count INTEGER;
BEGIN
  IF NEW.status IN ('TRANSFERRED','DECEASED','INACTIVE') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('TRANSFERRED','DECEASED','INACTIVE') THEN RETURN NEW; END IF;
  SELECT plan.max_members, plan.name INTO v_limit, v_plan
  FROM public.organization_subscriptions AS subscription
  JOIN public.plans AS plan ON plan.id = subscription.plan_id
  WHERE subscription.org_id = NEW.org_id;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.org_id::TEXT || ':members', 0));
  SELECT count(*) INTO v_count FROM public.members AS member
  WHERE member.org_id = NEW.org_id AND member.status NOT IN ('TRANSFERRED','DECEASED','INACTIVE')
    AND member.id <> NEW.id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'The % plan includes % members.', v_plan, v_limit USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enforce_church_member_limit() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER members_plan_limit BEFORE INSERT OR UPDATE OF status ON public.members
  FOR EACH ROW EXECUTE FUNCTION private.enforce_church_member_limit();

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giving_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mpesa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.households, public.members, public.funds, public.giving_rules, public.mpesa_receipts,
  public.collections, public.contributions, public.org_integrations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.households, public.members, public.funds, public.giving_rules, public.mpesa_receipts,
  public.collections, public.contributions TO authenticated;
GRANT SELECT ON public.org_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.households, public.members, public.funds, public.giving_rules,
  public.mpesa_receipts, public.collections, public.contributions, public.org_integrations TO service_role;
GRANT DELETE ON public.households, public.members TO service_role;
CREATE POLICY households_member_read ON public.households FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY members_member_read ON public.members FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY funds_member_read ON public.funds FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY giving_rules_member_read ON public.giving_rules FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY mpesa_receipts_member_read ON public.mpesa_receipts FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY collections_member_read ON public.collections FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY contributions_member_read ON public.contributions FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
-- Integration settings are for administrators.
CREATE POLICY org_integrations_admin_read ON public.org_integrations FOR SELECT TO authenticated
  USING ((SELECT public.user_is_org_admin(org_id)));

-- The four funds a church starts with, and the rules that route M-Pesa
-- account references to them: TITHE to the general fund as tithes, BLD and
-- MSN prefixes to building and missions, a member number to the general fund
-- as tithes. A fund whose income account is missing is left out.
CREATE FUNCTION private.seed_church_funds(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_general UUID;
  v_building UUID;
  v_missions UUID;
  v_tithes UUID;
BEGIN
  INSERT INTO public.funds (org_id, code, name, restricted, income_account_id)
  SELECT p_org_id, fund.code, fund.name, fund.restricted, account.id
  FROM (VALUES ('GENERAL', 'General fund', false, '4020'), ('BUILDING', 'Building fund', true, '4040'),
               ('MISSIONS', 'Missions fund', true, '4050'), ('WELFARE', 'Welfare fund', true, '4030'))
       AS fund(code, name, restricted, account_code)
  JOIN public.accounts AS account ON account.org_id = p_org_id AND account.code = fund.account_code
  ON CONFLICT (org_id, code) DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.giving_rules WHERE org_id = p_org_id) THEN RETURN; END IF;
  SELECT id INTO v_general FROM public.funds WHERE org_id = p_org_id AND code = 'GENERAL';
  SELECT id INTO v_building FROM public.funds WHERE org_id = p_org_id AND code = 'BUILDING';
  SELECT id INTO v_missions FROM public.funds WHERE org_id = p_org_id AND code = 'MISSIONS';
  SELECT id INTO v_tithes FROM public.accounts WHERE org_id = p_org_id AND code = '4010';
  IF v_general IS NOT NULL THEN
    INSERT INTO public.giving_rules (org_id, priority, match_type, pattern, fund_id, income_account_id)
    VALUES (p_org_id, 10, 'EXACT', 'TITHE', v_general, v_tithes),
           (p_org_id, 100, 'MEMBER_NUMBER', NULL, v_general, v_tithes);
  END IF;
  IF v_building IS NOT NULL THEN
    INSERT INTO public.giving_rules (org_id, priority, match_type, pattern, fund_id)
    VALUES (p_org_id, 20, 'PREFIX', 'BLD', v_building);
  END IF;
  IF v_missions IS NOT NULL THEN
    INSERT INTO public.giving_rules (org_id, priority, match_type, pattern, fund_id)
    VALUES (p_org_id, 30, 'PREFIX', 'MSN', v_missions);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.seed_church_funds(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Churches already created get their funds now.
SELECT private.seed_church_funds(org.id) FROM public.organizations AS org WHERE org.edition = 'church';

-- A new church organization is created with its funds and giving rules.
-- Otherwise as in 20261008182405_create_edition_organizations.sql.
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
  -- A church starts with its funds and the rules that route giving to them.
  IF v_edition = 'church' THEN
    PERFORM private.seed_church_funds(v_org_id);
  END IF;
  RETURN v_org_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_organization(UUID, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(UUID, JSONB, JSONB, TEXT) TO service_role;

-- Rollback: drop the eight tables (contributions, collections, mpesa_receipts,
-- giving_rules, funds, members, households, org_integrations, in that order),
-- private.seed_church_funds, private.enforce_church_member_limit,
-- private.touch_member and private.require_church_org; re-run
-- create_organization from 20261008182405.
