-- Campaigns and pledges are off-ledger commitments. Giving progress is read
-- from posted contributions to the campaign's fund within its dates.
CREATE TABLE public.church_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fund_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  goal_cents BIGINT NOT NULL CHECK (goal_cents > 0),
  starts_on DATE NOT NULL,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT church_campaigns_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT church_campaigns_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT church_campaign_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT church_campaign_closed_check CHECK (status <> 'CLOSED' OR ends_on IS NOT NULL)
);
CREATE INDEX church_campaigns_org_fund ON public.church_campaigns(org_id, fund_id, starts_on);

CREATE OR REPLACE FUNCTION private.check_church_campaign_period()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  -- Serialize changes to campaigns of one fund before checking overlap.
  PERFORM 1 FROM public.funds WHERE org_id = NEW.org_id AND id = NEW.fund_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.church_campaigns AS other
    WHERE other.org_id = NEW.org_id AND other.fund_id = NEW.fund_id AND other.id <> NEW.id
      AND daterange(other.starts_on, COALESCE(other.ends_on, 'infinity'::date), '[]')
        && daterange(NEW.starts_on, COALESCE(NEW.ends_on, 'infinity'::date), '[]')) THEN
    RAISE EXCEPTION 'Campaign dates overlap for this fund.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.check_church_campaign_period() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER church_campaigns_period BEFORE INSERT OR UPDATE OF org_id, fund_id, starts_on, ends_on
  ON public.church_campaigns FOR EACH ROW EXECUTE FUNCTION private.check_church_campaign_period();
CREATE TRIGGER church_campaigns_require_church BEFORE INSERT OR UPDATE OF org_id ON public.church_campaigns
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER church_campaigns_touch BEFORE UPDATE ON public.church_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.church_pledges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL,
  member_id UUID NOT NULL,
  pledged_cents BIGINT NOT NULL CHECK (pledged_cents > 0),
  pledged_on DATE NOT NULL,
  due_on DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT church_pledges_org_campaign_fkey FOREIGN KEY (org_id, campaign_id)
    REFERENCES public.church_campaigns(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT church_pledges_org_member_fkey FOREIGN KEY (org_id, member_id)
    REFERENCES public.members(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT church_pledges_one_per_member UNIQUE (org_id, campaign_id, member_id),
  CONSTRAINT church_pledges_due_check CHECK (due_on IS NULL OR due_on >= pledged_on)
);
CREATE INDEX church_pledges_org_campaign ON public.church_pledges(org_id, campaign_id);
CREATE TRIGGER church_pledges_require_church BEFORE INSERT OR UPDATE OF org_id ON public.church_pledges
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER church_pledges_touch BEFORE UPDATE ON public.church_pledges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.church_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_pledges ENABLE ROW LEVEL SECURITY;
CREATE POLICY church_campaigns_read ON public.church_campaigns FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY church_pledges_read ON public.church_pledges FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.church_campaigns, public.church_pledges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.church_campaigns, public.church_pledges TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.church_campaigns, public.church_pledges TO service_role;
