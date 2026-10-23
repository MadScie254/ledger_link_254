-- Review of the payroll-and-close migrations (20261011000100 to 000700).
--
-- 1. Year-end entries stay out of every period report. The close and its
--    reopening were left out of the profit and loss and the monthly totals,
--    but not out of the profit and loss by class or location, the church fund
--    balances or the treasurer's report. After a close, any period holding
--    the year-end date showed the year's income and spending cancelled, and a
--    church's general fund fell by every restricted fund's surplus.
-- 2. The closing date keeps working after a year-end close. It could not move
--    at all while a close stood, so a month could not be locked after its
--    VAT return without reopening the year. It may now move later, or back
--    to the end of the last closed year, never earlier. The financial year
--    start stays fixed until the close is reopened.
-- 3. A year is closed only after it has ended (in the organization's time
--    zone), once, and not under a later close. The books may already be
--    closed through any earlier date; earlier income and expense balances
--    must still be closed first.
-- 4. Reopening names what blocks it: a later closed year, or a closing date
--    beyond the year-end that has to be moved back first.
-- 5. A pay run whose net salaries stand paid is not reversed until that
--    salary payment is reversed, as a paid invoice is not voided. Otherwise
--    the reversed run left Net Salaries Payable (2165) in debit and its
--    corrected run invited a second payment.
-- 6. A new pay run must name a stored statutory rate version.

-- ---------------------------------------------------------------------------
-- 1. Year-end entries out of period reports
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profit_and_loss_by_tag(p_org_id UUID, p_kind TEXT, p_from DATE, p_to DATE)
RETURNS TABLE (tag_id UUID, account_id UUID, debit_cents NUMERIC, credit_cents NUMERIC)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT CASE WHEN p_kind = 'CLASS' THEN entry.class_id ELSE entry.location_id END,
         line.account_id, sum(line.debit), sum(line.credit)
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
  WHERE line.org_id = p_org_id AND entry.entry_date BETWEEN p_from AND p_to
    AND account.type::TEXT IN ('INCOME', 'COGS', 'EXPENSE')
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_CLOSE'
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_REOPEN'
  GROUP BY 1, line.account_id;
$function$;

CREATE OR REPLACE FUNCTION public.fund_balances(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (fund_id UUID, code TEXT, name TEXT, restricted BOOLEAN, is_active BOOLEAN,
  opening_cents BIGINT, income_cents BIGINT, expense_cents BIGINT, closing_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH general AS (
    SELECT fund.id FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.code = 'GENERAL'
  ), lines AS (
    SELECT CASE WHEN line.entity_type = 'FUND' THEN line.entity_id ELSE (SELECT id FROM general) END AS fund_id,
           entry.entry_date, account.type::TEXT AS type, line.debit, line.credit
    FROM public.journal_lines AS line
    JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
    JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
    WHERE line.org_id = p_org_id AND account.type IN ('INCOME', 'EXPENSE', 'COGS') AND entry.entry_date <= p_to
      AND entry.source_type IS DISTINCT FROM 'YEAR_END_CLOSE'
      AND entry.source_type IS DISTINCT FROM 'YEAR_END_REOPEN'
  ), sums AS (
    SELECT lines.fund_id,
      COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.entry_date < p_from), 0) AS opening,
      COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.entry_date >= p_from AND lines.type = 'INCOME'), 0) AS income,
      COALESCE(sum(lines.debit - lines.credit) FILTER (WHERE lines.entry_date >= p_from AND lines.type <> 'INCOME'), 0) AS expense
    FROM lines GROUP BY lines.fund_id
  )
  SELECT fund.id, fund.code, fund.name, fund.restricted, fund.is_active,
         COALESCE(sums.opening, 0)::BIGINT, COALESCE(sums.income, 0)::BIGINT, COALESCE(sums.expense, 0)::BIGINT,
         (COALESCE(sums.opening, 0) + COALESCE(sums.income, 0) - COALESCE(sums.expense, 0))::BIGINT
  FROM public.funds AS fund
  LEFT JOIN sums ON sums.fund_id = fund.id
  WHERE fund.org_id = p_org_id
  ORDER BY fund.code = 'GENERAL' DESC, fund.code;
$function$;

