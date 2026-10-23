-- A church fund budget is a plan, not a journal entry. Each row covers one
-- financial year and keeps its income target and expense limit in cents.
CREATE TABLE public.church_fund_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fund_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  income_target_cents BIGINT NOT NULL DEFAULT 0 CHECK (income_target_cents >= 0),
  expense_limit_cents BIGINT NOT NULL DEFAULT 0 CHECK (expense_limit_cents >= 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT church_fund_budgets_org_fund_fkey FOREIGN KEY (org_id, fund_id)
    REFERENCES public.funds(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT church_fund_budgets_period_check CHECK (
    EXTRACT(DAY FROM period_start) = 1
    AND period_end = (period_start + INTERVAL '1 year' - INTERVAL '1 day')::date
  ),
  CONSTRAINT church_fund_budgets_unique_period UNIQUE (org_id, fund_id, period_start)
);
CREATE INDEX church_fund_budgets_org_period ON public.church_fund_budgets(org_id, period_start, period_end);
CREATE TRIGGER church_fund_budgets_require_church BEFORE INSERT OR UPDATE OF org_id ON public.church_fund_budgets
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER church_fund_budgets_touch BEFORE UPDATE ON public.church_fund_budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.church_fund_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY church_fund_budgets_read ON public.church_fund_budgets
  FOR SELECT TO authenticated USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.church_fund_budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.church_fund_budgets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.church_fund_budgets TO service_role;
