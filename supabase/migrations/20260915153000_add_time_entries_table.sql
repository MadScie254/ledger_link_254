-- ============================================================
-- LedgerLink Migration: Time Entries
-- ============================================================
-- Backs the Projects "Time tracking" tab, whose "Submit Timesheet"
-- button previously had no handler at all.

CREATE TABLE public.time_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entry_date  DATE NOT NULL,
  hours       NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_time_entries_org_id ON public.time_entries(org_id);
CREATE INDEX idx_time_entries_project_id ON public.time_entries(project_id);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY time_entries_select_policy ON public.time_entries
  FOR SELECT USING (user_has_org_access(org_id));

CREATE POLICY time_entries_insert_policy ON public.time_entries
  FOR INSERT WITH CHECK (user_has_org_access(org_id));

CREATE POLICY time_entries_delete_policy ON public.time_entries
  FOR DELETE USING (user_has_org_access(org_id));
