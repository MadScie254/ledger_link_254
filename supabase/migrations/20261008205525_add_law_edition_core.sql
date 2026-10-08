-- Mizani pilot records live beside the existing business books.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE public.matters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_number TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  client_id UUID NOT NULL,
  practice_area TEXT,
  matter_type TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (matter_type IN ('LITIGATION','CONVEYANCING','CORPORATE','PROBATE','EMPLOYMENT','ADVISORY','OTHER')),
  stage TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ON_HOLD','CLOSED')),
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  court TEXT,
  court_station TEXT,
  case_number TEXT,
  judicial_officer TEXT,
  billing_method TEXT CHECK (billing_method IN ('HOURLY','FIXED','SCALE','RETAINER')),
  default_rate_cents BIGINT CHECK (default_rate_cents >= 0),
  fixed_fee_cents BIGINT CHECK (fixed_fee_cents >= 0),
  opened_on DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_on DATE CHECK (closed_on IS NULL OR closed_on >= opened_on),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matters_org_id_id_key UNIQUE (org_id,id),
  CONSTRAINT matters_org_number_key UNIQUE (org_id,matter_number),
  CONSTRAINT matters_org_client_fkey FOREIGN KEY (org_id,client_id)
    REFERENCES public.customers(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX matters_org_status_opened ON public.matters(org_id,status,opened_on DESC);
CREATE INDEX matters_org_client ON public.matters(org_id,client_id);
CREATE INDEX matters_org_case ON public.matters(org_id,lower(case_number)) WHERE case_number IS NOT NULL;

CREATE TABLE public.matter_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK (role IN ('CLIENT','OPPOSING_PARTY','OPPOSING_ADVOCATE','WITNESS','INTERESTED_PARTY','OTHER')),
  id_or_reg_number TEXT,
  phone TEXT,
  email TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matter_parties_org_matter_fkey FOREIGN KEY (org_id,matter_id)
    REFERENCES public.matters(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX matter_parties_org_matter ON public.matter_parties(org_id,matter_id);
CREATE INDEX matter_parties_name_trgm ON public.matter_parties
  USING gin (lower(name) extensions.gin_trgm_ops);

CREATE TABLE public.court_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('HEARING','MENTION','RULING','JUDGMENT','FILING_DEADLINE','OTHER')),
  starts_at TIMESTAMPTZ NOT NULL,
  court TEXT,
  courtroom TEXT,
  judicial_officer TEXT,
  outcome TEXT,
  next_event_id UUID,
  no_further_date BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','DONE','ADJOURNED','CANCELLED')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT court_events_org_id_id_key UNIQUE (org_id,id),
  CONSTRAINT court_events_org_matter_fkey FOREIGN KEY (org_id,matter_id)
    REFERENCES public.matters(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT court_events_org_next_fkey FOREIGN KEY (org_id,next_event_id)
    REFERENCES public.court_events(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT court_events_next_choice_check CHECK (NOT (next_event_id IS NOT NULL AND no_further_date))
);
CREATE INDEX court_events_org_start ON public.court_events(org_id,starts_at);
CREATE INDEX court_events_org_matter ON public.court_events(org_id,matter_id);

CREATE TABLE public.matter_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  due_on DATE,
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,
  template_key TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matter_tasks_org_matter_fkey FOREIGN KEY (org_id,matter_id)
    REFERENCES public.matters(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX matter_tasks_org_due ON public.matter_tasks(org_id,due_on) WHERE done_at IS NULL;
CREATE INDEX matter_tasks_org_matter ON public.matter_tasks(org_id,matter_id);

CREATE TABLE public.disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL,
  incurred_on DATE NOT NULL,
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_from TEXT NOT NULL CHECK (paid_from IN ('OFFICE','CLIENT')),
  journal_entry_id UUID,
  invoice_id UUID,
  receipt_reference TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT disbursements_org_id_id_key UNIQUE (org_id,id),
  CONSTRAINT disbursements_org_matter_fkey FOREIGN KEY (org_id,matter_id)
    REFERENCES public.matters(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT disbursements_org_journal_fkey FOREIGN KEY (org_id,journal_entry_id)
    REFERENCES public.journal_entries(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT disbursements_org_invoice_fkey FOREIGN KEY (org_id,invoice_id)
    REFERENCES public.invoices(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX disbursements_org_matter ON public.disbursements(org_id,matter_id,incurred_on);
CREATE INDEX disbursements_unbilled ON public.disbursements(org_id,matter_id) WHERE invoice_id IS NULL;

-- Projects continue to supply project_id; law time entries supply matter_id.
ALTER TABLE public.time_entries
  ADD COLUMN matter_id UUID,
  ADD COLUMN billable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN rate_cents BIGINT CHECK (rate_cents >= 0),
  ADD COLUMN amount_cents BIGINT CHECK (amount_cents >= 0),
  ADD COLUMN invoice_id UUID,
  ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ALTER COLUMN project_id DROP NOT NULL,
  ADD CONSTRAINT time_entries_project_or_matter_check CHECK (project_id IS NOT NULL OR matter_id IS NOT NULL),
  ADD CONSTRAINT time_entries_org_matter_fkey FOREIGN KEY (org_id,matter_id)
    REFERENCES public.matters(org_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT time_entries_org_invoice_fkey FOREIGN KEY (org_id,invoice_id)
    REFERENCES public.invoices(org_id,id) ON DELETE RESTRICT;
CREATE INDEX time_entries_org_matter ON public.time_entries(org_id,matter_id,entry_date)
  WHERE matter_id IS NOT NULL;
CREATE INDEX time_entries_unbilled ON public.time_entries(org_id,matter_id)
  WHERE matter_id IS NOT NULL AND invoice_id IS NULL AND billable;

ALTER TABLE public.invoices
  ADD COLUMN matter_id UUID,
  ADD COLUMN etims_invoice_number TEXT,
  ADD COLUMN etims_recorded_at TIMESTAMPTZ,
  ADD CONSTRAINT invoices_org_matter_fkey FOREIGN KEY (org_id,matter_id)
    REFERENCES public.matters(org_id,id) ON DELETE RESTRICT;
CREATE INDEX invoices_org_matter ON public.invoices(org_id,matter_id) WHERE matter_id IS NOT NULL;
ALTER TABLE public.invoice_lines
  ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (line_kind IN ('PROFIT_COST','DISBURSEMENT','OTHER'));
ALTER TABLE public.invoice_payments
  ADD COLUMN wht_cents BIGINT NOT NULL DEFAULT 0 CHECK (wht_cents >= 0),
  ADD COLUMN wht_certificate_number TEXT;

ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disbursements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matters, public.matter_parties, public.court_events,
  public.matter_tasks, public.disbursements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.matters, public.matter_parties, public.court_events,
  public.matter_tasks, public.disbursements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.matters, public.matter_parties, public.court_events,
  public.matter_tasks, public.disbursements TO service_role;
CREATE POLICY matters_member_read ON public.matters FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY matter_parties_member_read ON public.matter_parties FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY court_events_member_read ON public.court_events FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY matter_tasks_member_read ON public.matter_tasks FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY disbursements_member_read ON public.disbursements FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));

CREATE FUNCTION private.require_law_matter_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.org_id AND edition = 'law') THEN
    RAISE EXCEPTION 'Matters belong to law organizations.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_law_matter_org() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER matters_require_law_edition BEFORE INSERT OR UPDATE OF org_id ON public.matters
  FOR EACH ROW EXECUTE FUNCTION private.require_law_matter_org();

CREATE FUNCTION private.preserve_law_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  RAISE EXCEPTION '% records must be kept; correct or close them instead.',
    CASE TG_TABLE_NAME WHEN 'matters' THEN 'Matter' ELSE 'Disbursement' END USING ERRCODE = '23514';
END;
$function$;
REVOKE ALL ON FUNCTION private.preserve_law_records() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER matters_keep_record BEFORE DELETE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION private.preserve_law_records();
CREATE TRIGGER disbursements_keep_record BEFORE DELETE ON public.disbursements
  FOR EACH ROW EXECUTE FUNCTION private.preserve_law_records();

-- The existing core journal function remains unchanged. This guard runs on
-- every line inserted through it or directly, before the line is stored.
CREATE FUNCTION private.protect_client_money_accounts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_code TEXT;
  v_source TEXT;
BEGIN
  SELECT account.code INTO v_code FROM public.accounts AS account
  WHERE account.org_id = NEW.org_id AND account.id = NEW.account_id;
  IF v_code NOT IN ('1060','2200') THEN RETURN NEW; END IF;
  SELECT entry.source_type INTO v_source FROM public.journal_entries AS entry
  WHERE entry.org_id = NEW.org_id AND entry.id = NEW.journal_entry_id;
  IF upper(v_source) IN ('MANUAL','ADJUSTMENT','BANK') THEN
    RAISE EXCEPTION 'Client money (1060/2200) moves only through client receipts, payments and transfers.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.protect_client_money_accounts() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER journal_lines_protect_client_money BEFORE INSERT ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.protect_client_money_accounts();
