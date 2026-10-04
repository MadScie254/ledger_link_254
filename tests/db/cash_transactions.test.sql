\c lltest
-- Sales receipts, expenses and transfers: what each posts, stock, voiding.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_output_vat UUID := '00000000-0000-0000-0000-00000000a210';
  v_input_vat UUID := '00000000-0000-0000-0000-00000000a150';
  v_cement UUID := '00000000-0000-0000-0000-0000000000e1';
  v_till UUID := gen_random_uuid();
  v_receipt JSONB;
  v_expense JSONB;
  v_transfer JSONB;
  v_failed BOOLEAN;
  v_balance NUMERIC;
BEGIN
  INSERT INTO public.accounts (id, org_id, code, name, type, is_bank_account) VALUES (v_till, v_org, '1050', 'M-Pesa Till', 'ASSET', true);

  -- A cash sale of 2 bags at 750 + 16% VAT into the till.
  v_receipt := public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-15', v_till, 'QJK7PL9A2', NULL,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg', 'accountId', v_sales, 'inventoryItemId', v_cement, 'quantity', 2, 'unitPriceCents', 75000, 'taxRate', 16)),
    v_owner, 'sr-1');
  ASSERT v_receipt->>'number' = 'SR-2026-00001', 'receipt number';
  ASSERT (v_receipt->>'totalCents')::BIGINT = 174000, 'receipt total';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_till) = 174000, 'till debited';
  ASSERT (SELECT sum(credit) FROM public.journal_lines WHERE account_id = v_output_vat) = 24000, 'output VAT credited';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 3, 'stock counted out';
  ASSERT public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-15', v_till, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 1)), v_owner, 'sr-1')->>'id' = v_receipt->>'id', 'retry returns the same receipt';

  -- Not into a non-money account.
  v_failed := false;
  BEGIN
    PERFORM public.record_sales_receipt(v_org, v_customer, NULL, DATE '2026-09-15', v_sales, NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 100)), v_owner, 'sr-2');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%bank, cash or M-Pesa%';
  END;
  ASSERT v_failed, 'deposits go to money accounts only';

  -- An expense paid from the bank, with VAT.
  v_expense := public.record_expense(v_org, v_vendor, NULL, DATE '2026-09-16', v_bank, 'KPLC 0916', 'Tokens',
    jsonb_build_array(jsonb_build_object('description', 'Electricity tokens', 'accountId', v_opex, 'amountCents', 10000, 'taxCents', 1600)),
    v_owner, 'exp-1');
  ASSERT v_expense->>'number' = 'EXP-2026-00001', 'expense number';
  ASSERT (SELECT sum(debit) FROM public.journal_lines WHERE account_id = v_input_vat) = 1600, 'input VAT debited';
  ASSERT (SELECT sum(credit) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE l.account_id = v_bank AND e.source_type = 'EXPENSE') = 11600, 'bank credited';

  v_failed := false;
  BEGIN
    PERFORM public.record_expense(v_org, NULL, 'Shop', DATE '2026-09-16', v_bank, NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'Into receivables', 'accountId', '00000000-0000-0000-0000-00000000a110', 'amountCents', 100)), v_owner, 'exp-2');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%not expense lines%';
  END;
  ASSERT v_failed, 'receivables are not an expense line';

  -- A transfer from the till to the bank.
  v_transfer := public.record_transfer(v_org, DATE '2026-09-17', v_till, v_bank, 100000, 'Banking the till', v_owner, 'trf-1');
  ASSERT v_transfer->>'number' = 'TRF-2026-00001', 'transfer number';
  SELECT sum(debit) - sum(credit) INTO v_balance FROM public.journal_lines WHERE account_id = v_till;
  ASSERT v_balance = 74000, 'till after transfer';
  v_failed := false;
  BEGIN
    PERFORM public.record_transfer(v_org, DATE '2026-09-17', v_bank, v_bank, 100, NULL, v_owner, 'trf-2');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%two different accounts%';
  END;
  ASSERT v_failed, 'not to the same account';

  -- Voids: a reason is required; the reversal undoes the entry and the stock.
  v_failed := false;
  BEGIN
    PERFORM public.void_cash_transaction(v_org, (v_receipt->>'id')::UUID, DATE '2026-09-18', ' ', v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%reason%';
  END;
  ASSERT v_failed, 'a void needs a reason';
  PERFORM public.void_cash_transaction(v_org, (v_receipt->>'id')::UUID, DATE '2026-09-18', 'Rang up twice', v_owner);
  ASSERT (SELECT status FROM public.cash_transactions WHERE id = (v_receipt->>'id')::UUID) = 'VOID', 'voided';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 5, 'stock put back';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_output_vat) = 0, 'VAT reversed';
  PERFORM public.void_cash_transaction(v_org, (v_receipt->>'id')::UUID, DATE '2026-09-18', 'Again', v_owner);
  ASSERT (SELECT count(*) FROM public.journal_entries WHERE source_id = (v_receipt->>'id')::UUID) = 2, 'voiding twice posts once';
  PERFORM public.void_cash_transaction(v_org, (v_transfer->>'id')::UUID, DATE '2026-09-18', 'Wrong account', v_owner);
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_till) = 0, 'till back to nothing';

  RAISE NOTICE 'ALL CASH TRANSACTION SQL TESTS PASSED';
END $$;
SELECT 'ALL CASH TRANSACTION SQL TESTS PASSED';
