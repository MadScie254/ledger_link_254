\c lltest
\set ON_ERROR_STOP 1
-- The client account reconciliation (20261024000800): the bank statement,
-- the client cash book and the matter ledgers on a date, signed once by an
-- owner or admin.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_business UUID := '00000000-0000-0000-0000-0000000000aa';
  v_org UUID;
  v_client UUID;
  v_matter UUID;
  v_bank UUID;
  v_receipt_line UUID;
  v_bank_rec JSONB;
  v_result JSONB;
  v_failed BOOLEAN;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Reconciliation test","edition":"law"}',
    '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1060","name":"Client bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1100","name":"Receivables","type":"ASSET","currency":"KES"},
      {"code":"2200","name":"Client money held","type":"LIABILITY","currency":"KES"}]', 'client-rec-test');
  INSERT INTO public.customers(org_id, display_name) VALUES (v_org, 'Fictional client') RETURNING id INTO v_client;
  INSERT INTO public.matters(org_id, matter_number, title, client_id, created_by)
  VALUES (v_org, 'MAT-REC-1', 'Land purchase', v_client, v_owner) RETURNING id INTO v_matter;
  SELECT id INTO v_bank FROM public.accounts WHERE org_id = v_org AND code = '1060';

  PERFORM public.record_client_receipt(v_org, v_matter, 10000, DATE '2026-10-01', 'BANK', 'REF-1', 'rec-receipt', v_owner);
  PERFORM public.record_client_payment(v_org, v_matter, 3000, DATE '2026-10-05', 'Lands registry', 'Stamp duty', false, 'rec-payment', v_owner);

  -- A business has no client account reconciliation.
  v_failed := false;
  BEGIN PERFORM public.client_account_reconciliation(v_business, DATE '2026-10-31');
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  ASSERT v_failed, 'only a law firm reconciles a client account';

  -- Before the bank account is reconciled there is no statement leg, and nothing is signed.
  v_result := public.client_account_reconciliation(v_org, DATE '2026-10-31');
  ASSERT v_result->>'bankReconciliationId' IS NULL AND NOT (v_result->>'agrees')::BOOLEAN, 'no statement yet';
  ASSERT (v_result->>'cashBookCents')::BIGINT = 7000 AND (v_result->>'matterLedgersCents')::BIGINT = 7000, 'books and ledgers';
  v_failed := false;
  BEGIN PERFORM public.sign_client_account_reconciliation(v_org, DATE '2026-10-31', NULL, v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  ASSERT v_failed, 'not signed without the bank reconciliation';

  -- The statement shows the receipt; the stamp duty cheque is not presented yet.
  v_bank_rec := public.start_bank_reconciliation(v_org, v_bank, DATE '2026-10-31', 10000, 0, v_owner);
  SELECT line.id INTO v_receipt_line
  FROM public.journal_lines AS line WHERE line.org_id = v_org AND line.account_id = v_bank AND line.debit = 10000;
  PERFORM public.set_bank_reconciliation_lines(v_org, (v_bank_rec->>'id')::UUID, ARRAY[v_receipt_line], v_owner);
  PERFORM public.complete_bank_reconciliation(v_org, (v_bank_rec->>'id')::UUID, v_owner);

  v_result := public.client_account_reconciliation(v_org, DATE '2026-10-31');
  ASSERT (v_result->>'statementBalanceCents')::BIGINT = 10000, 'statement balance';
  ASSERT (v_result->>'unpresentedPaymentsCents')::BIGINT = 3000 AND (v_result->>'unclearedReceiptsCents')::BIGINT = 0, 'unpresented cheque';
  ASSERT (v_result->>'adjustedStatementCents')::BIGINT = 7000, 'adjusted statement';
  ASSERT (v_result->>'agrees')::BOOLEAN, 'statement, cash book and ledgers agree';
  ASSERT jsonb_array_length(v_result->'matters') = 1 AND (v_result->'matters'->0->>'heldCents')::BIGINT = 7000, 'the matter ledger';

  -- Signed once, and kept as it stood.
  v_result := public.sign_client_account_reconciliation(v_org, DATE '2026-10-31', NULL, v_owner);
  ASSERT v_result->'signed'->>'signedBy' = v_owner::TEXT AND (v_result->'signed'->>'agrees')::BOOLEAN, 'signed';
  v_failed := false;
  BEGIN PERFORM public.sign_client_account_reconciliation(v_org, DATE '2026-10-31', 'again', v_owner);
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  ASSERT v_failed, 'a date is signed once';
  ASSERT NOT has_table_privilege('service_role', 'public.client_account_reconciliations', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.client_account_reconciliations', 'DELETE')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'client_account_reconciliations_permanent'),
    'a signed reconciliation is never changed';
  ASSERT NOT has_table_privilege('authenticated', 'public.client_account_reconciliations', 'SELECT'), 'service role only';

  RAISE NOTICE 'client account reconciliation passed';
END $test$;
ROLLBACK;
SELECT 'client account reconciliation passed';
