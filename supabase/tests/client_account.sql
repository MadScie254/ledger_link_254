-- Run after the full migration stack and tests/db/fixture.sql.
BEGIN;
DO $test$
DECLARE
  v_actor UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID;
  v_client UUID;
  v_matter UUID;
  v_client_bank UUID;
  v_office_bank UUID;
  v_liability UUID;
  v_ar UUID;
  v_wht UUID;
  v_recoverable UUID;
  v_fees UUID;
  v_invoice UUID;
  v_second_invoice UUID;
  v_receipt UUID;
  v_entry UUID;
  v_before BIGINT;
  v_error TEXT;
BEGIN
  IF has_function_privilege('authenticated',
      'public.client_balances(uuid,date)'::regprocedure,'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.record_client_receipt(uuid,uuid,bigint,date,text,text,text,uuid)'::regprocedure,'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.client_balances(uuid,date)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'Client-money RPC grants are not service-role-only.';
  END IF;
  v_org := public.create_organization(v_actor, '{"name":"Client account test","edition":"law"}',
    '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1060","name":"Client bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1100","name":"Receivables","type":"ASSET","currency":"KES"},
      {"code":"1170","name":"WHT receivable","type":"ASSET","currency":"KES"},
      {"code":"1180","name":"Disbursements recoverable","type":"ASSET","currency":"KES"},
      {"code":"2200","name":"Client money held","type":"LIABILITY","currency":"KES"},
      {"code":"4300","name":"Legal fees","type":"INCOME","currency":"KES"}]', 'client-account-test');
  SELECT id INTO v_office_bank FROM public.accounts WHERE org_id=v_org AND code='1000';
  SELECT id INTO v_client_bank FROM public.accounts WHERE org_id=v_org AND code='1060';
  SELECT id INTO v_ar FROM public.accounts WHERE org_id=v_org AND code='1100';
  SELECT id INTO v_wht FROM public.accounts WHERE org_id=v_org AND code='1170';
  SELECT id INTO v_recoverable FROM public.accounts WHERE org_id=v_org AND code='1180';
  SELECT id INTO v_liability FROM public.accounts WHERE org_id=v_org AND code='2200';
  SELECT id INTO v_fees FROM public.accounts WHERE org_id=v_org AND code='4300';
  INSERT INTO public.customers(org_id,display_name) VALUES (v_org,'Fictional client') RETURNING id INTO v_client;
  INSERT INTO public.matters(org_id,matter_number,title,client_id,created_by)
  VALUES (v_org,'MAT-TEST-1','Test matter',v_client,v_actor) RETURNING id INTO v_matter;

  BEGIN
    PERFORM public.record_client_receipt(v_org,v_matter,100,DATE '2026-10-09',
      'BANK','REF-OTHER-ACTOR','other-actor','00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'A non-member posted client money.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  v_receipt := public.record_client_receipt(v_org,v_matter,20000,DATE '2026-10-09',
    'BANK','REF-1','receipt-1',v_actor);
  IF public.record_client_receipt(v_org,v_matter,20000,DATE '2026-10-09',
    'BANK','REF-1','receipt-1',v_actor) IS DISTINCT FROM v_receipt THEN
    RAISE EXCEPTION 'Receipt retry returned another journal entry.';
  END IF;
  IF (SELECT balance_cents FROM public.client_balances(v_org,DATE '2026-10-09') WHERE matter_id=v_matter) <> 20000 THEN
    RAISE EXCEPTION 'Receipt did not increase the matter client balance.';
  END IF;
  IF (SELECT balance_cents FROM public.client_balances(v_org,DATE '2026-10-08') WHERE matter_id=v_matter) <> 0 THEN
    RAISE EXCEPTION 'The as-of balance includes a future receipt.';
  END IF;
  IF (SELECT count(*) FROM public.journal_lines WHERE journal_entry_id=v_receipt
      AND entity_type='MATTER' AND entity_id=v_matter) <> 2 THEN
    RAISE EXCEPTION 'Client receipt lines were not tagged to the matter.';
  END IF;
  SELECT count(*) INTO v_before FROM public.journal_entries WHERE org_id=v_org;
  BEGIN
    PERFORM public.record_client_payment(v_org,v_matter,20001,DATE '2026-10-09',
      'Fictional payee','Court fee',true,'overdraw-1',v_actor);
    RAISE EXCEPTION 'A client payment overdrew the matter.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'balance' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.journal_entries WHERE org_id=v_org) <> v_before THEN
    RAISE EXCEPTION 'The refused withdrawal posted a journal.';
  END IF;
  v_entry := public.record_client_payment(v_org,v_matter,5000,DATE '2026-10-09',
    'Fictional payee','Court fee',true,'payment-1',v_actor);
  IF (SELECT balance_cents FROM public.client_balances(v_org,DATE '2026-10-09') WHERE matter_id=v_matter) <> 15000
    OR NOT EXISTS (SELECT 1 FROM public.disbursements WHERE org_id=v_org AND matter_id=v_matter
      AND paid_from='CLIENT' AND amount_cents=5000 AND journal_entry_id=v_entry) THEN
    RAISE EXCEPTION 'Client payment did not reconcile with the disbursement and balance.';
  END IF;

  INSERT INTO public.invoices(org_id,invoice_number,customer_id,matter_id,date,
    subtotal_cents,total_cents,amount_due_cents,foreign_amount_cents,status,currency,created_by)
  VALUES (v_org,'FEE-TEST-1',v_client,v_matter,DATE '2026-10-09',10000,10000,10000,10000,'VOID','KES',v_actor)
  RETURNING id INTO v_invoice;
  BEGIN
    PERFORM public.transfer_client_to_office(v_org,v_matter,v_invoice,1000,DATE '2026-10-09',
      v_office_bank,'void-transfer',v_actor);
    RAISE EXCEPTION 'A void fee note received client money.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'invoice' THEN RAISE; END IF;
  END;
  INSERT INTO public.invoices(org_id,invoice_number,customer_id,matter_id,date,
    subtotal_cents,total_cents,amount_due_cents,foreign_amount_cents,status,currency,created_by)
  VALUES (v_org,'FEE-TEST-2',v_client,v_matter,DATE '2026-10-09',10000,10000,10000,10000,'SENT','KES',v_actor)
  RETURNING id INTO v_second_invoice;
  INSERT INTO public.invoice_lines(org_id,invoice_id,description,account_id,amount_cents,
    foreign_amount_cents,line_kind)
  VALUES (v_org,v_second_invoice,'Professional fees',v_fees,10000,10000,'PROFIT_COST');
  BEGIN
    PERFORM private.insert_journal_entry(v_org,DATE '2026-10-09','Wrong client deposit','PAYMENT',
      v_second_invoice,NULL,v_actor,
      jsonb_build_array(jsonb_build_object('accountId',v_client_bank,'debit',100,'credit',0,
          'entityType','CUSTOMER','entityId',v_client),
        jsonb_build_object('accountId',v_ar,'debit',0,'credit',100,
          'entityType','CUSTOMER','entityId',v_client)), 'client-account-wrong-deposit');
    RAISE EXCEPTION 'An invoice payment deposited into 1060.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'Client money.*1060/2200' THEN RAISE; END IF;
  END;
  PERFORM private.insert_journal_entry(v_org,DATE '2026-10-09','Fee note issue','INVOICE',
    v_second_invoice,'FEE-TEST-2',v_actor,
    jsonb_build_array(jsonb_build_object('accountId',v_ar,'debit',10000,'credit',0),
      jsonb_build_object('accountId',v_fees,'debit',0,'credit',10000)), 'fee-test-issue');
  v_entry := public.transfer_client_to_office(v_org,v_matter,v_second_invoice,7000,
    DATE '2026-10-09',v_office_bank,'transfer-1',v_actor);
  IF public.transfer_client_to_office(v_org,v_matter,v_second_invoice,7000,
    DATE '2026-10-09',v_office_bank,'transfer-1',v_actor) IS DISTINCT FROM v_entry THEN
    RAISE EXCEPTION 'Transfer retry returned another entry.';
  END IF;
  IF (SELECT amount_due_cents FROM public.invoices WHERE id=v_second_invoice) <> 3000
    OR (SELECT balance_cents FROM public.client_balances(v_org,DATE '2026-10-09') WHERE matter_id=v_matter) <> 8000 THEN
    RAISE EXCEPTION 'Transfer did not update the invoice and client balance.';
  END IF;
  IF (SELECT COALESCE(sum(debit-credit),0) FROM public.journal_lines
      WHERE org_id=v_org AND account_id=v_ar) <> 3000 THEN
    RAISE EXCEPTION 'Transfer did not reconcile accounts receivable.';
  END IF;

  v_entry := public.record_office_disbursement(v_org,v_matter,1200,DATE '2026-10-09',
    'Filing fee',v_office_bank,'R-2','office-disbursement-1',v_actor);
  IF NOT EXISTS (SELECT 1 FROM public.disbursements WHERE journal_entry_id=v_entry
      AND paid_from='OFFICE' AND amount_cents=1200) THEN
    RAISE EXCEPTION 'Office disbursement was not recorded.';
  END IF;
  IF (SELECT COALESCE(sum(debit-credit),0) FROM public.journal_lines
      WHERE org_id=v_org AND account_id=v_recoverable) <> 1200 THEN
    RAISE EXCEPTION 'Office disbursement did not post to 1180.';
  END IF;

  BEGIN
    PERFORM public.receive_fee_note_payment(v_org,v_second_invoice,2000,501,'WHT-OVER',
      DATE '2026-10-09',v_office_bank,'wht-over',v_actor);
    RAISE EXCEPTION 'Withholding above five percent was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'withholding' THEN RAISE; END IF;
  END;
  PERFORM public.receive_fee_note_payment(v_org,v_second_invoice,2500,500,'WHT-1',
    DATE '2026-10-09',v_office_bank,'wht-1',v_actor);
  IF (SELECT amount_due_cents FROM public.invoices WHERE id=v_second_invoice) <> 0
    OR (SELECT status FROM public.invoices WHERE id=v_second_invoice) <> 'PAID'
    OR (SELECT COALESCE(sum(debit-credit),0) FROM public.journal_lines
        WHERE org_id=v_org AND account_id=v_wht) <> 500
    OR (SELECT COALESCE(sum(debit-credit),0) FROM public.journal_lines
        WHERE org_id=v_org AND account_id=v_ar) <> 0 THEN
    RAISE EXCEPTION 'Fee-note cash and withholding did not reconcile.';
  END IF;
END
$test$;
ROLLBACK;
