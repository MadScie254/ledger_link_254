-- Run after the full migration stack and tests/db/fixture.sql. The
-- transaction leaves the fixture unchanged.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_accountant UUID := '00000000-0000-0000-0000-000000000001';
  v_org UUID;
  v_general UUID;
  v_building UUID;
  v_member UUID;
  v_rows RECORD;
  v_first UUID;
  v_second UUID;
  v_third UUID;
  v_count INT;
  v_error TEXT;
  v_saved JSONB;
  v_credentials RECORD;
  v_target RECORD;
  v_hash TEXT := repeat('ab', 32);
BEGIN
  IF has_function_privilege('authenticated', 'public.ingest_mpesa_receipts(uuid,text,jsonb,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.mpesa_integration_credentials(uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('anon', 'public.mpesa_callback_target(text)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.post_mpesa_matches(uuid,jsonb,text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'M-Pesa functions are not service-role-only.';
  END IF;

  v_org := public.create_organization(v_owner, '{"name":"Kanisa M-Pesa test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"1040","name":"Cash on hand, collections","type":"ASSET","isBankAccount":true},
      {"code":"1050","name":"M-Pesa","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving and special offerings","type":"INCOME"},
      {"code":"4040","name":"Building and project giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"},
      {"code":"6400","name":"Bank and M-Pesa charges","type":"EXPENSE"}]', 'church-mpesa-test');
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_accountant, 'accountant');
  SELECT id INTO v_general FROM public.funds WHERE org_id = v_org AND code = 'GENERAL';
  SELECT id INTO v_building FROM public.funds WHERE org_id = v_org AND code = 'BUILDING';
  INSERT INTO public.members (org_id, member_number, first_name, last_name)
  VALUES (v_org, '1043', 'Amina', 'Wekesa') RETURNING id INTO v_member;

  -- A callback is kept once however often it arrives, with no person behind it.
  SELECT * INTO v_rows FROM public.ingest_mpesa_receipts(v_org, 'C2B_CALLBACK',
    '[{"transId":"sjk3h2k9qx","transTime":"2026-10-04T08:15:00+03:00","amountCents":150000,
       "billRefNumber":" 1043 ","msisdn":"2547 ***** 126","firstName":"AMINA","raw":{"TransID":"SJK3H2K9QX"}}]', NULL);
  IF NOT v_rows.inserted OR v_rows.trans_id <> 'SJK3H2K9QX' OR v_rows.bill_ref_number <> '1043' OR v_rows.status <> 'UNMATCHED' THEN
    RAISE EXCEPTION 'The callback receipt was not kept as sent: %', row_to_json(v_rows);
  END IF;
  v_first := v_rows.id;
  SELECT * INTO v_rows FROM public.ingest_mpesa_receipts(v_org, 'C2B_CALLBACK',
    '[{"transId":"SJK3H2K9QX","transTime":"2026-10-04T08:15:00+03:00","amountCents":150000,"billRefNumber":"1043"}]', NULL);
  IF v_rows.inserted OR v_rows.id <> v_first THEN
    RAISE EXCEPTION 'A repeated callback was kept twice.';
  END IF;
  IF (SELECT count(*) FROM public.mpesa_receipts WHERE org_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'A repeated transaction code made a second receipt.';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE org_id = v_org AND resource_type = 'MPESA_RECEIPT'
      AND details->>'source' = 'MPESA_C2B') <> 1 THEN
    RAISE EXCEPTION 'The callback receipt was not audited once with source MPESA_C2B.';
  END IF;
  -- A statement upload needs a person who keeps the books.
  BEGIN
    PERFORM public.ingest_mpesa_receipts(v_org, 'STATEMENT_UPLOAD',
      '[{"transId":"SJK3H2K9QY","transTime":"2026-10-04T09:00:00+03:00","amountCents":50000}]', NULL);
    RAISE EXCEPTION 'A statement was uploaded with no one named.';
  EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege THEN NULL;
  END;
  -- Receipts go only to churches.
  BEGIN
    PERFORM public.ingest_mpesa_receipts('00000000-0000-0000-0000-0000000000aa', 'C2B_CALLBACK',
      '[{"transId":"SJK3H2K9QZ","transTime":"2026-10-04T09:00:00+03:00","amountCents":50000}]', NULL);
    RAISE EXCEPTION 'A business organization took an M-Pesa receipt.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A statement brings two new lines and one already kept.
  SELECT count(*) FILTER (WHERE inserted), count(*) INTO v_count, v_error
  FROM public.ingest_mpesa_receipts(v_org, 'STATEMENT_UPLOAD',
    '[{"transId":"SJK3H2K9QX","transTime":"2026-10-04T08:15:00+03:00","amountCents":150000,"billRefNumber":"1043"},
      {"transId":"SJK4A1B2C3","transTime":"2026-10-04T10:00:00+03:00","amountCents":200000,"billRefNumber":"BLD"},
      {"transId":"SJK4A1B2C4","transTime":"2026-10-04T11:00:00+03:00","amountCents":30000,"billRefNumber":"school fees"}]',
    v_accountant);
  IF v_count <> 2 OR v_error <> '3' THEN
    RAISE EXCEPTION 'The statement kept % new of % lines, not 2 of 3.', v_count, v_error;
  END IF;
  SELECT id INTO v_second FROM public.mpesa_receipts WHERE org_id = v_org AND trans_id = 'SJK4A1B2C3';
  SELECT id INTO v_third FROM public.mpesa_receipts WHERE org_id = v_org AND trans_id = 'SJK4A1B2C4';

  -- Matches post in one call; a refused one is reported and the rest post.
  SELECT count(*) FILTER (WHERE error IS NULL), string_agg(error, '; ') INTO v_count, v_error
  FROM public.post_mpesa_matches(v_org, jsonb_build_array(
    jsonb_build_object('receiptId', v_first, 'memberId', v_member, 'fundId', v_general),
    jsonb_build_object('receiptId', v_second, 'fundId', v_building),
    jsonb_build_object('receiptId', v_first, 'memberId', v_member, 'fundId', v_general)), 'MPESA_C2B', v_accountant);
  IF v_count <> 3 THEN
    -- The repeated match returns the contribution already made (same key).
    RAISE EXCEPTION 'Matches did not post: %', v_error;
  END IF;
  IF (SELECT count(*) FROM public.contributions WHERE org_id = v_org) <> 2 THEN
    RAISE EXCEPTION 'A receipt matched twice made two gifts.';
  END IF;
  IF (SELECT status FROM public.mpesa_receipts WHERE id = v_first) <> 'POSTED'
    OR (SELECT member_id FROM public.mpesa_receipts WHERE id = v_first) <> v_member THEN
    RAISE EXCEPTION 'The matched receipt was not marked posted to its member.';
  END IF;
  IF (SELECT sum(line.credit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.org_id = v_org AND account.code = '4020' AND line.entity_type = 'FUND' AND line.entity_id = v_general) <> 150000 THEN
    RAISE EXCEPTION 'The member gift did not reach GENERAL through 4020.';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE org_id = v_org AND action = 'MATCH' AND details->>'source' = 'MPESA_C2B') < 2 THEN
    RAISE EXCEPTION 'Matches were not audited with their source.';
  END IF;
  -- A match to a closed fund is reported and the receipt stays in the queue.
  UPDATE public.funds SET is_active = false WHERE id = v_building;
  SELECT error INTO v_error FROM public.post_mpesa_matches(v_org,
    jsonb_build_array(jsonb_build_object('receiptId', v_third, 'fundId', v_building)), 'QUEUE', v_accountant);
  IF v_error IS NULL OR v_error NOT LIKE '%closed to new giving%' THEN
    RAISE EXCEPTION 'A match to a closed fund was not refused: %', v_error;
  END IF;
  IF (SELECT status FROM public.mpesa_receipts WHERE id = v_third) <> 'UNMATCHED' THEN
    RAISE EXCEPTION 'A refused match left the queue.';
  END IF;
  UPDATE public.funds SET is_active = true WHERE id = v_building;
  -- Only people who keep the books post matches.
  BEGIN
    PERFORM public.post_mpesa_matches(v_org, '[]', 'QUEUE', '00000000-0000-0000-0000-0000000000ff');
    RAISE EXCEPTION 'A stranger posted M-Pesa matches.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Setting a receipt aside needs a reason, and a posted one cannot be.
  BEGIN
    PERFORM public.ignore_mpesa_receipt(v_org, v_third, '', v_accountant);
    RAISE EXCEPTION 'A receipt was set aside with no reason.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.ignore_mpesa_receipt(v_org, v_first, 'Paid twice', v_accountant);
    RAISE EXCEPTION 'A posted receipt was set aside.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.ignore_mpesa_receipt(v_org, v_third, 'School fees paid to the wrong paybill', v_accountant);
  IF (SELECT status || ':' || ignored_reason FROM public.mpesa_receipts WHERE id = v_third)
     <> 'IGNORED:School fees paid to the wrong paybill' THEN
    RAISE EXCEPTION 'The receipt was not set aside with its reason.';
  END IF;
  PERFORM public.restore_mpesa_receipt(v_org, v_third, v_accountant);
  IF (SELECT status FROM public.mpesa_receipts WHERE id = v_third) <> 'UNMATCHED'
    OR (SELECT ignored_reason FROM public.mpesa_receipts WHERE id = v_third) IS NOT NULL THEN
    RAISE EXCEPTION 'The receipt did not go back to the queue.';
  END IF;

  -- Daraja settings: owners and admins only; the secret goes to Vault.
  BEGIN
    PERFORM public.save_mpesa_integration(v_org, '600984', 'SANDBOX', 'key-1', 'secret-1', v_accountant, v_accountant);
    RAISE EXCEPTION 'An accountant saved the Daraja settings.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_mpesa_integration(v_org, '600984', 'SANDBOX', 'key-1', NULL, v_accountant, v_owner);
    RAISE EXCEPTION 'A consumer key was saved without its secret.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  v_saved := public.save_mpesa_integration(v_org, '600984', 'SANDBOX', 'key-1', 'secret-1', v_accountant, v_owner);
  IF NOT (v_saved->>'hasCredentials')::BOOLEAN THEN
    RAISE EXCEPTION 'The Daraja credentials were not kept.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND details::TEXT LIKE '%secret-1%')
    OR EXISTS (SELECT 1 FROM public.org_integrations WHERE org_id = v_org AND row_to_json(org_integrations)::TEXT LIKE '%secret-1%') THEN
    RAISE EXCEPTION 'The Daraja secret was written outside Vault.';
  END IF;
  IF (SELECT integration_actor_id FROM public.organizations WHERE id = v_org) <> v_accountant THEN
    RAISE EXCEPTION 'The integration user was not set.';
  END IF;
  -- Saving again without new credentials keeps the old ones.
  PERFORM public.save_mpesa_integration(v_org, '600984', 'SANDBOX', NULL, NULL, v_accountant, v_owner);
  SELECT * INTO v_credentials FROM public.mpesa_integration_credentials(v_org);
  IF v_credentials.consumer_key <> 'key-1' OR v_credentials.consumer_secret <> 'secret-1' OR v_credentials.shortcode <> '600984' THEN
    RAISE EXCEPTION 'The saved Daraja credentials did not read back.';
  END IF;
  PERFORM public.save_mpesa_integration(v_org, '600984', 'SANDBOX', 'key-2', 'secret-2', v_accountant, v_owner);
  IF (SELECT consumer_secret FROM public.mpesa_integration_credentials(v_org)) <> 'secret-2'
    OR (SELECT count(*) FROM vault.secrets WHERE name = 'org:' || v_org::TEXT || ':mpesa_c2b') <> 1 THEN
    RAISE EXCEPTION 'New credentials did not replace the old ones in Vault.';
  END IF;

  -- No token, no target; a failed registration keeps the old token.
  IF EXISTS (SELECT 1 FROM public.mpesa_callback_target(v_hash)) THEN
    RAISE EXCEPTION 'A token that was never issued found a church.';
  END IF;
  PERFORM public.record_mpesa_registration(v_org, v_hash, true, 'Success', v_owner);
  SELECT * INTO v_target FROM public.mpesa_callback_target(v_hash);
  IF v_target.org_id <> v_org OR v_target.integration_actor_id <> v_accountant OR v_target.shortcode <> '600984' THEN
    RAISE EXCEPTION 'The registered token did not find its church.';
  END IF;
  PERFORM public.record_mpesa_registration(v_org, repeat('cd', 32), false, 'Invalid Access Token', v_owner);
  IF NOT EXISTS (SELECT 1 FROM public.mpesa_callback_target(v_hash))
    OR (SELECT last_error FROM public.org_integrations WHERE org_id = v_org) <> 'Invalid Access Token' THEN
    RAISE EXCEPTION 'A failed registration replaced the working token.';
  END IF;
  PERFORM public.set_mpesa_callback_token(v_org, repeat('ef', 32), v_owner);
  IF EXISTS (SELECT 1 FROM public.mpesa_callback_target(v_hash))
    OR NOT EXISTS (SELECT 1 FROM public.mpesa_callback_target(repeat('ef', 32))) THEN
    RAISE EXCEPTION 'New callback URLs did not replace the old ones.';
  END IF;
  -- A new paybill number needs registering again.
  PERFORM public.save_mpesa_integration(v_org, '600985', 'SANDBOX', NULL, NULL, v_accountant, v_owner);
  IF (SELECT status FROM public.org_integrations WHERE org_id = v_org) <> 'DRAFT' THEN
    RAISE EXCEPTION 'A changed paybill kept its registered status.';
  END IF;
  BEGIN
    PERFORM public.save_mpesa_integration(v_org, '600985', 'SANDBOX', NULL, NULL,
      '00000000-0000-0000-0000-0000000000ff', v_owner);
    RAISE EXCEPTION 'A stranger was made the integration user.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- Statement charges post once each, however often the statement is uploaded.
  v_saved := public.record_statement_charges(v_org,
    '[{"transId":"CHG0000001","date":"2026-10-04","amountCents":1500},{"transId":"CHG0000002","date":"2026-10-06","amountCents":2000}]',
    v_accountant);
  IF (v_saved->>'charges')::INT <> 2 OR (v_saved->>'amountCents')::BIGINT <> 3500 OR v_saved->>'journalEntryId' IS NULL THEN
    RAISE EXCEPTION 'Statement charges did not post: %', v_saved;
  END IF;
  IF (SELECT entry_date FROM public.journal_entries WHERE id = (v_saved->>'journalEntryId')::UUID) <> '2026-10-06' THEN
    RAISE EXCEPTION 'Charges were not dated to the last charge.';
  END IF;
  v_saved := public.record_statement_charges(v_org,
    '[{"transId":"chg0000002","date":"2026-10-06","amountCents":2000},{"transId":"CHG0000003","date":"2026-10-09","amountCents":700}]',
    v_accountant);
  IF (v_saved->>'charges')::INT <> 1 OR (v_saved->>'amountCents')::BIGINT <> 700 OR (v_saved->>'alreadyRecorded')::INT <> 1 THEN
    RAISE EXCEPTION 'An overlapping statement posted a charge twice: %', v_saved;
  END IF;
  v_saved := public.record_statement_charges(v_org, '[{"transId":"CHG0000003","date":"2026-10-09","amountCents":700}]', v_accountant);
  IF v_saved->>'journalEntryId' IS NOT NULL THEN
    RAISE EXCEPTION 'A repeated statement posted charges again.';
  END IF;
  IF (SELECT sum(line.debit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.org_id = v_org AND account.code = '6400') <> 4200 THEN
    RAISE EXCEPTION 'Charges on 6400 are not 4200 cents.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'ALL CHURCH M-PESA SQL TESTS PASSED';
