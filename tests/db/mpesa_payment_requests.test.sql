\c lltest
\set ON_ERROR_STOP 1
-- Pay with M-Pesa (20261022000300): the passkey in Vault, a request from an
-- open invoice, Daraja's answer, and Safaricom's result at the URL naming
-- one request, kept as an M-Pesa payment that settles the invoice.
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_member UUID := '00000000-0000-0000-0000-000000000004';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_mpesa UUID;
  v_invoice UUID;
  v_usd_invoice UUID;
  v_number TEXT;
  v_request JSONB;
  v_cancelled JSONB;
  v_result JSONB;
  v_settled JSONB;
  v_credentials RECORD;
  v_failed BOOLEAN;
  v_token_hash TEXT := repeat('a1', 32);
  v_other_hash TEXT := repeat('b2', 32);
BEGIN
  INSERT INTO public.accounts (org_id, code, name, type, is_bank_account)
  VALUES (v_org, '1050', 'M-Pesa', 'ASSET', true) RETURNING id INTO v_mpesa;
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 250000)), 'stk-inv-1');
  SELECT invoice_number INTO v_number FROM public.invoices WHERE id = v_invoice;
  v_usd_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'USD', 0.01, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Export', 'accountId', v_sales, 'amountCents', 1000000, 'foreignAmountCents', 10000)), 'stk-inv-usd');

  IF has_function_privilege('authenticated', 'public.create_mpesa_payment_request(uuid,uuid,text,bigint,text,uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_mpesa_payment_request(text,text,text,text,jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mpesa_express_credentials(uuid)'::regprocedure, 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.mpesa_payment_requests', 'SELECT') THEN
    RAISE EXCEPTION 'Payment request functions or records are not service-role-only.';
  END IF;

  -- No request before the passkey is saved.
  PERFORM public.save_mpesa_integration(v_org, '174379', 'SANDBOX', 'key', 'secret', v_owner, v_owner);
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 100000, v_token_hash, v_owner);
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A request was made without the passkey.'; END IF;

  -- The passkey: owners and admins, letters and digits, kept in its own Vault secret.
  v_failed := false;
  BEGIN PERFORM public.save_mpesa_express_passkey(v_org, 'abc123', v_member);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A member saved the passkey.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.save_mpesa_express_passkey(v_org, 'not a key!', v_owner);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A malformed passkey was saved.'; END IF;
  PERFORM public.save_mpesa_express_passkey(v_org, 'bfb279f9aa9bdbcf158e97dd71a467cd', v_owner);
  SELECT * INTO v_credentials FROM public.mpesa_express_credentials(v_org);
  IF v_credentials.passkey <> 'bfb279f9aa9bdbcf158e97dd71a467cd' OR v_credentials.consumer_key <> 'key' OR v_credentials.shortcode <> '174379' THEN
    RAISE EXCEPTION 'The Express credentials did not read back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND details::TEXT LIKE '%bfb279f9%')
     OR EXISTS (SELECT 1 FROM public.org_integrations WHERE org_id = v_org AND row_to_json(org_integrations)::TEXT LIKE '%bfb279f9%') THEN
    RAISE EXCEPTION 'The passkey was written outside Vault.';
  END IF;
  -- Saving new Daraja keys keeps the passkey.
  PERFORM public.save_mpesa_integration(v_org, '174379', 'SANDBOX', 'key-2', 'secret-2', v_owner, v_owner);
  IF (SELECT passkey FROM public.mpesa_express_credentials(v_org)) <> 'bfb279f9aa9bdbcf158e97dd71a467cd' THEN
    RAISE EXCEPTION 'New Daraja keys dropped the passkey.';
  END IF;

  -- What a request refuses.
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 100000, v_token_hash, v_member);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A member sent a payment request.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_invoice, '0712345678', 100000, v_token_hash, v_owner);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A number not in Daraja''s form was taken.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 100050, v_token_hash, v_owner);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A request with cents was taken.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 300000, v_token_hash, v_owner);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A request for more than is due was taken.'; END IF;
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_usd_invoice, '254712345678', 100000, v_token_hash, v_owner);
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A dollar invoice asked for M-Pesa.'; END IF;

  -- A request, Daraja's acceptance, and a cancelled one beside it.
  v_request := public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 100000, v_token_hash, v_owner);
  IF v_request->>'accountReference' <> upper(regexp_replace(v_number, '[^A-Za-z0-9]', '', 'g')) THEN
    RAISE EXCEPTION 'The account reference is not the invoice number in letters and digits: %', v_request;
  END IF;
  PERFORM public.record_mpesa_payment_request_sent(v_org, (v_request->>'id')::UUID, true, 'ws_CO_100', 'm-100', 'Success. Request accepted for processing');
  PERFORM public.record_mpesa_payment_request_sent(v_org, (v_request->>'id')::UUID, false, NULL, NULL, 'again');
  IF (SELECT status || ':' || checkout_request_id FROM public.mpesa_payment_requests WHERE id = (v_request->>'id')::UUID) <> 'SENT:ws_CO_100' THEN
    RAISE EXCEPTION 'A sent request was marked again.';
  END IF;
  v_cancelled := public.create_mpesa_payment_request(v_org, v_invoice, '254700000001', 50000, v_other_hash, v_owner);
  PERFORM public.record_mpesa_payment_request_sent(v_org, (v_cancelled->>'id')::UUID, true, 'ws_CO_200', 'm-200', 'Success');
  v_result := public.complete_mpesa_payment_request(v_other_hash, 'ws_CO_200', '1032', 'Request cancelled by user', NULL);
  IF v_result->>'status' <> 'FAILED'
     OR (SELECT result_message FROM public.mpesa_payment_requests WHERE id = (v_cancelled->>'id')::UUID) <> 'Request cancelled by user' THEN
    RAISE EXCEPTION 'A cancelled request was not recorded with Safaricom''s words: %', v_result;
  END IF;
  IF NOT (public.complete_mpesa_payment_request(v_other_hash, 'ws_CO_200', '1032', 'again', NULL)->>'repeat')::BOOLEAN THEN
    RAISE EXCEPTION 'A repeated result was recorded twice.';
  END IF;

  -- Results that do not belong are refused.
  IF public.complete_mpesa_payment_request(repeat('c3', 32), 'ws_CO_100', '0', 'ok', NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A result at an unknown URL found a request.';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.complete_mpesa_payment_request(v_token_hash, 'ws_CO_999', '0', 'ok',
    '{"transId":"TKS1000001","transTime":"2026-10-22T10:00:00+03:00","amountCents":100000}');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A result for another checkout request was taken.'; END IF;

  -- Paid: kept as an M-Pesa payment with the invoice as its account, then settled in the asker's name.
  v_result := public.complete_mpesa_payment_request(v_token_hash, 'ws_CO_100', '0', 'The service request is processed successfully.',
    '{"transId":"TKS1000001","transTime":"2026-10-22T10:00:00+03:00","amountCents":100000,"msisdn":"254712345678"}');
  IF v_result->>'status' <> 'PAID' OR (v_result->>'requestedBy')::UUID <> v_owner THEN
    RAISE EXCEPTION 'The paid result was not recorded: %', v_result;
  END IF;
  IF (SELECT source || ':' || bill_ref_number FROM public.mpesa_payments WHERE id = (v_result->>'paymentId')::UUID)
     <> 'STK_CALLBACK:' || (v_request->>'accountReference')
     OR (SELECT bank_account_id FROM public.bank_transactions WHERE org_id = v_org AND reference = 'TKS1000001') <> v_mpesa THEN
    RAISE EXCEPTION 'The paid result did not become an M-Pesa payment on the M-Pesa account.';
  END IF;
  v_settled := public.settle_mpesa_payment(v_org, (v_result->>'paymentId')::UUID, (v_result->>'requestedBy')::UUID);
  IF v_settled->>'outcome' <> 'SETTLED' OR (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) <> 150000 THEN
    RAISE EXCEPTION 'The paid request did not settle its invoice: %', v_settled;
  END IF;
  -- The same receipt from the C2B confirmation finds the payment already kept.
  IF (public.receive_mpesa_payment(v_org, 'C2B_CALLBACK',
      '{"transId":"TKS1000001","transTime":"2026-10-22T10:00:00+03:00","amountCents":100000}')->>'inserted')::BOOLEAN THEN
    RAISE EXCEPTION 'The C2B confirmation of a paid request was kept a second time.';
  END IF;

  -- A result that arrives before Daraja's answer to the push is recorded is
  -- kept, and the late answer only adds its ids.
  v_request := public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 10000, repeat('e5', 32), v_owner);
  v_result := public.complete_mpesa_payment_request(repeat('e5', 32), 'ws_CO_300', '1037', 'DS timeout user cannot be reached', NULL);
  PERFORM public.record_mpesa_payment_request_sent(v_org, (v_request->>'id')::UUID, true, 'ws_CO_300', 'm-300', 'Success');
  IF (SELECT status || ':' || checkout_request_id || ':' || merchant_request_id FROM public.mpesa_payment_requests
      WHERE id = (v_request->>'id')::UUID) <> 'FAILED:ws_CO_300:m-300' THEN
    RAISE EXCEPTION 'An early result was overwritten by the late answer to the push.';
  END IF;

  -- A blank passkey stops requests.
  PERFORM public.save_mpesa_express_passkey(v_org, '', v_owner);
  v_failed := false;
  BEGIN PERFORM public.create_mpesa_payment_request(v_org, v_invoice, '254712345678', 100000, repeat('d4', 32), v_owner);
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A request was made after the passkey was removed.'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'M-Pesa payment requests passed';
