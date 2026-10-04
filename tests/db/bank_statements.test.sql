\c lltest
-- Statement imports skip what an account already has; matching posts to the
-- line's own account; reconciliation ticks lines to the statement balance.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_till UUID := gen_random_uuid();
  v_result JSONB;
  v_rec JSONB;
  v_rec2 JSONB;
  v_lines UUID[];
  v_failed BOOLEAN;
  v_entry UUID;
  v_tx UUID;
BEGIN
  INSERT INTO public.accounts (id, org_id, code, name, type, is_bank_account) VALUES (v_till, v_org, '1050', 'M-Pesa Till', 'ASSET', true);
  ASSERT (SELECT count(*) FROM public.bank_transactions WHERE bank_account_id = v_bank) = 2, 'fixture lines belong to 1000';

  -- An M-Pesa statement: two identical charges on one day are both kept.
  v_result := public.import_bank_statement(v_org, v_till, 'mpesa-sep.csv', jsonb_build_array(
    jsonb_build_object('date', '2026-09-15', 'description', 'Customer Transfer from JANE W', 'amountCents', 174000, 'reference', 'QJK7PL9A2'),
    jsonb_build_object('date', '2026-09-16', 'description', 'Pay Bill to KPLC', 'amountCents', -50000, 'reference', 'QJK7PL9B3'),
    jsonb_build_object('date', '2026-09-16', 'description', 'Charge', 'amountCents', -1500),
    jsonb_build_object('date', '2026-09-16', 'description', 'Charge', 'amountCents', -1500)
  ), v_owner);
  ASSERT (v_result->>'imported')::INTEGER = 4 AND (v_result->>'skipped')::INTEGER = 0, format('all four imported: %s', v_result);
  ASSERT (SELECT direction || ' ' || amount_cents FROM public.bank_transactions WHERE reference = 'QJK7PL9B3') = 'OUT 50000', 'signed amount split';

  -- The same statement again, with one more line: only the new line is added.
  v_result := public.import_bank_statement(v_org, v_till, 'mpesa-sep-again.csv', jsonb_build_array(
    jsonb_build_object('date', '2026-09-15', 'description', 'Customer Transfer from JANE W', 'amountCents', 174000, 'reference', 'qjk7pl9a2'),
    jsonb_build_object('date', '2026-09-16', 'description', 'Pay Bill to KPLC', 'amountCents', -50000, 'reference', 'QJK7PL9B3'),
    jsonb_build_object('date', '2026-09-16', 'description', 'Charge', 'amountCents', -1500),
    jsonb_build_object('date', '2026-09-16', 'description', 'Charge', 'amountCents', -1500),
    jsonb_build_object('date', '2026-09-17', 'description', 'Customer Transfer from JOHN K', 'amountCents', 20000, 'reference', 'QJK7PL9D5')
  ), v_owner);
  ASSERT (v_result->>'imported')::INTEGER = 1 AND (v_result->>'skipped')::INTEGER = 4, format('only the new line: %s', v_result);
  ASSERT (SELECT count(*) FROM public.bank_transactions WHERE bank_account_id = v_till) = 5, 'five on the till';

  v_failed := false;
  BEGIN
    PERFORM public.import_bank_statement(v_org, v_sales, NULL, jsonb_build_array(jsonb_build_object('date', '2026-09-15', 'description', 'x', 'amountCents', 100)), v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%bank, cash or M-Pesa%';
  END;
  ASSERT v_failed, 'statements belong to money accounts';
  v_failed := false;
  BEGIN
    PERFORM public.import_bank_statement(v_org, v_till, NULL, jsonb_build_array(jsonb_build_object('date', 'not a date', 'description', 'x', 'amountCents', 100)), v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%cannot be read%';
  END;
  ASSERT v_failed, 'unreadable dates are refused';

  -- Matching a till line posts against the till, not the bank.
  SELECT id INTO v_tx FROM public.bank_transactions WHERE reference = 'QJK7PL9A2';
  v_entry := public.match_bank_transaction(v_org, v_tx, v_sales, NULL, NULL, NULL, v_owner);
  ASSERT (SELECT debit FROM public.journal_lines WHERE journal_entry_id = v_entry AND account_id = v_till) = 174000, 'till debited';
  ASSERT NOT EXISTS (SELECT 1 FROM public.journal_lines WHERE journal_entry_id = v_entry AND account_id = v_bank), 'bank untouched';
  SELECT id INTO v_tx FROM public.bank_transactions WHERE reference = 'QJK7PL9B3';
  PERFORM public.match_bank_transaction(v_org, v_tx, v_opex, NULL, NULL, NULL, v_owner);
  -- A cash sale into the till that is not on this statement.
  PERFORM public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-18', v_till, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Nails', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 30000)), v_owner, 'bs-sr');

  -- Reconcile the till to 30 September at 1,240.00: the matched lines start ticked.
  v_rec := public.start_bank_reconciliation(v_org, v_till, DATE '2026-09-30', 124000, NULL, v_owner);
  ASSERT (v_rec->>'openingBalanceCents')::BIGINT = 0, 'first reconciliation opens at nothing';
  ASSERT (SELECT count(*) FROM public.bank_reconciliation_worksheet(v_org, (v_rec->>'id')::UUID)) = 3, 'three lines on the till';
  ASSERT (SELECT count(*) FROM public.bank_reconciliation_worksheet(v_org, (v_rec->>'id')::UUID) WHERE cleared) = 2, 'the two matched lines ticked';
  v_failed := false;
  BEGIN
    PERFORM public.start_bank_reconciliation(v_org, v_till, DATE '2026-09-30', 0, NULL, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%already under way%';
  END;
  ASSERT v_failed, 'one at a time per account';

  -- 1,740 in, 500 out: 1,240 cleared. The cash sale stays unticked.
  v_failed := false;
  BEGIN
    PERFORM public.complete_bank_reconciliation(v_org, (v_rec->>'id')::UUID, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT NOT v_failed, 'completes when the ticked lines agree';
  ASSERT (SELECT status FROM public.bank_reconciliations WHERE id = (v_rec->>'id')::UUID) = 'COMPLETED', 'completed';

  -- The next month opens at 1,240. A wrong ticking does not complete.
  v_rec2 := public.start_bank_reconciliation(v_org, v_till, DATE '2026-10-31', 154000, 999, v_owner);
  ASSERT (v_rec2->>'openingBalanceCents')::BIGINT = 124000, 'opens at the last statement balance';
  ASSERT (SELECT count(*) FROM public.bank_reconciliation_worksheet(v_org, (v_rec2->>'id')::UUID)) = 1, 'only the cash sale is left';
  v_result := public.set_bank_reconciliation_lines(v_org, (v_rec2->>'id')::UUID, ARRAY[]::UUID[], v_owner);
  ASSERT (v_result->>'differenceCents')::BIGINT = 30000, 'difference while unticked';
  v_failed := false;
  BEGIN
    PERFORM public.complete_bank_reconciliation(v_org, (v_rec2->>'id')::UUID, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%the difference is 30000 cents%';
  END;
  ASSERT v_failed, 'not finished with a difference';
  SELECT array_agg(journal_line_id) INTO v_lines FROM public.bank_reconciliation_worksheet(v_org, (v_rec2->>'id')::UUID);
  v_result := public.set_bank_reconciliation_lines(v_org, (v_rec2->>'id')::UUID, v_lines, v_owner);
  ASSERT (v_result->>'differenceCents')::BIGINT = 0, 'agrees once ticked';
  v_failed := false;
  BEGIN
    PERFORM public.set_bank_reconciliation_lines(v_org, (v_rec2->>'id')::UUID,
      ARRAY[(SELECT id FROM public.journal_lines WHERE journal_entry_id = v_entry AND account_id = v_till)], v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%reconciled before%';
  END;
  ASSERT v_failed, 'a line reconciled before cannot be ticked again';
  PERFORM public.complete_bank_reconciliation(v_org, (v_rec2->>'id')::UUID, v_owner);

  -- Only the latest can be undone, with a reason.
  v_failed := false;
  BEGIN
    PERFORM public.undo_bank_reconciliation(v_org, (v_rec->>'id')::UUID, 'Wrong statement', v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%Only the latest%';
  END;
  ASSERT v_failed, 'not an earlier one';
  ASSERT (public.undo_bank_reconciliation(v_org, (v_rec2->>'id')::UUID, 'Statement balance mistyped', v_owner))->>'status' = 'UNDONE', 'latest undone';
  v_rec2 := public.start_bank_reconciliation(v_org, v_till, DATE '2026-10-31', 154000, NULL, v_owner);
  ASSERT (SELECT count(*) FROM public.bank_reconciliation_worksheet(v_org, (v_rec2->>'id')::UUID)) = 1, 'the undone lines are free again';
  ASSERT (public.undo_bank_reconciliation(v_org, (v_rec2->>'id')::UUID, NULL, v_owner))->>'status' = 'CANCELLED', 'one under way is cancelled';

  RAISE NOTICE 'ALL BANK STATEMENT SQL TESTS PASSED';
END $$;
SELECT 'ALL BANK STATEMENT SQL TESTS PASSED';
