\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_member UUID := '00000000-0000-0000-0000-000000000004';
  v_income UUID := '00000000-0000-0000-0000-00000000a400';
  v_expense UUID := '00000000-0000-0000-0000-00000000a600';
  v_retained UUID := '00000000-0000-0000-0000-00000000a310';
  v_close JSONB;
  v_reopen JSONB;
  v_failed BOOLEAN;
BEGIN
  UPDATE public.organizations SET fiscal_year_start = 'October' WHERE id = v_org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES(v_org, v_member, 'member');
  v_failed := false;
  BEGIN PERFORM public.close_financial_year(v_org, DATE '2026-09-30', v_member);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Member was allowed to close the year.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.close_financial_year(v_org, DATE '2026-09-30', v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Empty year-end entry was accepted.'; END IF;
  PERFORM private.insert_journal_entry(v_org, DATE '2026-09-15', 'Revenue', 'MANUAL', NULL, 'YE-SALE', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', '00000000-0000-0000-0000-00000000a000', 'debit', 10000, 'credit', 0),
      jsonb_build_object('accountId', v_income, 'debit', 0, 'credit', 10000)));
  PERFORM private.insert_journal_entry(v_org, DATE '2026-09-16', 'Expense', 'MANUAL', NULL, 'YE-COST', v_owner,
    jsonb_build_array(
      jsonb_build_object('accountId', v_expense, 'debit', 4000, 'credit', 0),
      jsonb_build_object('accountId', '00000000-0000-0000-0000-00000000a000', 'debit', 0, 'credit', 4000)));
  v_close := public.close_financial_year(v_org, DATE '2026-09-30', v_owner);
  IF (SELECT books_closed_through FROM public.organizations WHERE id = v_org) <> DATE '2026-09-30' THEN
    RAISE EXCEPTION 'Closing date was not advanced.';
  END IF;
  IF (SELECT source_type FROM public.journal_entries WHERE id = (v_close->>'journalEntryId')::UUID) <> 'YEAR_END_CLOSE' THEN
    RAISE EXCEPTION 'Closing entry has the wrong source type.';
  END IF;
  IF (SELECT COALESCE(sum(credit_cents - debit_cents),0) FROM public.account_balance_totals(v_org, NULL, DATE '2026-09-30')
      WHERE account_id = v_retained) <> 6000 THEN
    RAISE EXCEPTION 'Retained Earnings does not show the annual result.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_balance_totals(v_org, NULL, DATE '2026-09-30')
    WHERE account_id IN (v_income, v_expense) AND debit_cents <> credit_cents) THEN
    RAISE EXCEPTION 'Income or expense balance remained after closing.';
  END IF;
  IF (SELECT COALESCE(sum(credit_cents - debit_cents),0) FROM public.profit_and_loss_account_totals(v_org, DATE '2025-10-01', DATE '2026-09-30')
      WHERE account_id = v_income) <> 10000 OR
     (SELECT COALESCE(sum(debit_cents - credit_cents),0) FROM public.profit_and_loss_account_totals(v_org, DATE '2025-10-01', DATE '2026-09-30')
      WHERE account_id = v_expense) <> 4000 THEN
    RAISE EXCEPTION 'Closed-year income statement lost the activity.';
  END IF;
  v_failed := false;
  BEGIN UPDATE public.organizations SET books_closed_through = NULL WHERE id = v_org;
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Closing date was moved without reversing the close.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.close_financial_year(v_org, DATE '2026-09-30', v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Year was closed twice.'; END IF;
  v_reopen := public.reopen_financial_year(v_org, (v_close->>'id')::UUID, 'Adjust the year', v_owner);
  IF (SELECT books_closed_through FROM public.organizations WHERE id = v_org) IS NOT NULL OR
     (SELECT source_type FROM public.journal_entries WHERE id = (v_reopen->>'reversalJournalEntryId')::UUID) <> 'YEAR_END_REOPEN' THEN
    RAISE EXCEPTION 'Reopening did not post the reversal and restore closing date.';
  END IF;
  IF (SELECT COALESCE(sum(credit_cents - debit_cents),0) FROM public.account_balance_totals(v_org, NULL, DATE '2026-09-30')
      WHERE account_id = v_retained) <> 0 THEN
    RAISE EXCEPTION 'Reopening left a retained earnings balance.';
  END IF;
  IF (public.reopen_financial_year(v_org, (v_close->>'id')::UUID, 'Retry', v_owner))->>'reversalJournalEntryId'
     <> v_reopen->>'reversalJournalEntryId' THEN
    RAISE EXCEPTION 'Reopening retry posted a second journal.';
  END IF;
  IF has_table_privilege('authenticated', 'public.year_end_closes', 'SELECT') THEN
    RAISE EXCEPTION 'Year-end records bypass organization API access.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'year-end close passed';
