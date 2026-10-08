-- E1.1: edition and plan records. Existing organizations stay business.
CREATE TYPE public.organization_edition AS ENUM ('business', 'law', 'church');

ALTER TABLE public.organizations
  ADD COLUMN edition public.organization_edition NOT NULL DEFAULT 'business',
  ADD COLUMN parent_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN integration_actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX organizations_parent_org_id_idx ON public.organizations(parent_org_id)
  WHERE parent_org_id IS NOT NULL;

-- Automated postings must always name a privileged member of this organization.
CREATE FUNCTION private.validate_integration_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.integration_actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.memberships AS membership
    WHERE membership.org_id = NEW.id
      AND membership.user_id = NEW.integration_actor_id
      AND membership.role IN ('owner', 'admin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Integration actor must be an owner, admin or accountant of this organization.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.validate_integration_actor() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER organizations_validate_integration_actor
  BEFORE INSERT OR UPDATE OF integration_actor_id ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.validate_integration_actor();

-- Revoking a member's posting role also revokes their integration authority.
CREATE FUNCTION private.clear_revoked_integration_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.role NOT IN ('owner', 'admin', 'accountant') THEN
    UPDATE public.organizations SET integration_actor_id = NULL
    WHERE id = OLD.org_id AND integration_actor_id = OLD.user_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
REVOKE ALL ON FUNCTION private.clear_revoked_integration_actor() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER memberships_clear_revoked_integration_actor
  AFTER UPDATE OF role OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION private.clear_revoked_integration_actor();

CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,
  edition public.organization_edition NOT NULL,
  name TEXT NOT NULL,
  monthly_price_cents BIGINT NOT NULL CHECK (monthly_price_cents >= 0),
  annual_price_cents BIGINT NOT NULL CHECK (annual_price_cents >= 0),
  max_users INT CHECK (max_users > 0),
  max_members INT CHECK (max_members > 0),
  features JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.plans (id, edition, name, monthly_price_cents, annual_price_cents, max_users, max_members)
VALUES
  ('law_solo', 'law', 'Solo', 250000, 2500000, 2, NULL),
  ('law_firm', 'law', 'Firm', 650000, 6500000, 5, NULL),
  ('law_practice', 'law', 'Practice', 1450000, 14500000, 15, NULL),
  ('law_inhouse', 'law', 'In-house', 650000, 6500000, 5, NULL),
  ('church_seed', 'church', 'Seed', 200000, 2000000, NULL, 150),
  ('church_grow', 'church', 'Grow', 450000, 4500000, NULL, 600),
  ('church_large', 'church', 'Large', 950000, 9500000, NULL, 2000);

CREATE TABLE public.organization_subscriptions (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES public.plans(id),
  status TEXT CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  billing_cycle TEXT CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
  founding BOOLEAN NOT NULL DEFAULT false,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100)
);

CREATE FUNCTION private.validate_subscription_edition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_plan_edition public.organization_edition;
  v_org_edition public.organization_edition;
BEGIN
  IF NEW.plan_id IS NULL THEN RETURN NEW; END IF;
  SELECT edition INTO v_plan_edition FROM public.plans WHERE id = NEW.plan_id;
  SELECT edition INTO v_org_edition FROM public.organizations WHERE id = NEW.org_id;
  IF v_plan_edition IS NOT NULL AND v_org_edition IS NOT NULL
    AND v_plan_edition <> v_org_edition THEN
    RAISE EXCEPTION 'Plan and organization must use the same edition.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.validate_subscription_edition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER organization_subscriptions_validate_edition
  BEFORE INSERT OR UPDATE OF org_id, plan_id ON public.organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION private.validate_subscription_edition();

CREATE FUNCTION private.validate_organization_plan_edition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organization_subscriptions AS subscription
    JOIN public.plans AS plan ON plan.id = subscription.plan_id
    WHERE subscription.org_id = NEW.id AND plan.edition <> NEW.edition
  ) THEN
    RAISE EXCEPTION 'Plan and organization must use the same edition.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.validate_organization_plan_edition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER organizations_validate_plan_edition
  BEFORE UPDATE OF edition ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.validate_organization_plan_edition();

-- Browser sessions can read prices and their own subscription. Writes use service_role.
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plans, public.organization_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plans, public.organization_subscriptions TO authenticated;
GRANT ALL ON public.plans, public.organization_subscriptions TO service_role;
CREATE POLICY plans_member_read ON public.plans FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY organization_subscriptions_member_read ON public.organization_subscriptions
  FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));

-- Keep every document type added through 20261005000200_estimates.sql.
CREATE OR REPLACE FUNCTION private.next_document_number(p_org_id UUID, p_document_type TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_number INTEGER;
BEGIN
  IF p_document_type NOT IN (
    'INVOICE', 'BILL', 'SALES_ORDER', 'ESTIMATE', 'CREDIT_NOTE', 'SALES_RECEIPT',
    'EXPENSE', 'TRANSFER', 'PURCHASE_ORDER', 'SUPPLIER_CREDIT', 'REFUND', 'DEPOSIT',
    'MATTER', 'COLLECTION', 'REQUISITION'
  ) THEN
    RAISE EXCEPTION 'Unsupported document type.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.document_counters AS counter (org_id, doc_type, next_number)
  VALUES (p_org_id, p_document_type, 2)
  ON CONFLICT (org_id, doc_type)
  DO UPDATE SET next_number = counter.next_number + 1
  RETURNING next_number - 1 INTO v_number;
  RETURN v_number;
END;
$function$;
REVOKE ALL ON FUNCTION private.next_document_number(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