CREATE OR REPLACE FUNCTION public.church_treasurer_lines(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (kind TEXT, fund_id UUID, account_id UUID, account_code TEXT, account_name TEXT, amount_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH general AS (
    SELECT fund.id FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.code = 'GENERAL'
  )
  SELECT CASE WHEN account.type = 'INCOME' THEN 'INCOME' ELSE 'EXPENSE' END,
         CASE WHEN line.entity_type = 'FUND' THEN line.entity_id ELSE (SELECT id FROM general) END,
         account.id, account.code, account.name,
         sum(CASE WHEN account.type = 'INCOME' THEN line.credit - line.debit ELSE line.debit - line.credit END)::BIGINT
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
  WHERE line.org_id = p_org_id AND account.type IN ('INCOME', 'EXPENSE', 'COGS')
    AND entry.entry_date BETWEEN p_from AND p_to
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_CLOSE'
    AND entry.source_type IS DISTINCT FROM 'YEAR_END_REOPEN'
  GROUP BY 1, 2, account.id, account.code, account.name
  UNION ALL
  SELECT 'MONEY', NULL, account.id, account.code, account.name,
         COALESCE(sum(line.debit - line.credit) FILTER (WHERE entry.entry_date <= p_to), 0)::BIGINT
  FROM public.accounts AS account
  LEFT JOIN public.journal_lines AS line ON line.org_id = account.org_id AND line.account_id = account.id
  LEFT JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  WHERE account.org_id = p_org_id AND account.is_bank_account AND account.type = 'ASSET' AND account.is_active
  GROUP BY account.id, account.code, account.name;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The closing date after a year-end close
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.protect_year_end_settings()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE
  v_latest DATE;
BEGIN
  IF current_setting('ledger_link.year_end_transition', true) IS NOT DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  SELECT max(close.year_end) INTO v_latest
  FROM public.year_end_closes AS close
  WHERE close.org_id = OLD.id AND close.reopened_at IS NULL;
  IF v_latest IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.fiscal_year_start IS DISTINCT FROM OLD.fiscal_year_start THEN
    RAISE EXCEPTION 'Reopen the year-end close for the year ending % before changing the financial year start.',
      pg_catalog.to_char(v_latest, 'DD/MM/YYYY') USING ERRCODE = '23514';
  END IF;
  IF NEW.books_closed_through IS DISTINCT FROM OLD.books_closed_through
     AND (NEW.books_closed_through IS NULL OR NEW.books_closed_through < v_latest) THEN
    RAISE EXCEPTION 'The financial year ending % is closed. The closing date can move later, or back to %, but not earlier until that year is reopened.',
      pg_catalog.to_char(v_latest, 'DD/MM/YYYY'), pg_catalog.to_char(v_latest, 'DD/MM/YYYY') USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.protect_year_end_settings() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Closing a year
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_financial_year(p_org_id UUID, p_year_end DATE, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org RECORD;
  v_month INTEGER;
  v_start DATE;
  v_today DATE;
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
  SELECT id, fiscal_year_start, books_closed_through, upper(base_currency) AS currency,
         COALESCE(time_zone, 'Africa/Nairobi') AS time_zone INTO v_org
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
  v_today := (now() AT TIME ZONE v_org.time_zone)::date;
  IF p_year_end >= v_today THEN
    RAISE EXCEPTION 'The financial year ending % has not ended yet. Close it from %.',
      pg_catalog.to_char(p_year_end, 'DD/MM/YYYY'), pg_catalog.to_char(p_year_end + 1, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.year_end_closes
             WHERE org_id = p_org_id AND reopened_at IS NULL AND year_end = p_year_end) THEN
    RAISE EXCEPTION 'The financial year ending % is already closed.',
      pg_catalog.to_char(p_year_end, 'DD/MM/YYYY') USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.year_end_closes
             WHERE org_id = p_org_id AND reopened_at IS NULL AND year_end > p_year_end) THEN
    RAISE EXCEPTION 'A later financial year is closed. Reopen it before closing an earlier one.' USING ERRCODE = '23514';
  END IF;
  IF v_org.books_closed_through IS NOT NULL AND v_org.books_closed_through >= p_year_end THEN
    RAISE EXCEPTION 'The books are closed through %. Move the closing date back before % to post the year-end close.',
      pg_catalog.to_char(v_org.books_closed_through, 'DD/MM/YYYY'), pg_catalog.to_char(p_year_end, 'DD/MM/YYYY')
      USING ERRCODE = '23514';
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
      jsonb_build_object('yearEnd', p_year_end, 'journalEntryId', v_journal_id,
        'previousClosedThrough', v_org.books_closed_through));
  RETURN jsonb_build_object('id', v_close_id, 'journalEntryId', v_journal_id, 'yearEnd', p_year_end);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Reopening a year
-- ---------------------------------------------------------------------------

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
  IF EXISTS (SELECT 1 FROM public.year_end_closes
             WHERE org_id = p_org_id AND reopened_at IS NULL AND year_end > v_close.year_end) THEN
    RAISE EXCEPTION 'Reopen the latest closed financial year first.' USING ERRCODE = '23514';
  END IF;
  IF v_org.books_closed_through IS DISTINCT FROM v_close.year_end THEN
    RAISE EXCEPTION 'The books are closed through %. Move the closing date back to % before reopening this year.',
      COALESCE(pg_catalog.to_char(v_org.books_closed_through, 'DD/MM/YYYY'), 'no date'),
      pg_catalog.to_char(v_close.year_end, 'DD/MM/YYYY') USING ERRCODE = '23514';
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

-- ---------------------------------------------------------------------------
-- 5. A paid pay run is reversed after its salary payment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reverse_payroll_run(
  p_org_id UUID,
  p_run_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_reason := private.require_reason(p_reason, 'this payroll run');
  IF p_reversal_date IS NULL THEN
    RAISE EXCEPTION 'A reversal date is required.' USING ERRCODE = '22023';
  END IF;

  -- The run lock is taken first, as pay_salaries and reverse_salary_payment
  -- take it, so no payment can be posted while this check runs.
  SELECT run.id, run.period, run.pay_date, run.journal_entry_id, run.reversed_at, run.reversal_journal_entry_id
  INTO v_run
  FROM public.payroll_runs AS run
  WHERE run.org_id = p_org_id AND run.id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_run.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object('reversalJournalEntryId', v_run.reversal_journal_entry_id, 'period', v_run.period);
  END IF;
  IF v_run.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'This payroll run has no posting to reverse.' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.salary_payments AS payment
             WHERE payment.org_id = p_org_id AND payment.payroll_run_id = p_run_id AND payment.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'Net salaries for % are recorded as paid. Reverse that salary payment first, then the pay run.',
      v_run.period USING ERRCODE = '23514';
  END IF;
  IF p_reversal_date < v_run.pay_date THEN
    RAISE EXCEPTION 'A reversal cannot be dated before the pay date it reverses.' USING ERRCODE = '22023';
  END IF;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_reversal_date, 'Reverse payroll — ' || v_run.period,
    'ADJUSTMENT', v_run.id, 'REV-' || v_run.period, p_actor,
    private.reversal_lines(p_org_id, v_run.journal_entry_id, v_run.period),
    'payroll-reversal:' || p_run_id::TEXT
  );

  -- The request key is retired with the run, so a corrected run for the
  -- same month can be posted.
  UPDATE public.payroll_runs
  SET reversed_at = now(), reversed_by = p_actor,
      reversal_journal_entry_id = v_reversal_id, reversal_reason = v_reason,
      idempotency_key = CASE WHEN idempotency_key IS NULL THEN NULL
        ELSE idempotency_key || ':reversed:' || id::TEXT END
  WHERE org_id = p_org_id AND id = p_run_id;

  UPDATE public.bank_transactions
  SET status = 'UNREVIEWED', matched_journal_entry_id = NULL
  WHERE org_id = p_org_id AND matched_journal_entry_id = v_run.journal_entry_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_actor, 'REVERSE', 'PAYROLL_RUN', p_run_id,
    jsonb_build_object('period', v_run.period, 'reason', v_reason, 'reversalJournalEntryId', v_reversal_id)
  );

  RETURN jsonb_build_object('reversalJournalEntryId', v_reversal_id, 'period', v_run.period);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. A new pay run names a stored rate version
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.check_payroll_rate_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.statutory_rate_tables WHERE version = NEW.rate_version) THEN
    RAISE EXCEPTION 'Rate version % is not one of the stored statutory rate versions.', NEW.rate_version
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.check_payroll_rate_version() FROM PUBLIC, anon, authenticated;
-- Earlier runs keep what they hold, including 'legacy-unversioned'; only
-- new runs are checked.
CREATE TRIGGER check_payroll_rate_version BEFORE INSERT ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION private.check_payroll_rate_version();

-- Rollback: re-run the function definitions from 20261005001000
-- (profit_and_loss_by_tag), 20261009000300 (fund_balances,
-- church_treasurer_lines), 20261011000600 (protect_year_end_settings,
-- close_financial_year, reopen_financial_year) and 20261004000100
-- (reverse_payroll_run); DROP TRIGGER check_payroll_rate_version ON
-- public.payroll_runs; DROP FUNCTION private.check_payroll_rate_version().
