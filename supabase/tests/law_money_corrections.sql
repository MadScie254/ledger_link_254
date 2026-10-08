-- Regression cases for matters with previously posted client money.
BEGIN;
DO $test$
DECLARE
  v_actor UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID; v_client UUID; v_other_client UUID; v_matter UUID;
  v_client_bank UUID; v_liability UUID; v_office_bank UUID; v_fees UUID;
  v_time UUID; v_invoice UUID; v_payment_id UUID; v_transfer_payment_id UUID;
  v_error TEXT;
BEGIN
  IF has_table_privilege('service_role','public.journal_entries','INSERT')
    OR has_table_privilege('service_role','public.journal_lines','INSERT') THEN
    RAISE EXCEPTION 'Service role still has direct journal INSERT access.';
  END IF;
  v_org := public.create_organization(v_actor,'{"name":"Law corrections test","edition":"law"}',
    '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1060","name":"Client bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1100","name":"Receivables","type":"ASSET","currency":"KES"},
      {"code":"1170","name":"WHT receivable","type":"ASSET","currency":"KES"},
      {"code":"1180","name":"Recoverable disbursements","type":"ASSET","currency":"KES"},
      {"code":"2100","name":"Output VAT","type":"LIABILITY","currency":"KES"},
      {"code":"2200","name":"Client money","type":"LIABILITY","currency":"KES"},
      {"code":"4300","name":"Fees","type":"INCOME","currency":"KES"}]',
    'law-corrections-test');
  SELECT id INTO v_office_bank FROM public.accounts WHERE org_id=v_org AND code='1000';
  SELECT id INTO v_client_bank FROM public.accounts WHERE org_id=v_org AND code='1060';
  SELECT id INTO v_liability FROM public.accounts WHERE org_id=v_org AND code='2200';
  SELECT id INTO v_fees FROM public.accounts WHERE org_id=v_org AND code='4300';
  INSERT INTO public.customers(org_id,display_name) VALUES(v_org,'Original client') RETURNING id INTO v_client;
  INSERT INTO public.customers(org_id,display_name) VALUES(v_org,'Other client') RETURNING id INTO v_other_client;
  INSERT INTO public.matters(org_id,matter_number,title,client_id,created_by)
  VALUES(v_org,'CORR-1','Correction case',v_client,v_actor) RETURNING id INTO v_matter;
  PERFORM public.record_client_receipt(v_org,v_matter,10000,DATE '2026-10-01',
    'BANK','R-1','correction-receipt',v_actor);
  BEGIN
    PERFORM public.record_client_receipt(v_org,v_matter,10000,DATE '2026-10-01',
      'BANK','DIFFERENT-REF','correction-receipt',v_actor);
    RAISE EXCEPTION 'Receipt retry accepted a changed reference.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_client_receipt(v_org,v_matter,10000,DATE '2026-10-01',
      'CASH','R-1','correction-receipt',v_actor);
    RAISE EXCEPTION 'Receipt retry accepted a changed method.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.matters SET client_id=v_other_client WHERE id=v_matter;
    RAISE EXCEPTION 'Posted matter was reassigned to another client.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'client' THEN RAISE; END IF;
  END;
  PERFORM public.record_client_payment(v_org,v_matter,8000,DATE '2026-10-10',
    'Test payee','Client payment',false,'correction-payment',v_actor);
  BEGIN
    PERFORM public.record_client_payment(v_org,v_matter,8000,DATE '2026-10-10',
      'Test payee','Client payment',true,'correction-payment',v_actor);
    RAISE EXCEPTION 'Payment retry accepted a changed disbursement flag.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_client_payment(v_org,v_matter,8000,DATE '2026-10-10',
      'Another payee','Client payment',false,'correction-payment',v_actor);
    RAISE EXCEPTION 'Payment retry accepted a changed payee.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_client_payment(v_org,v_matter,8000,DATE '2026-10-10',
      'Test payee','Another purpose',false,'correction-payment',v_actor);
    RAISE EXCEPTION 'Payment retry accepted a changed purpose.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_client_payment(v_org,v_matter,3000,DATE '2026-10-05',
      'Test payee','Backdated payment',false,'backdated-payment',v_actor);
    RAISE EXCEPTION 'Backdated payment overdrew a future client balance.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'balance' THEN RAISE; END IF;
  END;
  PERFORM public.record_office_disbursement(v_org,v_matter,500,DATE '2026-10-10',
    'Court filing',v_office_bank,'D-1','correction-disbursement',v_actor);
  BEGIN
    PERFORM public.record_office_disbursement(v_org,v_matter,500,DATE '2026-10-10',
      'Different filing',v_office_bank,'D-1','correction-disbursement',v_actor);
    RAISE EXCEPTION 'Disbursement retry accepted a changed description.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_office_disbursement(v_org,v_matter,500,DATE '2026-10-10',
      'Court filing',v_office_bank,'D-2','correction-disbursement',v_actor);
    RAISE EXCEPTION 'Disbursement retry accepted a changed reference.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.time_entries(org_id,matter_id,entry_date,hours,description,billable,
    rate_cents,amount_cents,created_by)
  VALUES(v_org,v_matter,DATE '2026-10-01',2,'Professional work',true,5000,10000,v_actor)
  RETURNING id INTO v_time;
  v_invoice := public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-01',
    DATE '2026-10-15',ARRAY[v_time],ARRAY[]::UUID[],0,'Correction fee note',
    'correction-fee-note',v_actor);
  BEGIN
    PERFORM public.transfer_client_to_office(v_org,v_matter,v_invoice,3000,
      DATE '2026-10-05',v_office_bank,'backdated-transfer',v_actor);
    RAISE EXCEPTION 'Backdated transfer overdrew a future client balance.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'balance' THEN RAISE; END IF;
  END;
  PERFORM public.transfer_client_to_office(v_org,v_matter,v_invoice,1000,
    DATE '2026-10-11',v_office_bank,'correction-transfer',v_actor);
  SELECT id INTO v_transfer_payment_id FROM public.invoice_payments
  WHERE org_id=v_org AND idempotency_key='law-transfer:correction-transfer';
  PERFORM public.receive_fee_note_payment(v_org,v_invoice,8500,500,'WHT-CORR-1',
    DATE '2026-10-11',v_office_bank,'correction-wht',v_actor);
  SELECT id INTO v_payment_id FROM public.invoice_payments
  WHERE org_id=v_org AND idempotency_key='law-fee:correction-wht';
  PERFORM public.reverse_invoice_payment(v_org,v_payment_id,DATE '2026-10-12',
    'Incorrect settlement',v_actor);
  PERFORM public.reverse_invoice_payment(v_org,v_transfer_payment_id,DATE '2026-10-12',
    'Incorrect transfer',v_actor);
  IF (SELECT amount_due_cents FROM public.invoices WHERE id=v_invoice) <> 10000
    OR (SELECT balance_cents FROM public.client_balances(v_org,DATE '2026-10-12')
        WHERE matter_id=v_matter) <> 2000
    OR (SELECT COALESCE(sum(line.debit-line.credit),0) FROM public.journal_lines AS line
        JOIN public.accounts AS account ON account.id=line.account_id AND account.org_id=line.org_id
        WHERE line.org_id=v_org AND account.code='1170') <> 0 THEN
    RAISE EXCEPTION 'Law payment reversals did not restore invoice, client and WHT balances.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_lines AS line
    JOIN public.journal_entries AS entry ON entry.id=line.journal_entry_id
    WHERE line.org_id=v_org AND entry.source_type='CLIENT_TRANSFER_REVERSAL'
      AND line.account_id=v_liability AND line.entity_type='MATTER' AND line.entity_id=v_matter) THEN
    RAISE EXCEPTION 'Transfer reversal lost its matter tag.';
  END IF;

  INSERT INTO public.accounts(org_id,code,name,type) VALUES
    ('00000000-0000-0000-0000-0000000000aa','1060','Business custom bank','ASSET'),
    ('00000000-0000-0000-0000-0000000000aa','2200','Business custom liability','LIABILITY');
  PERFORM public.post_journal_entry('00000000-0000-0000-0000-0000000000aa',
    DATE '2026-10-12','Business custom account check','MANUAL',NULL,NULL,
    '00000000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('accountId',(SELECT id FROM public.accounts WHERE org_id='00000000-0000-0000-0000-0000000000aa' AND code='1060'),'debit',100,'credit',0),
      jsonb_build_object('accountId',(SELECT id FROM public.accounts WHERE org_id='00000000-0000-0000-0000-0000000000aa' AND code='2200'),'debit',0,'credit',100)),
    'business-custom-1060');
END
$test$;
SET LOCAL ROLE service_role;
DO $service_test$
DECLARE v_org UUID; v_matter UUID;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name='Law corrections test';
  SELECT id INTO v_matter FROM public.matters WHERE org_id=v_org AND matter_number='CORR-1';
  PERFORM public.record_client_receipt(v_org,v_matter,100,DATE '2026-10-13',
    'BANK','R-service','correction-service-role',
    '00000000-0000-0000-0000-000000000004');
END
$service_test$;
RESET ROLE;
ROLLBACK;
