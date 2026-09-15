-- ============================================================
-- LedgerLink Migration: Payroll Runs & Payslips
-- ============================================================
-- Backs real payroll processing. Previously "Process Payroll" had no
-- handler, and PAYE/NSSF/SHIF figures were a flat made-up rate
-- (gross > 24000 ? 15% : 0, plus a flat 5% for NSSF/SHIF combined)
-- instead of the actual published Kenyan statutory bands.

CREATE TABLE public.payroll_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  pay_date      DATE NOT NULL,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  total_gross_cents BIGINT NOT NULL DEFAULT 0,
  total_net_cents   BIGINT NOT NULL DEFAULT 0,
  total_paye_cents  BIGINT NOT NULL DEFAULT 0,
  total_nssf_cents  BIGINT NOT NULL DEFAULT 0,
  total_shif_cents  BIGINT NOT NULL DEFAULT 0,
  total_ahl_cents   BIGINT NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, period)
);

CREATE TABLE public.payslips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id  UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  gross_cents     BIGINT NOT NULL,
  paye_cents      BIGINT NOT NULL,
  nssf_cents      BIGINT NOT NULL,
  shif_cents      BIGINT NOT NULL,
  ahl_cents       BIGINT NOT NULL,
  net_cents       BIGINT NOT NULL
);

CREATE INDEX idx_payroll_runs_org_id ON public.payroll_runs(org_id);
CREATE INDEX idx_payslips_payroll_run_id ON public.payslips(payroll_run_id);
CREATE INDEX idx_payslips_employee_id ON public.payslips(employee_id);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_runs_select_policy ON public.payroll_runs
  FOR SELECT USING (user_has_org_access(org_id));
CREATE POLICY payroll_runs_insert_policy ON public.payroll_runs
  FOR INSERT WITH CHECK (user_has_org_access(org_id));

CREATE POLICY payslips_select_policy ON public.payslips
  FOR SELECT USING (
    payroll_run_id IN (SELECT id FROM public.payroll_runs WHERE user_has_org_access(org_id))
  );
CREATE POLICY payslips_insert_policy ON public.payslips
  FOR INSERT WITH CHECK (
    payroll_run_id IN (SELECT id FROM public.payroll_runs WHERE user_has_org_access(org_id))
  );
