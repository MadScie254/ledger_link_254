-- Bank and M-Pesa statements, imported and reconciled.
--
-- 1. Each statement line belongs to a money account (bank, cash or M-Pesa).
--    Lines entered before this default to account 1000, as matching assumed.
-- 2. Statements are imported from the file the bank gives (read in the
--    browser from CSV, OFX or QFX). A line the account already has, by the
--    bank's own reference or by date, amount and particulars, is skipped, so
--    importing an overlapping statement adds only what is new.
-- 3. Reconciliation, as on a paper statement: for one account, a statement
--    date and closing balance; the person ticks each posted line that appears
--    on the statement until the ticked lines, from the last reconciled
--    balance, come to the statement balance. Completing it records which
--    lines were cleared; only the latest reconciliation of an account can be
--    undone. Nothing is posted.

-- ---------------------------------------------------------------------------
-- 1. Statement lines by account
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS bank_account_id UUID,
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS import_id UUID,
  ADD COLUMN IF NOT EXISTS import_key TEXT;

UPDATE public.bank_transactions AS tx
SET bank_account_id = account.id
FROM public.accounts AS account
WHERE tx.bank_account_id IS NULL AND account.org_id = tx.org_id AND account.code = '1000';

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_org_bank_account_fkey
    FOREIGN KEY (org_id, bank_account_id) REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT bank_transactions_reference_length_check CHECK (reference IS NULL OR length(reference) <= 100);

CREATE UNIQUE INDEX bank_transactions_import_key
  ON public.bank_transactions(org_id, bank_account_id, import_key) WHERE import_key IS NOT NULL;
CREATE INDEX idx_bank_transactions_account_date ON public.bank_transactions(org_id, bank_account_id, date);

-- A line added without an account belongs to account 1000.
CREATE OR REPLACE FUNCTION private.default_statement_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.bank_account_id IS NULL THEN
    SELECT account.id INTO NEW.bank_account_id
    FROM public.accounts AS account
    WHERE account.org_id = NEW.org_id AND account.code = '1000';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.default_statement_account() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS bank_transactions_default_account ON public.bank_transactions;
CREATE TRIGGER bank_transactions_default_account
  BEFORE INSERT ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION private.default_statement_account();

