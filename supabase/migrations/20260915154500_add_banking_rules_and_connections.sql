-- ============================================================
-- LedgerLink Migration: Bank Rules & Connection Requests
-- ============================================================
-- Rules: backs the Banking "Rules" tab, which previously showed 3
-- hardcoded example rules with a non-functional "Create Rule" button.
--
-- Connection requests: backs the Banking "Bank connections" tab. This
-- does NOT establish a real live bank/M-Pesa feed — that requires a real
-- banking aggregator account and credentials this app does not have.
-- It honestly records a request instead of faking a "Live Sync" status.

CREATE TABLE public.bank_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  match_text        TEXT NOT NULL,
  target_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_rules_org_id ON public.bank_rules(org_id);

ALTER TABLE public.bank_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_rules_select_policy ON public.bank_rules
  FOR SELECT USING (user_has_org_access(org_id));
CREATE POLICY bank_rules_insert_policy ON public.bank_rules
  FOR INSERT WITH CHECK (user_has_org_access(org_id));
CREATE POLICY bank_rules_delete_policy ON public.bank_rules
  FOR DELETE USING (user_has_org_access(org_id));

CREATE TABLE public.bank_connection_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  institution_name  TEXT NOT NULL,
  contact_email     TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'CONNECTED', 'DECLINED')),
  requested_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_connection_requests_org_id ON public.bank_connection_requests(org_id);

ALTER TABLE public.bank_connection_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_connection_requests_select_policy ON public.bank_connection_requests
  FOR SELECT USING (user_has_org_access(org_id));
CREATE POLICY bank_connection_requests_insert_policy ON public.bank_connection_requests
  FOR INSERT WITH CHECK (user_has_org_access(org_id));
