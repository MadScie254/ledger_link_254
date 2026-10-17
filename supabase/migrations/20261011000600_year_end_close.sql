-- A year-end transfer is a posted journal, with a separate posted reversal.
CREATE TABLE public.year_end_closes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year_start DATE NOT NULL,
  year_end DATE NOT NULL,
  previous_closed_through DATE,
  journal_entry_id UUID NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reopening_reason TEXT,
  reversal_journal_entry_id UUID,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, journal_entry_id) REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, reversal_journal_entry_id) REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  CHECK (year_end >= year_start),
  CHECK ((reopened_at IS NULL) = (reversal_journal_entry_id IS NULL))
);
CREATE UNIQUE INDEX year_end_one_active_close ON public.year_end_closes(org_id, year_end)
  WHERE reopened_at IS NULL;
ALTER TABLE public.year_end_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY year_end_closes_read ON public.year_end_closes FOR SELECT
  USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.year_end_closes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.year_end_closes TO service_role;

CREATE OR REPLACE FUNCTION private.protect_year_end_settings()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF (NEW.books_closed_through IS DISTINCT FROM OLD.books_closed_through
      OR NEW.fiscal_year_start IS DISTINCT FROM OLD.fiscal_year_start)
     AND EXISTS (SELECT 1 FROM public.year_end_closes WHERE org_id = OLD.id AND reopened_at IS NULL)
     AND current_setting('ledger_link.year_end_transition', true) IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Reopen the recorded year-end close before changing its closing date or fiscal year.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.protect_year_end_settings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_year_end_settings BEFORE UPDATE OF books_closed_through, fiscal_year_start ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.protect_year_end_settings();