-- ---------------------------------------------------------------------------
-- 2. Imports
-- ---------------------------------------------------------------------------
CREATE TABLE public.bank_statement_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL,
  file_name       TEXT,
  line_count      INTEGER NOT NULL,
  imported_count  INTEGER NOT NULL,
  skipped_count   INTEGER NOT NULL,
  first_date      DATE,
  last_date       DATE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_statement_imports_file_name_check CHECK (file_name IS NULL OR length(file_name) <= 255),
  CONSTRAINT bank_statement_imports_account_fkey FOREIGN KEY (org_id, bank_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_bank_statement_imports_org ON public.bank_statement_imports(org_id, created_at DESC);
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_statement_imports_select_policy ON public.bank_statement_imports
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.bank_statement_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.bank_statement_imports TO service_role;

-- p_lines: [{"date": "2026-09-15", "description": "...", "amountCents": -50000, "reference": "QJK7PL9B3"}]
-- Money in is positive. Returns how many lines were added and skipped.
CREATE OR REPLACE FUNCTION public.import_bank_statement(
  p_org_id UUID,
  p_bank_account_id UUID,
  p_file_name TEXT,
  p_lines JSONB,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_line JSONB;
  v_position INTEGER := 0;
  v_date DATE;
  v_description TEXT;
  v_amount BIGINT;
  v_reference TEXT;
  v_key TEXT;
  v_seen JSONB := '{}'::JSONB;
  v_import_id UUID := gen_random_uuid();
  v_imported INTEGER := 0;
  v_first DATE;
  v_last DATE;
  v_count INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  PERFORM private.require_money_account(p_org_id, p_bank_account_id, 'The statement''s account');
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'The statement has no lines to import.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 5000 THEN
    RAISE EXCEPTION 'Import at most 5,000 lines at a time; split the statement by month.' USING ERRCODE = '22023';
  END IF;
  -- One import at a time per account, so two uploads of one file add it once.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':statement:' || p_bank_account_id::TEXT, 0)
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;
    BEGIN
      v_date := (v_line->>'date')::DATE;
      v_amount := (v_line->>'amountCents')::BIGINT;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Line % has a date or amount that cannot be read.', v_position USING ERRCODE = '22023';
    END;
    v_description := left(NULLIF(btrim(regexp_replace(COALESCE(v_line->>'description', ''), '\s+', ' ', 'g')), ''), 500);
    v_reference := left(NULLIF(btrim(COALESCE(v_line->>'reference', '')), ''), 100);
    IF v_date IS NULL OR v_date < DATE '1990-01-01' OR v_date > CURRENT_DATE + 31 THEN
      RAISE EXCEPTION 'Line % has no date, or a date out of range.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_amount IS NULL OR v_amount = 0 OR abs(v_amount) > 900000000000000 THEN
      RAISE EXCEPTION 'Line % needs an amount other than nothing.', v_position USING ERRCODE = '22023';
    END IF;
    v_description := COALESCE(v_description, 'Statement line');

    -- The bank's own reference identifies a line; without one, its date,
    -- amount and particulars do, counted so two identical lines in one file
    -- are both kept.
    IF v_reference IS NOT NULL THEN
      v_key := 'ref:' || lower(v_reference);
    ELSE
      v_key := 'line:' || v_date::TEXT || ':' || v_amount::TEXT || ':' || md5(lower(v_description));
      v_count := COALESCE((v_seen->>v_key)::INTEGER, 0) + 1;
      v_seen := v_seen || jsonb_build_object(v_key, v_count);
      v_key := v_key || ':' || v_count::TEXT;
    END IF;

    INSERT INTO public.bank_transactions (
      org_id, bank_account_id, date, description, amount_cents, direction, status, reference, import_id, import_key
    ) VALUES (
      p_org_id, p_bank_account_id, v_date, v_description, abs(v_amount),
      CASE WHEN v_amount > 0 THEN 'IN' ELSE 'OUT' END, 'UNREVIEWED', v_reference, v_import_id, v_key
    )
    ON CONFLICT (org_id, bank_account_id, import_key) WHERE import_key IS NOT NULL DO NOTHING;
    IF FOUND THEN
      v_imported := v_imported + 1;
    END IF;
    v_first := LEAST(v_first, v_date);
    v_last := GREATEST(v_last, v_date);
  END LOOP;

  INSERT INTO public.bank_statement_imports (
    id, org_id, bank_account_id, file_name, line_count, imported_count, skipped_count, first_date, last_date, created_by
  ) VALUES (
    v_import_id, p_org_id, p_bank_account_id, left(NULLIF(btrim(COALESCE(p_file_name, '')), ''), 255),
    v_position, v_imported, v_position - v_imported, v_first, v_last, p_actor
  );

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'IMPORT', 'BANK_STATEMENT', v_import_id,
    jsonb_build_object('accountId', p_bank_account_id, 'fileName', p_file_name, 'lines', v_position,
      'imported', v_imported, 'firstDate', v_first, 'lastDate', v_last));

  RETURN jsonb_build_object('importId', v_import_id, 'lines', v_position, 'imported', v_imported,
    'skipped', v_position - v_imported, 'firstDate', v_first, 'lastDate', v_last);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Reconciliations
-- ---------------------------------------------------------------------------
CREATE TABLE public.bank_reconciliations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id              UUID NOT NULL,
  statement_date          DATE NOT NULL,
  statement_balance_cents BIGINT NOT NULL,
  opening_balance_cents   BIGINT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  completed_at            TIMESTAMPTZ,
  completed_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  undone_at               TIMESTAMPTZ,
  undone_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  undo_reason             TEXT,
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_reconciliations_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT bank_reconciliations_status_check CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'UNDONE')),
  CONSTRAINT bank_reconciliations_completed_check CHECK ((status = 'IN_PROGRESS') = (completed_at IS NULL)),
  CONSTRAINT bank_reconciliations_undone_check CHECK ((status = 'UNDONE') = (undone_at IS NOT NULL)),
  CONSTRAINT bank_reconciliations_reason_check CHECK (undo_reason IS NULL OR length(undo_reason) <= 500),
  CONSTRAINT bank_reconciliations_account_fkey FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bank_reconciliations_one_open
  ON public.bank_reconciliations(org_id, account_id) WHERE status = 'IN_PROGRESS';
