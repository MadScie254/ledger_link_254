-- Run after the full migration stack and tests/db/fixture.sql.
BEGIN;
DO $test$
DECLARE
  v_actor UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID;
  v_client UUID;
  v_matter UUID;
  v_fee_account UUID;
  v_recoverable UUID;
  v_office_bank UUID;
  v_time UUID;
  v_unbilled UUID;
  v_disbursement UUID;
  v_invoice UUID;
  v_business_invoice UUID;
  v_conveyancing_matter UUID;
  v_conveyancing_time UUID;
  v_conveyancing_invoice UUID;
  v_reissued_invoice UUID;
  v_error TEXT;
BEGIN
  v_org := public.create_organization(v_actor,
    '{"name":"Fee-note test","edition":"law","taxId":"P000000000X"}',
    '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1100","name":"Receivables","type":"ASSET","currency":"KES"},
      {"code":"1180","name":"Disbursements recoverable","type":"ASSET","currency":"KES"},
      {"code":"2100","name":"Output VAT","type":"LIABILITY","currency":"KES"},
      {"code":"4300","name":"Legal fees","type":"INCOME","currency":"KES"},
      {"code":"4310","name":"Conveyancing fees","type":"INCOME","currency":"KES"}]',
    'fee-note-test');
  SELECT id INTO v_fee_account FROM public.accounts WHERE org_id=v_org AND code='4300';
  SELECT id INTO v_recoverable FROM public.accounts WHERE org_id=v_org AND code='1180';
  SELECT id INTO v_office_bank FROM public.accounts WHERE org_id=v_org AND code='1000';
  INSERT INTO public.customers(org_id,display_name) VALUES(v_org,'Fictional client') RETURNING id INTO v_client;
  INSERT INTO public.matters(org_id,matter_number,title,client_id,matter_type,created_by)
  VALUES(v_org,'FEE-MAT-1','Taxable test matter',v_client,'LITIGATION',v_actor)
  RETURNING id INTO v_matter;
  INSERT INTO public.time_entries(org_id,matter_id,entry_date,hours,description,billable,
    rate_cents,amount_cents,created_by)
  VALUES(v_org,v_matter,DATE '2026-10-09',2,'Draft pleadings',true,5000,10000,v_actor)
  RETURNING id INTO v_time;
  INSERT INTO public.time_entries(org_id,matter_id,entry_date,hours,description,billable,
    rate_cents,amount_cents,created_by)
  VALUES(v_org,v_matter,DATE '2026-10-09',1,'Nonbillable conference',false,5000,5000,v_actor)
  RETURNING id INTO v_unbilled;
  PERFORM public.record_office_disbursement(v_org,v_matter,2000,DATE '2026-10-09',
    'Filing fee',v_office_bank,'R-1','fee-disbursement-1',v_actor);
  SELECT id INTO v_disbursement FROM public.disbursements
  WHERE org_id=v_org AND matter_id=v_matter AND amount_cents=2000;

  BEGIN
    PERFORM public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
      DATE '2026-10-23',ARRAY[v_time],ARRAY[v_disbursement],16,'VAT not registered',
      'fee-note-before-vat',v_actor);
    RAISE EXCEPTION 'An unregistered law organization charged VAT.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'VAT' THEN RAISE; END IF;
  END;
  UPDATE public.organizations SET vat_registered=true WHERE id=v_org;
  v_invoice := public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
    DATE '2026-10-23',ARRAY[v_time],ARRAY[v_disbursement],16,'Test fee note',
    'fee-note-1',v_actor);
  IF public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
    DATE '2026-10-23',ARRAY[v_time],ARRAY[v_disbursement],16,'Test fee note',
    'fee-note-1',v_actor) IS DISTINCT FROM v_invoice THEN
    RAISE EXCEPTION 'Fee-note retry created another invoice.';
  END IF;
  BEGIN
    PERFORM public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
      DATE '2026-10-23',ARRAY[v_time],ARRAY[v_disbursement],0,'Test fee note',
      'fee-note-1',v_actor);
    RAISE EXCEPTION 'A reused fee-note key accepted a changed VAT rate.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
      DATE '2026-10-23',ARRAY[v_time],ARRAY[v_disbursement],16,'Changed notes',
      'fee-note-1',v_actor);
    RAISE EXCEPTION 'A reused fee-note key accepted changed notes.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
      DATE '2026-10-23',ARRAY[v_unbilled],ARRAY[v_disbursement],16,'Changed work',
      'fee-note-1',v_actor);
    RAISE EXCEPTION 'A reused fee-note key accepted different work.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT matter_id FROM public.invoices WHERE id=v_invoice) IS DISTINCT FROM v_matter
    OR (SELECT subtotal_cents FROM public.invoices WHERE id=v_invoice) <> 12000
    OR (SELECT tax_cents FROM public.invoices WHERE id=v_invoice) <> 1600
    OR (SELECT total_cents FROM public.invoices WHERE id=v_invoice) <> 13600 THEN
    RAISE EXCEPTION 'Fee-note totals or matter are wrong.';
  END IF;
  IF (SELECT count(*) FROM public.invoice_lines WHERE invoice_id=v_invoice
      AND line_kind='PROFIT_COST' AND account_id=v_fee_account AND amount_cents=10000 AND tax_cents=1600) <> 1
    OR (SELECT count(*) FROM public.invoice_lines WHERE invoice_id=v_invoice
      AND line_kind='DISBURSEMENT' AND account_id=v_recoverable AND amount_cents=2000 AND tax_cents=0) <> 1 THEN
    RAISE EXCEPTION 'Fee-note profit cost and disbursement lines are not separate.';
  END IF;
  IF (SELECT invoice_id FROM public.time_entries WHERE id=v_time) IS DISTINCT FROM v_invoice
    OR (SELECT invoice_id FROM public.disbursements WHERE id=v_disbursement) IS DISTINCT FROM v_invoice
    OR (SELECT invoice_id FROM public.time_entries WHERE id=v_unbilled) IS NOT NULL THEN
    RAISE EXCEPTION 'Unbilled work was stamped incorrectly.';
  END IF;
  IF (SELECT COALESCE(sum(line.debit-line.credit),0) FROM public.journal_lines AS line
      JOIN public.accounts AS account ON account.id=line.account_id AND account.org_id=line.org_id
      WHERE line.org_id=v_org AND account.code='1180') <> 0 THEN
    RAISE EXCEPTION 'The disbursement recovery did not clear 1180.';
  END IF;
  BEGIN
    PERFORM public.create_fee_note_from_unbilled(v_org,v_matter,DATE '2026-10-09',
      DATE '2026-10-23',ARRAY[v_time],ARRAY[]::UUID[],0,'Second bill',
      'fee-note-double',v_actor);
    RAISE EXCEPTION 'The same time entry was billed twice.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'unbilled' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_invoice_with_journal(v_org,v_client,DATE '2026-10-09',
      DATE '2026-10-23','KES',1,'Direct disbursement credit',v_actor,
      jsonb_build_array(jsonb_build_object('matterId',v_matter,
        'lineKind','DISBURSEMENT','accountId',v_recoverable,
        'description','Unmatched filing fee','amountCents',1000,'taxCents',0)),
      'fee-note-direct-disbursement');
    RAISE EXCEPTION 'A direct invoice credited 1180 without selected work.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'atomic unbilled' THEN RAISE; END IF;
  END;
  PERFORM public.record_fee_note_etims(v_org,v_invoice,'ETIMS-TEST-1',v_actor);
  IF (SELECT etims_invoice_number FROM public.invoices WHERE id=v_invoice) <> 'ETIMS-TEST-1'
    OR (SELECT etims_recorded_at FROM public.invoices WHERE id=v_invoice) IS NULL THEN
    RAISE EXCEPTION 'The manual eTIMS number was not recorded.';
  END IF;
  PERFORM public.void_invoice_with_reversal(v_org,v_invoice,DATE '2026-10-10',v_actor);
  IF (SELECT status FROM public.invoices WHERE id=v_invoice) <> 'VOID'
    OR (SELECT invoice_id FROM public.time_entries WHERE id=v_time) IS NOT NULL
    OR (SELECT invoice_id FROM public.disbursements WHERE id=v_disbursement) IS NOT NULL THEN
    RAISE EXCEPTION 'Voiding a fee note did not release its unbilled work.';
  END IF;
  v_reissued_invoice := public.create_fee_note_from_unbilled(v_org,v_matter,
    DATE '2026-10-10',DATE '2026-10-24',ARRAY[v_time],ARRAY[v_disbursement],
    16,'Corrected fee note','fee-note-reissued',v_actor);
  IF v_reissued_invoice=v_invoice OR (SELECT invoice_id FROM public.time_entries WHERE id=v_time)
      IS DISTINCT FROM v_reissued_invoice THEN
    RAISE EXCEPTION 'Released work could not be reissued.';
  END IF;

  v_business_invoice := public.create_invoice_with_journal(
    '00000000-0000-0000-0000-0000000000aa',
    '00000000-0000-0000-0000-0000000000c1',DATE '2026-10-09',DATE '2026-10-23',
    'KES',1,'Business compatibility','00000000-0000-0000-0000-000000000001',
    '[{"accountId":"00000000-0000-0000-0000-00000000a400","description":"Service","amountCents":1000,"taxCents":0}]',
    'fee-note-business-control');
  IF (SELECT matter_id FROM public.invoices WHERE id=v_business_invoice) IS NOT NULL
    OR (SELECT line_kind FROM public.invoice_lines WHERE invoice_id=v_business_invoice) <> 'OTHER' THEN
    RAISE EXCEPTION 'Business invoice behavior changed.';
  END IF;
  INSERT INTO public.matters(org_id,matter_number,title,client_id,matter_type,created_by)
  VALUES(v_org,'FEE-MAT-2','Conveyancing test',v_client,'CONVEYANCING',v_actor)
  RETURNING id INTO v_conveyancing_matter;
  INSERT INTO public.time_entries(org_id,matter_id,entry_date,hours,description,billable,
    rate_cents,amount_cents,created_by)
  VALUES(v_org,v_conveyancing_matter,DATE '2026-10-09',1,'Transfer review',true,3000,3000,v_actor)
  RETURNING id INTO v_conveyancing_time;
  v_conveyancing_invoice := public.create_fee_note_from_unbilled(v_org,v_conveyancing_matter,
    DATE '2026-10-09',DATE '2026-10-23',ARRAY[v_conveyancing_time],ARRAY[]::UUID[],
    0,'Conveyancing fee','conveyancing-fee-1',v_actor);
  IF NOT EXISTS (SELECT 1 FROM public.invoice_lines AS line
    JOIN public.accounts AS account ON account.org_id=line.org_id AND account.id=line.account_id
    WHERE line.invoice_id=v_conveyancing_invoice AND account.code='4310'
      AND line.line_kind='PROFIT_COST' AND line.tax_cents=0) THEN
    RAISE EXCEPTION 'Conveyancing fees did not credit 4310.';
  END IF;
END
$test$;
ROLLBACK;