CREATE OR REPLACE FUNCTION public.close_financial_year(p_org_id UUID, p_year_end DATE, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org RECORD;
  v_month INTEGER;
  v_start DATE;
  v_previous_end DATE;
  v_account RECORD;
  v_balance BIGINT;
  v_sum BIGINT := 0;
  v_lines JSONB := '[]'::jsonb;
  v_close_id UUID := gen_random_uuid();
  v_journal_id UUID;
  v_currency TEXT;
BEGIN
  PERFORM 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_actor AND role::text IN ('owner', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an owner or admin can close a financial year.' USING ERRCODE = '42501'; END IF;
  IF p_year_end IS NULL THEN RAISE EXCEPTION 'A financial year-end date is required.' USING ERRCODE = '22023'; END IF;
  SELECT id, fiscal_year_start, books_closed_through, upper(base_currency) AS currency INTO v_org
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503'; END IF;
  v_currency := v_org.currency;
  v_month := array_position(ARRAY['January','February','March','April','May','June','July','August',
    'September','October','November','December'], v_org.fiscal_year_start);
  IF v_month IS NULL THEN RAISE EXCEPTION 'The financial year start month is invalid.' USING ERRCODE = '22023'; END IF;
  v_start := make_date(EXTRACT(YEAR FROM p_year_end)::integer - CASE WHEN v_month = 1 THEN 0 ELSE 1 END, v_month, 1);
  IF p_year_end <> (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'The close date is not the last day of this financial year.' USING ERRCODE = '22023';
  END IF;
  v_previous_end := v_start - 1;
  IF v_org.books_closed_through IS NOT NULL AND v_org.books_closed_through <> v_previous_end THEN
    RAISE EXCEPTION 'The previous financial year must be closed through the day before this year starts.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_lines AS line
    JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
    JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
    WHERE line.org_id = p_org_id AND entry.entry_date < v_start
      AND account.type IN ('INCOME','COGS','EXPENSE')
    GROUP BY account.id HAVING sum(line.debit - line.credit) <> 0) THEN
    RAISE EXCEPTION 'Earlier income or expense balances must be closed first.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND code = '3100'
    AND type = 'EQUITY' AND currency = v_currency AND is_active) THEN
    RAISE EXCEPTION 'Active Retained Earnings account 3100 is required.' USING ERRCODE = '23503';
  END IF;
  FOR v_account IN
    SELECT account.id, account.code, COALESCE(sum(line.debit - line.credit), 0)::bigint AS balance
    FROM public.accounts AS account
    LEFT JOIN (
      SELECT period_line.account_id, period_line.debit, period_line.credit
      FROM public.journal_lines AS period_line
      JOIN public.journal_entries AS entry ON entry.org_id = period_line.org_id
        AND entry.id = period_line.journal_entry_id
      WHERE period_line.org_id = p_org_id AND entry.entry_date BETWEEN v_start AND p_year_end
        AND entry.source_type IS DISTINCT FROM 'YEAR_END_CLOSE'
        AND entry.source_type IS DISTINCT FROM 'YEAR_END_REOPEN'
    ) AS line ON line.account_id = account.id
    WHERE account.org_id = p_org_id AND account.type IN ('INCOME','COGS','EXPENSE')
    GROUP BY account.id, account.code ORDER BY account.code, account.id
  LOOP
    v_balance := v_account.balance;
    IF v_balance = 0 THEN CONTINUE; END IF;
    v_sum := v_sum + v_balance;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_account.id, 'debit', GREATEST(-v_balance, 0), 'credit', GREATEST(v_balance, 0),
      'description', 'Year-end close ' || v_account.code));
  END LOOP;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'This financial year has no income or expense balances to close.' USING ERRCODE = '23514';
  END IF;
  IF v_sum <> 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', (SELECT id FROM public.accounts WHERE org_id = p_org_id AND code = '3100'),
      'debit', GREATEST(v_sum, 0), 'credit', GREATEST(-v_sum, 0),
      'description', 'Transfer annual result to retained earnings'));
  END IF;
  v_journal_id := private.insert_journal_entry(p_org_id, p_year_end,
    'Close financial year ending ' || p_year_end::text, 'YEAR_END_CLOSE', v_close_id,
    'YEAR-END-' || p_year_end::text, p_actor, v_lines, 'year-end-close:' || v_close_id::text);
  INSERT INTO public.year_end_closes(id, org_id, year_start, year_end, previous_closed_through, journal_entry_id, created_by)
    VALUES(v_close_id, p_org_id, v_start, p_year_end, v_org.books_closed_through, v_journal_id, p_actor);
  PERFORM set_config('ledger_link.year_end_transition', 'active', true);
  UPDATE public.organizations SET books_closed_through = p_year_end WHERE id = p_org_id;
  PERFORM set_config('ledger_link.year_end_transition', '', true);
  INSERT INTO public.audit_logs(org_id, user_id, action, resource_type, resource_id, details)
    VALUES(p_org_id, p_actor, 'CREATE', 'YEAR_END_CLOSE', v_close_id,
      jsonb_build_object('yearEnd', p_year_end, 'journalEntryId', v_journal_id));
  RETURN jsonb_build_object('id', v_close_id, 'journalEntryId', v_journal_id, 'yearEnd', p_year_end);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_financial_year(p_org_id UUID, p_close_id UUID, p_reason TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_org RECORD; v_close RECORD; v_reason TEXT; v_reversal_id UUID;
BEGIN
  PERFORM 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_actor AND role::text IN ('owner', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an owner or admin can reopen a financial year.' USING ERRCODE = '42501'; END IF;
  v_reason := private.require_reason(p_reason, 'this financial year');
  SELECT id, books_closed_through INTO v_org FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503'; END IF;
  SELECT id, year_end, previous_closed_through, journal_entry_id, reopened_at, reversal_journal_entry_id INTO v_close
  FROM public.year_end_closes WHERE org_id = p_org_id AND id = p_close_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Year-end close not found in this organization.' USING ERRCODE = '23503'; END IF;
  IF v_close.reopened_at IS NOT NULL THEN
    RETURN jsonb_build_object('reversalJournalEntryId', v_close.reversal_journal_entry_id, 'yearEnd', v_close.year_end);
  END IF;
  IF v_org.books_closed_through IS DISTINCT FROM v_close.year_end THEN
    RAISE EXCEPTION 'Reopen the latest closed financial year first.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('ledger_link.year_end_transition', 'active', true);
  UPDATE public.organizations SET books_closed_through = v_close.previous_closed_through WHERE id = p_org_id;
  PERFORM set_config('ledger_link.year_end_transition', '', true);
  v_reversal_id := private.insert_journal_entry(p_org_id, v_close.year_end,
    'Reopen financial year ending ' || v_close.year_end::text, 'YEAR_END_REOPEN', v_close.id,
    'REV-YEAR-END-' || v_close.year_end::text, p_actor,
    private.reversal_lines(p_org_id, v_close.journal_entry_id, 'Year-end close'),
    'year-end-reopen:' || v_close.id::text);
  UPDATE public.year_end_closes SET reopened_at = now(), reopened_by = p_actor,
    reopening_reason = v_reason, reversal_journal_entry_id = v_reversal_id
  WHERE org_id = p_org_id AND id = p_close_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, resource_type, resource_id, details)
    VALUES(p_org_id, p_actor, 'REVERSE', 'YEAR_END_CLOSE', p_close_id,
      jsonb_build_object('reason', v_reason, 'reversalJournalEntryId', v_reversal_id));
  RETURN jsonb_build_object('reversalJournalEntryId', v_reversal_id, 'yearEnd', v_close.year_end);
END;
$function$;

CREATE OR REPLACE FUNCTION public.profit_and_loss_account_totals(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE(account_id UUID, debit_cents NUMERIC, credit_cents NUMERIC)
LANGUAGE sql STABLE SET search_path = '' AS $function$
  SELECT line.account_id, sum(line.debit), sum(line.credit)
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  WHERE line.org_id = p_org_id AND entry.entry_date BETWEEN p_from AND p_to
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_CLOSE'
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_REOPEN'
  GROUP BY line.account_id ORDER BY line.account_id;
$function$;

CREATE OR REPLACE FUNCTION public.account_monthly_totals(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE(period TEXT, account_id UUID, debit_cents NUMERIC, credit_cents NUMERIC)
LANGUAGE sql STABLE SET search_path = '' AS $function$
  SELECT pg_catalog.to_char(entry.entry_date, 'YYYY-MM'), line.account_id, sum(line.debit), sum(line.credit)
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  WHERE line.org_id = p_org_id AND entry.entry_date BETWEEN p_from AND p_to
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_CLOSE'
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_REOPEN'
  GROUP BY 1, line.account_id ORDER BY 1, line.account_id;
$function$;

REVOKE ALL ON FUNCTION public.close_financial_year(UUID, DATE, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_financial_year(UUID, DATE, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.reopen_financial_year(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_financial_year(UUID, UUID, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.profit_and_loss_account_totals(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profit_and_loss_account_totals(UUID, DATE, DATE) TO service_role;
