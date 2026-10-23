\c lltest
\set ON_ERROR_STOP 1
-- Live M-Pesa for business organizations (20261022000200): the link, each
-- payment kept once as a statement line on the M-Pesa account, an invoice
-- settled from the account number, and everything else left waiting with
-- its reason.
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_member UUID := '00000000-0000-0000-0000-000000000004';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_ar UUID := '00000000-0000-0000-0000-00000000a110';
  v_mpesa UUID;
  v_invoice UUID;
  v_usd_invoice UUID;
  v_number TEXT;
  v_usd_number TEXT;
  v_saved JSONB;
  v_target RECORD;
  v_first JSONB;
  v_again JSONB;
  v_settled JSONB;
  v_result JSONB;
  v_line UUID;
  v_import JSONB;
  v_failed BOOLEAN;
  v_lines_before INTEGER;
BEGIN
  INSERT INTO public.accounts (org_id, code, name, type, is_bank_account)
  VALUES (v_org, '1050', 'M-Pesa', 'ASSET', true) RETURNING id INTO v_mpesa;
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 100000)), 'mp-inv-1');
  SELECT invoice_number INTO v_number FROM public.invoices WHERE id = v_invoice;
  v_usd_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'USD', 0.01, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Export', 'accountId', v_sales, 'amountCents', 1000000, 'foreignAmountCents', 10000)), 'mp-inv-usd');
  SELECT invoice_number INTO v_usd_number FROM public.invoices WHERE id = v_usd_invoice;

  -- Service role only.
  IF has_function_privilege('authenticated', 'public.receive_mpesa_payment(uuid,text,jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.settle_mpesa_payment(uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.mpesa_payments', 'SELECT')
     OR NOT has_function_privilege('service_role', 'public.receive_mpesa_payment(uuid,text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'M-Pesa payment functions or records are not service-role-only.';
  END IF;

  -- The link: a business's payments land in a money account in the base currency, 1050 by default.
  v_failed := false;
  BEGIN
    PERFORM public.save_mpesa_integration(v_org, '174379', 'SANDBOX', 'key', 'secret', v_owner, v_owner, v_sales);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'An income account was taken as the M-Pesa money account.'; END IF;
  v_saved := public.save_mpesa_integration(v_org, '174379', 'SANDBOX', 'key', 'secret', v_owner, v_owner);
  IF (SELECT money_account_id FROM public.org_integrations WHERE org_id = v_org AND kind = 'MPESA_C2B') <> v_mpesa THEN
    RAISE EXCEPTION 'The M-Pesa account 1050 was not chosen by default.';
  END IF;
  PERFORM public.record_mpesa_registration(v_org, repeat('12', 32), true, 'Success', v_owner);
  SELECT * INTO v_target FROM public.mpesa_callback_target(repeat('12', 32));
  IF v_target.org_id <> v_org OR v_target.edition <> 'business' OR v_target.money_account_id <> v_mpesa
     OR v_target.integration_actor_id <> v_owner THEN
    RAISE EXCEPTION 'The registered token did not find the business and its M-Pesa account.';
  END IF;

  -- A payment is kept once, as one statement line on the M-Pesa account.
  v_first := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'sjk1abc2de', 'transTime', '2026-10-05T09:15:00+03:00', 'amountCents', 30000,
    'billRefNumber', lower(replace(v_number, '-', ' ')), 'msisdn', '2547 ***** 126', 'payerName', 'JANE WANJIRU',
    'shortcode', '174379', 'transactionType', 'Pay Bill', 'raw', '{"TransID":"SJK1ABC2DE"}'::JSONB));
  v_again := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK1ABC2DE', 'transTime', '2026-10-05T09:15:00+03:00', 'amountCents', 30000));
  IF NOT (v_first->>'inserted')::BOOLEAN OR (v_again->>'inserted')::BOOLEAN OR v_again->>'id' <> v_first->>'id' THEN
    RAISE EXCEPTION 'A repeated callback was kept twice.';
  END IF;
  v_line := (v_first->>'bankTransactionId')::UUID;
  IF (SELECT count(*) FROM public.bank_transactions WHERE org_id = v_org AND reference = 'SJK1ABC2DE') <> 1
     OR (SELECT bank_account_id FROM public.bank_transactions WHERE id = v_line) <> v_mpesa
     OR (SELECT date FROM public.bank_transactions WHERE id = v_line) <> DATE '2026-10-05'
     OR (SELECT direction FROM public.bank_transactions WHERE id = v_line) <> 'IN'
     OR (SELECT description FROM public.bank_transactions WHERE id = v_line) NOT LIKE 'M-Pesa SJK1ABC2DE from JANE WANJIRU%' THEN
    RAISE EXCEPTION 'The payment did not become one M-Pesa statement line.';
  END IF;

  -- With no one named it waits; named, it settles the invoice its account number names.
  v_result := public.settle_mpesa_payment(v_org, (v_first->>'id')::UUID, NULL);
  IF v_result->>'outcome' <> 'WAITING' OR v_result->>'note' NOT LIKE 'No one is named%' THEN
    RAISE EXCEPTION 'A payment settled with no one named: %', v_result;
  END IF;
  v_failed := false;
  BEGIN PERFORM public.settle_mpesa_payment(v_org, (v_first->>'id')::UUID, v_member);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A stranger settled an M-Pesa payment.'; END IF;
  v_settled := public.settle_mpesa_payment(v_org, (v_first->>'id')::UUID, v_owner);
  IF v_settled->>'outcome' <> 'SETTLED' OR (v_settled->>'invoiceId')::UUID <> v_invoice THEN
    RAISE EXCEPTION 'The payment did not settle its invoice: %', v_settled;
  END IF;
  IF (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) <> 70000
     OR (SELECT status FROM public.invoices WHERE id = v_invoice) <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'The invoice does not show the M-Pesa payment.';
  END IF;
  IF (SELECT status FROM public.bank_transactions WHERE id = v_line) <> 'MATCHED'
     OR (SELECT matched_journal_entry_id FROM public.bank_transactions WHERE id = v_line) <> (v_settled->>'journalEntryId')::UUID THEN
    RAISE EXCEPTION 'The statement line was not matched to the payment.';
  END IF;
  IF (SELECT debit FROM public.journal_lines WHERE journal_entry_id = (v_settled->>'journalEntryId')::UUID AND account_id = v_mpesa) <> 30000
     OR (SELECT credit FROM public.journal_lines WHERE journal_entry_id = (v_settled->>'journalEntryId')::UUID AND account_id = v_ar) <> 30000 THEN
    RAISE EXCEPTION 'The payment did not move M-Pesa and receivables.';
  END IF;
  v_result := public.settle_mpesa_payment(v_org, (v_first->>'id')::UUID, v_owner);
  IF v_result->>'journalEntryId' <> v_settled->>'journalEntryId'
     OR (SELECT count(*) FROM public.invoice_payments WHERE invoice_id = v_invoice) <> 1 THEN
    RAISE EXCEPTION 'Settling again posted a second payment.';
  END IF;

  -- The same receipt in a later statement file is skipped.
  v_import := public.import_bank_statement(v_org, v_mpesa, 'mpesa.csv', jsonb_build_array(
    jsonb_build_object('date', '2026-10-05', 'description', 'Pay Bill from JANE', 'amountCents', 30000, 'reference', 'SJK1ABC2DE')), v_owner);
  IF (v_import->>'imported')::INT <> 0 THEN
    RAISE EXCEPTION 'A statement upload added the payment a second time.';
  END IF;

  -- A line uploaded first is the one a later callback uses.
  v_import := public.import_bank_statement(v_org, v_mpesa, 'mpesa-2.csv', jsonb_build_array(
    jsonb_build_object('date', '2026-10-06', 'description', 'Pay Bill from OTIENO', 'amountCents', 20000, 'reference', 'SJK2XYZ9QW')), v_owner);
  SELECT count(*) INTO v_lines_before FROM public.bank_transactions WHERE org_id = v_org;
  v_result := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK2XYZ9QW', 'transTime', '2026-10-06T11:00:00+03:00', 'amountCents', 20000, 'billRefNumber', v_number,
    'payerName', 'OTIENO'));
  IF (SELECT count(*) FROM public.bank_transactions WHERE org_id = v_org) <> v_lines_before
     OR (SELECT bank_transaction_id FROM public.mpesa_payments WHERE id = (v_result->>'id')::UUID)
        <> (SELECT id FROM public.bank_transactions WHERE org_id = v_org AND reference = 'SJK2XYZ9QW') THEN
    RAISE EXCEPTION 'The callback added a second line for a receipt already uploaded.';
  END IF;
  v_result := public.settle_mpesa_payment(v_org, (v_result->>'id')::UUID, v_owner);
  IF v_result->>'outcome' <> 'SETTLED' OR (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) <> 50000 THEN
    RAISE EXCEPTION 'The uploaded-first payment did not settle: %', v_result;
  END IF;

  -- What waits, and why.
  v_result := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK3NOINV1', 'transTime', '2026-10-07T08:00:00+03:00', 'amountCents', 5000, 'billRefNumber', 'SCHOOL FEES'));
  v_result := public.settle_mpesa_payment(v_org, (v_result->>'id')::UUID, v_owner);
  IF v_result->>'outcome' <> 'WAITING' OR v_result->>'note' NOT LIKE 'Account number SCHOOL FEES is not the number of an open invoice%' THEN
    RAISE EXCEPTION 'An unknown account number did not wait: %', v_result;
  END IF;
  v_result := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK4TILL01', 'transTime', '2026-10-07T08:05:00+03:00', 'amountCents', 5000, 'transactionType', 'Buy Goods'));
  v_result := public.settle_mpesa_payment(v_org, (v_result->>'id')::UUID, v_owner);
  IF v_result->>'note' NOT LIKE '%no account number%' THEN
    RAISE EXCEPTION 'A till payment did not wait: %', v_result;
  END IF;
  v_result := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK5OVER01', 'transTime', '2026-10-07T09:00:00+03:00', 'amountCents', 60000, 'billRefNumber', v_number));
  v_result := public.settle_mpesa_payment(v_org, (v_result->>'id')::UUID, v_owner);
  IF v_result->>'note' NOT LIKE 'KES 600.00 is more than the KES 500.00 due on %' THEN
    RAISE EXCEPTION 'An overpayment did not wait: %', v_result;
  END IF;
  v_result := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK6USD001', 'transTime', '2026-10-07T09:30:00+03:00', 'amountCents', 1000, 'billRefNumber', v_usd_number));
  v_result := public.settle_mpesa_payment(v_org, (v_result->>'id')::UUID, v_owner);
  IF v_result->>'note' NOT LIKE '% is in USD; match it in Banking%' THEN
    RAISE EXCEPTION 'A foreign-currency invoice was settled from M-Pesa: %', v_result;
  END IF;
  -- A refusal from the books (here the closing date) is kept as the reason.
  UPDATE public.organizations SET books_closed_through = DATE '2026-10-31' WHERE id = v_org;
  v_result := public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', jsonb_build_object(
    'transId', 'SJK7LOCK01', 'transTime', '2026-10-08T10:00:00+03:00', 'amountCents', 1000, 'billRefNumber', v_number));
  v_result := public.settle_mpesa_payment(v_org, (v_result->>'id')::UUID, v_owner);
  IF v_result->>'outcome' <> 'WAITING' OR v_result->>'note' NOT LIKE '% was not settled: The books are closed through%' THEN
    RAISE EXCEPTION 'A refused settlement did not wait with its reason: %', v_result;
  END IF;
  UPDATE public.organizations SET books_closed_through = NULL WHERE id = v_org;
  IF (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) <> 50000 THEN
    RAISE EXCEPTION 'A waiting payment changed the invoice.';
  END IF;
  IF (SELECT count(*) FROM public.mpesa_payments WHERE org_id = v_org AND outcome = 'WAITING' AND outcome_note IS NULL) <> 0 THEN
    RAISE EXCEPTION 'A waiting payment has no reason.';
  END IF;

  -- Bad callbacks are refused.
  v_failed := false;
  BEGIN PERFORM public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', '{"transId":"x","transTime":"2026-10-07T08:00:00+03:00","amountCents":100}');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A malformed transaction code was kept.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', '{"transId":"SJK8ZERO01","transTime":"2026-10-07T08:00:00+03:00","amountCents":0}');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A payment of nothing was kept.'; END IF;

  -- A disabled link keeps nothing.
  UPDATE public.org_integrations SET status = 'DISABLED' WHERE org_id = v_org;
  v_failed := false;
  BEGIN PERFORM public.receive_mpesa_payment(v_org, 'C2B_CALLBACK', '{"transId":"SJK9OFF001","transTime":"2026-10-07T08:00:00+03:00","amountCents":100}');
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A disabled link kept a payment.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mpesa_callback_target(repeat('12', 32))) THEN
    RAISE EXCEPTION 'A disabled link still finds its business.';
  END IF;
END;
$test$;

-- A church keeps M-Pesa receipts in Giving, not here; a law firm has no M-Pesa link.
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_church UUID;
  v_failed BOOLEAN := false;
BEGIN
  v_church := public.create_organization(v_owner, '{"name":"Kanisa link test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"1050","name":"M-Pesa","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"}]', 'church-link-test');
  PERFORM public.save_mpesa_integration(v_church, '600100', 'SANDBOX', NULL, NULL, NULL, v_owner);
  IF (SELECT money_account_id FROM public.org_integrations WHERE org_id = v_church) IS NOT NULL THEN
    RAISE EXCEPTION 'A church link was given a business money account.';
  END IF;
  BEGIN
    PERFORM public.receive_mpesa_payment(v_church, 'C2B_CALLBACK',
      '{"transId":"SJKCHURCH1","transTime":"2026-10-07T08:00:00+03:00","amountCents":100}');
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A church payment was kept as a business payment.'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'business M-Pesa passed';
