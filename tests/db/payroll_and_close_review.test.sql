\c lltest
\set ON_ERROR_STOP 1
-- The review of the payroll-and-close migrations (20261022000100): year-end
-- entries kept out of period reports, the closing date after a close, the
-- close and reopen guards. The salary-payment rule is in
-- salary_payments.test.sql.
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_retail UUID;
  v_close_2025 JSONB;
  v_close_2026 JSONB;
  v_failed BOOLEAN;
  v_message TEXT;
BEGIN
  -- Financial years run July to June, so both closed years have ended.
  UPDATE public.organizations SET fiscal_year_start = 'July' WHERE id = v_org;
  INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'CLASS', 'Retail') RETURNING id INTO v_retail;
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-class', v_retail)::TEXT, true);
  PERFORM private.insert_journal_entry(v_org, DATE '2025-03-15', 'Retail sales', 'MANUAL', NULL, 'REV-1', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', v_bank, 'debit', 10000, 'credit', 0),
      jsonb_build_object('accountId', v_sales, 'debit', 0, 'credit', 10000)));
  PERFORM set_config('request.headers', '', true);
  PERFORM private.insert_journal_entry(v_org, DATE '2025-04-01', 'Rent', 'MANUAL', NULL, 'EXP-1', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', v_opex, 'debit', 4000, 'credit', 0),
      jsonb_build_object('accountId', v_bank, 'debit', 0, 'credit', 4000)));

  -- A year that has not ended is not closed.
  v_failed := false;
  BEGIN PERFORM public.close_financial_year(v_org, DATE '2099-06-30', v_owner);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; v_message := SQLERRM; END;
  IF NOT v_failed OR v_message NOT LIKE '%has not ended yet%' THEN
    RAISE EXCEPTION 'A financial year was closed before it ended: %', v_message;
  END IF;

  v_close_2025 := public.close_financial_year(v_org, DATE '2025-06-30', v_owner);

  -- The profit and loss by class keeps the year's activity after the close.
  IF (SELECT COALESCE(sum(credit_cents - debit_cents), 0) FROM public.profit_and_loss_by_tag(v_org, 'CLASS', DATE '2024-07-01', DATE '2025-06-30')
      WHERE account_id = v_sales) <> 10000
     OR (SELECT COALESCE(sum(credit_cents - debit_cents), 0) FROM public.profit_and_loss_by_tag(v_org, 'CLASS', DATE '2024-07-01', DATE '2025-06-30')
      WHERE account_id = v_sales AND tag_id = v_retail) <> 10000
     OR (SELECT COALESCE(sum(debit_cents - credit_cents), 0) FROM public.profit_and_loss_by_tag(v_org, 'CLASS', DATE '2024-07-01', DATE '2025-06-30')
      WHERE account_id = v_opex) <> 4000 THEN
    RAISE EXCEPTION 'The profit and loss by class counted the year-end close.';
  END IF;

  -- The closing date moves later, and back to the year-end, never earlier.
  UPDATE public.organizations SET books_closed_through = DATE '2025-09-30' WHERE id = v_org;
  v_failed := false;
  BEGIN
    PERFORM private.insert_journal_entry(v_org, DATE '2025-09-15', 'Inside the lock', 'MANUAL', NULL, 'LOCKED', v_owner,
      jsonb_build_array(
        jsonb_build_object('accountId', v_bank, 'debit', 100, 'credit', 0),
        jsonb_build_object('accountId', v_sales, 'debit', 0, 'credit', 100)));
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'An entry was posted inside the moved closing date.'; END IF;
  UPDATE public.organizations SET books_closed_through = DATE '2025-06-30' WHERE id = v_org;
  UPDATE public.organizations SET books_closed_through = DATE '2025-09-30' WHERE id = v_org;
  v_failed := false;
  BEGIN UPDATE public.organizations SET books_closed_through = DATE '2025-05-31' WHERE id = v_org;
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'The closing date moved inside a closed year.'; END IF;
  v_failed := false;
  BEGIN UPDATE public.organizations SET books_closed_through = NULL WHERE id = v_org;
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'The closing date was removed while a year stood closed.'; END IF;
  v_failed := false;
  BEGIN UPDATE public.organizations SET fiscal_year_start = 'January' WHERE id = v_org;
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'The financial year start changed while a year stood closed.'; END IF;

  -- The next year closes from a closing date inside it.
  PERFORM private.insert_journal_entry(v_org, DATE '2025-11-15', 'More sales', 'MANUAL', NULL, 'REV-2', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', v_bank, 'debit', 7000, 'credit', 0),
      jsonb_build_object('accountId', v_sales, 'debit', 0, 'credit', 7000)));
  v_close_2026 := public.close_financial_year(v_org, DATE '2026-06-30', v_owner);
  IF (SELECT books_closed_through FROM public.organizations WHERE id = v_org) <> DATE '2026-06-30'
     OR (SELECT previous_closed_through FROM public.year_end_closes WHERE id = (v_close_2026->>'id')::UUID) <> DATE '2025-09-30' THEN
    RAISE EXCEPTION 'The second close did not record the closing date it replaced.';
  END IF;
  IF (SELECT COALESCE(sum(credit_cents - debit_cents), 0) FROM public.account_balance_totals(v_org, NULL, DATE '2026-06-30')
      WHERE account_id = '00000000-0000-0000-0000-00000000a310') <> 13000 THEN
    RAISE EXCEPTION 'Retained earnings do not hold both closed years.';
  END IF;

  -- Reopening: latest year first, and the closing date back at its year-end.
  v_failed := false;
  BEGIN PERFORM public.reopen_financial_year(v_org, (v_close_2025->>'id')::UUID, 'Wrong order', v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; v_message := SQLERRM; END;
  IF NOT v_failed OR v_message NOT LIKE '%latest closed financial year%' THEN
    RAISE EXCEPTION 'An earlier year was reopened under a later close: %', v_message;
  END IF;
  UPDATE public.organizations SET books_closed_through = DATE '2026-08-31' WHERE id = v_org;
  v_failed := false;
  BEGIN PERFORM public.reopen_financial_year(v_org, (v_close_2026->>'id')::UUID, 'Adjust 2026', v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; v_message := SQLERRM; END;
  IF NOT v_failed OR v_message NOT LIKE '%Move the closing date back to 30/06/2026%' THEN
    RAISE EXCEPTION 'A year reopened while the books were closed beyond it: %', v_message;
  END IF;
  UPDATE public.organizations SET books_closed_through = DATE '2026-06-30' WHERE id = v_org;
  PERFORM public.reopen_financial_year(v_org, (v_close_2026->>'id')::UUID, 'Adjust 2026', v_owner);
  IF (SELECT books_closed_through FROM public.organizations WHERE id = v_org) <> DATE '2025-09-30' THEN
    RAISE EXCEPTION 'Reopening did not restore the closing date the close replaced.';
  END IF;

  -- A close is not posted inside the closing date.
  UPDATE public.organizations SET books_closed_through = DATE '2026-07-31' WHERE id = v_org;
  v_failed := false;
  BEGIN PERFORM public.close_financial_year(v_org, DATE '2026-06-30', v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; v_message := SQLERRM; END;
  IF NOT v_failed OR v_message NOT LIKE '%Move the closing date back before 30/06/2026%' THEN
    RAISE EXCEPTION 'A close was attempted inside the closing date: %', v_message;
  END IF;
  v_failed := false;
  BEGIN PERFORM public.close_financial_year(v_org, DATE '2025-06-30', v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; v_message := SQLERRM; END;
  IF NOT v_failed OR v_message NOT LIKE '%already closed%' THEN
    RAISE EXCEPTION 'A closed year was closed again: %', v_message;
  END IF;
END;
$test$;

-- A church: the fund balances and the treasurer's report ignore the close.
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID;
  v_building UUID;
  v_bank UUID;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Kanisa year end","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"1040","name":"Cash on hand, collections","type":"ASSET","isBankAccount":true},
      {"code":"1050","name":"M-Pesa","type":"ASSET","isBankAccount":true},
      {"code":"2000","name":"Accounts payable","type":"LIABILITY"},
      {"code":"3100","name":"Retained Earnings","type":"EQUITY"},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4040","name":"Building and project giving","type":"INCOME"},
      {"code":"6310","name":"Ministry and department costs","type":"EXPENSE"}]', 'church-year-end-review');
  SELECT id INTO v_building FROM public.funds WHERE org_id = v_org AND code = 'BUILDING';
  SELECT id INTO v_bank FROM public.accounts WHERE org_id = v_org AND code = '1000';
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-fund', v_building)::TEXT, true);
  PERFORM private.insert_journal_entry(v_org, DATE '2025-05-10', 'Building giving', 'MANUAL', NULL, 'GIFT-1', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', v_bank, 'debit', 50000, 'credit', 0),
      jsonb_build_object('accountId', (SELECT id FROM public.accounts WHERE org_id = v_org AND code = '4040'), 'debit', 0, 'credit', 50000)));
  PERFORM set_config('request.headers', '', true);
  PERFORM private.insert_journal_entry(v_org, DATE '2025-06-01', 'Ministry costs', 'MANUAL', NULL, 'COST-1', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', (SELECT id FROM public.accounts WHERE org_id = v_org AND code = '6310'), 'debit', 20000, 'credit', 0),
      jsonb_build_object('accountId', v_bank, 'debit', 0, 'credit', 20000)));
  PERFORM public.close_financial_year(v_org, DATE '2025-12-31', v_owner);
  IF (SELECT opening_cents FROM public.fund_balances(v_org, DATE '2026-01-01', DATE '2026-12-31') WHERE code = 'BUILDING') <> 50000
     OR (SELECT opening_cents FROM public.fund_balances(v_org, DATE '2026-01-01', DATE '2026-12-31') WHERE code = 'GENERAL') <> -20000 THEN
    RAISE EXCEPTION 'The year-end close moved restricted fund balances into the general fund.';
  END IF;
  IF (SELECT sum(amount_cents) FROM public.church_treasurer_lines(v_org, DATE '2025-01-01', DATE '2025-12-31') WHERE kind = 'INCOME') <> 50000
     OR (SELECT sum(amount_cents) FROM public.church_treasurer_lines(v_org, DATE '2025-01-01', DATE '2025-12-31') WHERE kind = 'EXPENSE') <> 20000 THEN
    RAISE EXCEPTION 'The treasurer''s report counted the year-end close.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'payroll and close review passed';