CREATE INDEX idx_bank_reconciliations_account ON public.bank_reconciliations(org_id, account_id, statement_date DESC);

CREATE TABLE public.bank_reconciliation_lines (
  reconciliation_id UUID NOT NULL,
  org_id            UUID NOT NULL,
  journal_line_id   UUID NOT NULL REFERENCES public.journal_lines(id) ON DELETE RESTRICT,
  PRIMARY KEY (reconciliation_id, journal_line_id),
  CONSTRAINT bank_reconciliation_lines_parent_fkey FOREIGN KEY (org_id, reconciliation_id)
    REFERENCES public.bank_reconciliations(org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_bank_reconciliation_lines_line ON public.bank_reconciliation_lines(journal_line_id);

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_reconciliations_select_policy ON public.bank_reconciliations
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY bank_reconciliation_lines_select_policy ON public.bank_reconciliation_lines
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.bank_reconciliations, public.bank_reconciliation_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bank_reconciliations, public.bank_reconciliation_lines TO service_role;

-- Every posted line on the account up to the statement date that no other
-- completed reconciliation has cleared, with whether this one ticks it.
CREATE OR REPLACE FUNCTION public.bank_reconciliation_worksheet(p_org_id UUID, p_reconciliation_id UUID)
RETURNS TABLE (
  journal_line_id UUID, journal_entry_id UUID, entry_date DATE, memo TEXT, reference_no TEXT, source_type TEXT,
  description TEXT, debit NUMERIC, credit NUMERIC, cleared BOOLEAN, on_statement BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT line.id, entry.id, entry.entry_date, entry.memo, entry.reference_no, entry.source_type,
         line.description, line.debit, line.credit,
         EXISTS (SELECT 1 FROM public.bank_reconciliation_lines AS mine
                 WHERE mine.reconciliation_id = rec.id AND mine.journal_line_id = line.id),
         EXISTS (SELECT 1 FROM public.bank_transactions AS tx
                 WHERE tx.org_id = rec.org_id AND tx.bank_account_id = rec.account_id
                   AND tx.matched_journal_entry_id = entry.id AND tx.date <= rec.statement_date)
  FROM public.bank_reconciliations AS rec
  JOIN public.journal_lines AS line ON line.org_id = rec.org_id AND line.account_id = rec.account_id
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  WHERE rec.org_id = p_org_id AND rec.id = p_reconciliation_id
    AND entry.entry_date <= rec.statement_date
    AND NOT EXISTS (
      SELECT 1 FROM public.bank_reconciliation_lines AS done
      JOIN public.bank_reconciliations AS other ON other.id = done.reconciliation_id
      WHERE done.journal_line_id = line.id AND other.status = 'COMPLETED' AND other.id <> rec.id
    )
  ORDER BY entry.entry_date, entry.posted_at, line.id;
$function$;

-- Start reconciling an account to a statement. The opening balance is the
-- last completed statement's closing balance; for an account's first
-- reconciliation it may be given, and is otherwise nothing. Lines already
-- matched to statement lines up to the date start ticked.
CREATE OR REPLACE FUNCTION public.start_bank_reconciliation(
  p_org_id UUID,
  p_account_id UUID,
  p_statement_date DATE,
  p_statement_balance_cents BIGINT,
  p_opening_balance_cents BIGINT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_last RECORD;
  v_id UUID := gen_random_uuid();
  v_opening BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  PERFORM private.require_money_account(p_org_id, p_account_id, 'The account to reconcile');
  IF p_statement_date IS NULL OR p_statement_balance_cents IS NULL THEN
    RAISE EXCEPTION 'Enter the statement date and its closing balance.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':reconcile:' || p_account_id::TEXT, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.bank_reconciliations AS rec
    WHERE rec.org_id = p_org_id AND rec.account_id = p_account_id AND rec.status = 'IN_PROGRESS'
  ) THEN
    RAISE EXCEPTION 'A reconciliation of this account is already under way. Finish or cancel it first.' USING ERRCODE = '23505';
  END IF;
  SELECT rec.statement_date, rec.statement_balance_cents INTO v_last
  FROM public.bank_reconciliations AS rec
  WHERE rec.org_id = p_org_id AND rec.account_id = p_account_id AND rec.status = 'COMPLETED'
  ORDER BY rec.statement_date DESC, rec.completed_at DESC
  LIMIT 1;
  IF FOUND THEN
    IF p_statement_date <= v_last.statement_date THEN
      RAISE EXCEPTION 'This account is reconciled to %. Choose a later statement date.', to_char(v_last.statement_date, 'DD/MM/YYYY')
        USING ERRCODE = '22023';
    END IF;
    v_opening := v_last.statement_balance_cents;
  ELSE
    v_opening := COALESCE(p_opening_balance_cents, 0);
  END IF;

  INSERT INTO public.bank_reconciliations (
    id, org_id, account_id, statement_date, statement_balance_cents, opening_balance_cents, created_by
  ) VALUES (v_id, p_org_id, p_account_id, p_statement_date, p_statement_balance_cents, v_opening, p_actor);

  INSERT INTO public.bank_reconciliation_lines (reconciliation_id, org_id, journal_line_id)
  SELECT v_id, p_org_id, sheet.journal_line_id
  FROM public.bank_reconciliation_worksheet(p_org_id, v_id) AS sheet
  WHERE sheet.on_statement;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'START', 'BANK_RECONCILIATION', v_id,
    jsonb_build_object('accountId', p_account_id, 'statementDate', p_statement_date,
      'statementBalanceCents', p_statement_balance_cents, 'openingBalanceCents', v_opening));

  RETURN jsonb_build_object('id', v_id, 'openingBalanceCents', v_opening);
END;
$function$;

-- The lines ticked so far, replacing the previous set. Returns the totals.
CREATE OR REPLACE FUNCTION public.set_bank_reconciliation_lines(
  p_org_id UUID,
  p_reconciliation_id UUID,
  p_journal_line_ids UUID[],
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rec RECORD;
  v_unknown INTEGER;
  v_cleared BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT rec.* INTO v_rec FROM public.bank_reconciliations AS rec
  WHERE rec.org_id = p_org_id AND rec.id = p_reconciliation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_rec.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'This reconciliation is finished.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(array_length(p_journal_line_ids, 1), 0) > 20000 THEN
    RAISE EXCEPTION 'Too many lines in one reconciliation.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_unknown
  FROM unnest(COALESCE(p_journal_line_ids, ARRAY[]::UUID[])) AS chosen(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bank_reconciliation_worksheet(p_org_id, p_reconciliation_id) AS sheet
    WHERE sheet.journal_line_id = chosen.id
  );
  IF v_unknown > 0 THEN
    RAISE EXCEPTION '% of the ticked lines are not on this account up to the statement date, or were reconciled before.', v_unknown
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.bank_reconciliation_lines WHERE reconciliation_id = p_reconciliation_id;
  INSERT INTO public.bank_reconciliation_lines (reconciliation_id, org_id, journal_line_id)
  SELECT DISTINCT p_reconciliation_id, p_org_id, chosen.id
  FROM unnest(COALESCE(p_journal_line_ids, ARRAY[]::UUID[])) AS chosen(id);
  UPDATE public.bank_reconciliations SET updated_at = now() WHERE id = p_reconciliation_id;

  SELECT COALESCE(sum(line.debit - line.credit), 0)::BIGINT INTO v_cleared
  FROM public.bank_reconciliation_lines AS mine
  JOIN public.journal_lines AS line ON line.id = mine.journal_line_id
  WHERE mine.reconciliation_id = p_reconciliation_id;

  RETURN jsonb_build_object('clearedBalanceCents', v_rec.opening_balance_cents + v_cleared,
    'differenceCents', v_rec.statement_balance_cents - (v_rec.opening_balance_cents + v_cleared));
END;
$function$;

-- Finish: the ticked lines from the opening balance must come to the
-- statement balance exactly.
CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(
  p_org_id UUID,
  p_reconciliation_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rec RECORD;
  v_cleared BIGINT;
  v_count INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT rec.* INTO v_rec FROM public.bank_reconciliations AS rec
  WHERE rec.org_id = p_org_id AND rec.id = p_reconciliation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_rec.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('status', 'COMPLETED');
  END IF;
  IF v_rec.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'This reconciliation was undone.' USING ERRCODE = '23514';
  END IF;
  -- A line cleared meanwhile by another finished reconciliation cannot count twice.
  IF EXISTS (
    SELECT 1 FROM public.bank_reconciliation_lines AS mine
    JOIN public.bank_reconciliation_lines AS done ON done.journal_line_id = mine.journal_line_id
    JOIN public.bank_reconciliations AS other ON other.id = done.reconciliation_id
    WHERE mine.reconciliation_id = p_reconciliation_id AND other.status = 'COMPLETED' AND other.id <> p_reconciliation_id
  ) THEN
    RAISE EXCEPTION 'Some ticked lines were reconciled elsewhere meanwhile. Open the reconciliation again.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(sum(line.debit - line.credit), 0)::BIGINT, count(*) INTO v_cleared, v_count
  FROM public.bank_reconciliation_lines AS mine
  JOIN public.journal_lines AS line ON line.id = mine.journal_line_id
  WHERE mine.reconciliation_id = p_reconciliation_id;
  IF v_rec.opening_balance_cents + v_cleared <> v_rec.statement_balance_cents THEN
    RAISE EXCEPTION 'The ticked lines come to % cents against a statement balance of % cents; the difference is % cents.',
      v_rec.opening_balance_cents + v_cleared, v_rec.statement_balance_cents,
      v_rec.statement_balance_cents - (v_rec.opening_balance_cents + v_cleared)
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.bank_reconciliations
  SET status = 'COMPLETED', completed_at = now(), completed_by = p_actor, updated_at = now()
  WHERE id = p_reconciliation_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'COMPLETE', 'BANK_RECONCILIATION', p_reconciliation_id,
    jsonb_build_object('accountId', v_rec.account_id, 'statementDate', v_rec.statement_date,
      'statementBalanceCents', v_rec.statement_balance_cents, 'clearedLines', v_count));

  RETURN jsonb_build_object('status', 'COMPLETED', 'clearedLines', v_count);
END;
$function$;

-- Cancel one under way (nothing was recorded), or undo the latest finished
-- one of its account with a reason.
CREATE OR REPLACE FUNCTION public.undo_bank_reconciliation(
  p_org_id UUID,
  p_reconciliation_id UUID,
  p_reason TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rec RECORD;
  v_reason TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT rec.* INTO v_rec FROM public.bank_reconciliations AS rec
  WHERE rec.org_id = p_org_id AND rec.id = p_reconciliation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_rec.status = 'IN_PROGRESS' THEN
    DELETE FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
    VALUES (p_org_id, p_actor, 'CANCEL', 'BANK_RECONCILIATION', p_reconciliation_id,
      jsonb_build_object('accountId', v_rec.account_id, 'statementDate', v_rec.statement_date));
    RETURN jsonb_build_object('status', 'CANCELLED');
  END IF;
  IF v_rec.status = 'UNDONE' THEN
    RETURN jsonb_build_object('status', 'UNDONE');
  END IF;
  v_reason := private.require_reason(p_reason, 'this reconciliation');
  IF EXISTS (
    SELECT 1 FROM public.bank_reconciliations AS later
    WHERE later.org_id = p_org_id AND later.account_id = v_rec.account_id AND later.id <> v_rec.id
      AND later.status IN ('COMPLETED', 'IN_PROGRESS') AND later.statement_date > v_rec.statement_date
  ) THEN
    RAISE EXCEPTION 'Only the latest reconciliation of an account can be undone. Undo or cancel the later ones first.'
      USING ERRCODE = '23514';
  END IF;
  UPDATE public.bank_reconciliations
  SET status = 'UNDONE', undone_at = now(), undone_by = p_actor, undo_reason = v_reason, updated_at = now()
  WHERE id = p_reconciliation_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'UNDO', 'BANK_RECONCILIATION', p_reconciliation_id,
    jsonb_build_object('accountId', v_rec.account_id, 'statementDate', v_rec.statement_date, 'reason', v_reason));
  RETURN jsonb_build_object('status', 'UNDONE');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Matching a statement line posts against that line's own account.
-- Otherwise as in 20261004000400.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_bank_transaction(
  p_org_id UUID,
  p_transaction_id UUID,
  p_target_account_id UUID,
  p_existing_journal_entry_id UUID,
  p_invoice_id UUID,
  p_bill_id UUID,
  p_actor UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tx RECORD;
  v_bank_account_id UUID;
  v_target RECORD;
  v_entry_id UUID;
  v_net NUMERIC;
  v_expected NUMERIC;
  v_result JSONB;
  v_key TEXT;
  v_previous_matches INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF (p_target_account_id IS NOT NULL)::INT + (p_existing_journal_entry_id IS NOT NULL)::INT
     + (p_invoice_id IS NOT NULL)::INT + (p_bill_id IS NOT NULL)::INT <> 1 THEN
    RAISE EXCEPTION 'Choose exactly one of an account, a posted entry, an invoice or a bill to match this line to.'
      USING ERRCODE = '22023';
  END IF;

  SELECT tx.id, tx.date, tx.description, tx.amount_cents, tx.direction, tx.status, tx.bank_account_id
  INTO v_tx
  FROM public.bank_transactions AS tx
  WHERE tx.org_id = p_org_id AND tx.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement line not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_tx.status = 'MATCHED' THEN
    RAISE EXCEPTION 'This statement line is already matched.' USING ERRCODE = '23505';
  END IF;
  IF v_tx.amount_cents IS NULL OR v_tx.amount_cents <= 0 THEN
    RAISE EXCEPTION 'The statement line amount must be a positive number of cents.' USING ERRCODE = '22023';
  END IF;

  -- The posting's key names this line and how many times it has been matched
  -- before, so a retry returns the same posting while a fresh match after an
  -- undo or a payment reversal posts anew.
  SELECT count(*) INTO v_previous_matches
  FROM public.audit_logs AS log
  WHERE log.org_id = p_org_id AND log.resource_type = 'BANK_TRANSACTION'
    AND log.resource_id = p_transaction_id AND log.action = 'MATCH';
  v_key := 'bank-match:' || p_transaction_id::TEXT
    || CASE WHEN v_previous_matches = 0 THEN '' ELSE ':' || v_previous_matches::TEXT END;

  -- The line's own account; a line from before statements had one is account 1000's.
  IF v_tx.bank_account_id IS NOT NULL THEN
    PERFORM private.require_money_account(p_org_id, v_tx.bank_account_id, 'The statement''s account');
    v_bank_account_id := v_tx.bank_account_id;
  ELSE
    SELECT account.id INTO v_bank_account_id
    FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.code = '1000' AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The bank account (1000) was not found in the chart of accounts.' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_invoice_id IS NOT NULL THEN
    IF v_tx.direction <> 'IN' THEN
      RAISE EXCEPTION 'Only money coming in can pay an invoice.' USING ERRCODE = '22023';
    END IF;
    v_result := public.receive_invoice_payment(p_org_id, p_invoice_id, v_tx.amount_cents, v_tx.date,
      v_bank_account_id, v_key, p_actor);
    v_entry_id := (v_result ->> 'journalEntryId')::UUID;
  ELSIF p_bill_id IS NOT NULL THEN
    IF v_tx.direction <> 'OUT' THEN
      RAISE EXCEPTION 'Only money going out can pay a bill.' USING ERRCODE = '22023';
    END IF;
    v_result := public.pay_bill(p_org_id, p_bill_id, v_tx.amount_cents, v_tx.date,
      v_bank_account_id, v_key, p_actor);
    v_entry_id := (v_result ->> 'journalEntryId')::UUID;
  ELSIF p_existing_journal_entry_id IS NOT NULL THEN
    SELECT COALESCE(sum(line.debit - line.credit), 0) INTO v_net
    FROM public.journal_lines AS line
    WHERE line.org_id = p_org_id AND line.journal_entry_id = p_existing_journal_entry_id
      AND line.account_id = v_bank_account_id;
    PERFORM 1 FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id AND entry.id = p_existing_journal_entry_id;
    IF NOT FOUND OR v_net = 0 THEN
      RAISE EXCEPTION 'That entry does not move the bank account, or belongs to another organization.' USING ERRCODE = '23503';
    END IF;
    v_expected := CASE WHEN v_tx.direction = 'IN' THEN v_tx.amount_cents ELSE -v_tx.amount_cents END;
    IF v_net <> v_expected THEN
      RAISE EXCEPTION 'That entry moves the bank account by a different amount or in the other direction, so it cannot stand for this line.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.bank_transactions AS other
    WHERE other.org_id = p_org_id AND other.matched_journal_entry_id = p_existing_journal_entry_id;
    IF FOUND THEN
      RAISE EXCEPTION 'That entry is already matched to another statement line.' USING ERRCODE = '23505';
    END IF;
    v_entry_id := p_existing_journal_entry_id;
  ELSE
    SELECT account.id, account.code INTO v_target
    FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = p_target_account_id AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The target account is inactive or belongs to another organization.' USING ERRCODE = '23503';
    END IF;
    IF v_target.id = v_bank_account_id THEN
      RAISE EXCEPTION 'A statement line cannot be posted back to the bank account itself.' USING ERRCODE = '22023';
    END IF;
    -- public.post_journal_entry refuses accounts receivable and payable.
    v_entry_id := public.post_journal_entry(
      p_org_id, v_tx.date, 'Bank match: ' || v_tx.description, 'BANK', v_tx.id, NULL, p_actor,
      CASE WHEN v_tx.direction = 'IN' THEN jsonb_build_array(
        jsonb_build_object('accountId', v_bank_account_id, 'debit', v_tx.amount_cents, 'credit', 0, 'description', v_tx.description),
        jsonb_build_object('accountId', v_target.id, 'debit', 0, 'credit', v_tx.amount_cents, 'description', v_tx.description))
      ELSE jsonb_build_array(
        jsonb_build_object('accountId', v_target.id, 'debit', v_tx.amount_cents, 'credit', 0, 'description', v_tx.description),
        jsonb_build_object('accountId', v_bank_account_id, 'debit', 0, 'credit', v_tx.amount_cents, 'description', v_tx.description))
      END,
      v_key
    );
  END IF;

  UPDATE public.bank_transactions
  SET status = 'MATCHED', matched_journal_entry_id = v_entry_id
  WHERE org_id = p_org_id AND id = p_transaction_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'MATCH', 'BANK_TRANSACTION', p_transaction_id,
    jsonb_build_object('journalEntryId', v_entry_id, 'amountCents', v_tx.amount_cents, 'direction', v_tx.direction,
      'target', CASE WHEN p_invoice_id IS NOT NULL THEN 'INVOICE' WHEN p_bill_id IS NOT NULL THEN 'BILL'
        WHEN p_existing_journal_entry_id IS NOT NULL THEN 'ENTRY' ELSE 'ACCOUNT' END));

  RETURN v_entry_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_bank_statement(UUID, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bank_reconciliation_worksheet(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_bank_reconciliation(UUID, UUID, DATE, BIGINT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_bank_reconciliation_lines(UUID, UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_bank_reconciliation(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.undo_bank_reconciliation(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(UUID, UUID, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.bank_reconciliation_worksheet(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_bank_reconciliation(UUID, UUID, DATE, BIGINT, BIGINT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_bank_reconciliation_lines(UUID, UUID, UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_bank_reconciliation(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_bank_reconciliation(UUID, UUID, TEXT, UUID) TO service_role;

-- Rollback: restore match_bank_transaction from 20261004000400; drop the six
-- functions above, public.bank_reconciliation_lines, public.bank_reconciliations,
-- public.bank_statement_imports, the trigger and private.default_statement_account,
-- and the added columns, index and constraints on public.bank_transactions.
