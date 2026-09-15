-- ============================================================
-- LedgerLink Migration: Budgets
-- ============================================================
-- Adds real backing storage for the Budget Planner, which previously
-- rendered entirely hardcoded mock data on the client with no persistence.

CREATE TABLE public.budgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  period      TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (period IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
  limit_cents BIGINT NOT NULL CHECK (limit_cents >= 0),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, account_id, period)
);

CREATE INDEX idx_budgets_org_id ON public.budgets(org_id);
CREATE INDEX idx_budgets_account_id ON public.budgets(account_id);

CREATE TRIGGER budgets_set_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY budgets_select_policy ON public.budgets
  FOR SELECT USING (user_has_org_access(org_id));

CREATE POLICY budgets_insert_policy ON public.budgets
  FOR INSERT WITH CHECK (user_has_org_access(org_id));

CREATE POLICY budgets_update_policy ON public.budgets
  FOR UPDATE USING (user_has_org_access(org_id));

CREATE POLICY budgets_delete_policy ON public.budgets
  FOR DELETE USING (user_has_org_access(org_id));
