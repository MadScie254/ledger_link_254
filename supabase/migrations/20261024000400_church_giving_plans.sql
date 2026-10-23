-- Giving plans record an intention to give each month. They never collect or
-- post money; actuals come from posted contributions by the same member and fund.
CREATE TABLE public.church_giving_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id UUID NOT NULL,
  fund_id UUID NOT NULL,
  monthly_cents BIGINT NOT NULL CHECK (monthly_cents > 0),
  starts_on DATE NOT NULL,
  ends_on DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT church_giving_plans_org_member_fkey FOREIGN KEY (org_id, member_id)
    REFERENCES public.members(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT church_giving_plans_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT church_giving_plans_dates_check CHECK (
    EXTRACT(DAY FROM starts_on) = 1
    AND (ends_on IS NULL OR (ends_on >= starts_on AND ends_on = (date_trunc('month', ends_on)::date + INTERVAL '1 month' - INTERVAL '1 day')::date))
  )
);
CREATE INDEX church_giving_plans_org_member ON public.church_giving_plans(org_id, member_id, fund_id, starts_on);

CREATE OR REPLACE FUNCTION private.check_church_giving_plan_period()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM 1 FROM public.members WHERE org_id = NEW.org_id AND id = NEW.member_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.church_giving_plans AS other
    WHERE other.org_id = NEW.org_id AND other.member_id = NEW.member_id AND other.fund_id = NEW.fund_id
      AND other.id <> NEW.id
      AND daterange(other.starts_on, COALESCE(other.ends_on, 'infinity'::date), '[]')
        && daterange(NEW.starts_on, COALESCE(NEW.ends_on, 'infinity'::date), '[]')) THEN
    RAISE EXCEPTION 'Giving plans overlap for this member and fund.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.check_church_giving_plan_period() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER church_giving_plans_period BEFORE INSERT OR UPDATE OF org_id, member_id, fund_id, starts_on, ends_on
  ON public.church_giving_plans FOR EACH ROW EXECUTE FUNCTION private.check_church_giving_plan_period();
CREATE TRIGGER church_giving_plans_require_church BEFORE INSERT OR UPDATE OF org_id ON public.church_giving_plans
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER church_giving_plans_touch BEFORE UPDATE ON public.church_giving_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.church_giving_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY church_giving_plans_read ON public.church_giving_plans FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.church_giving_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.church_giving_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.church_giving_plans TO service_role;
