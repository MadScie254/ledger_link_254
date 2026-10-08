-- Run after the full migration stack and tests/db/fixture.sql.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID;
  v_client UUID;
  v_matter UUID;
  v_project UUID;
  v_bank UUID;
  v_liability UUID;
  v_bank_transaction UUID;
  v_source TEXT;
  v_error TEXT;
BEGIN
  IF to_regclass('public.matters') IS NULL OR to_regclass('public.matter_parties') IS NULL
    OR to_regclass('public.court_events') IS NULL OR to_regclass('public.matter_tasks') IS NULL
    OR to_regclass('public.disbursements') IS NULL THEN
    RAISE EXCEPTION 'Law tables are missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'matter_parties' AND indexdef ILIKE '%gin_trgm_ops%') THEN
    RAISE EXCEPTION 'Matter-party conflict-check trigram index is missing.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.matters'::regclass,
    'public.matter_parties'::regclass, 'public.court_events'::regclass,
    'public.matter_tasks'::regclass, 'public.disbursements'::regclass) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'A law table has no RLS.';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('matters','matter_parties','court_events','matter_tasks','disbursements')
    AND cmd='SELECT' AND qual LIKE '%user_has_org_access%') <> 5 THEN
    RAISE EXCEPTION 'Law tables lack organization-scoped read policies.';
  END IF;

  v_org := public.create_organization(v_owner, '{"name":"Law core test","edition":"law"}',
    '[{"code":"1060","name":"Client bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"2200","name":"Client money","type":"LIABILITY","currency":"KES"}]', 'law-core-test');
  SELECT id INTO v_bank FROM public.accounts WHERE org_id=v_org AND code='1060';
  SELECT id INTO v_liability FROM public.accounts WHERE org_id=v_org AND code='2200';
  INSERT INTO public.customers(org_id,display_name) VALUES (v_org,'Fictional client') RETURNING id INTO v_client;
  INSERT INTO public.matters(org_id,matter_number,title,client_id,matter_type,opened_on,created_by)
  VALUES (v_org,'MAT-2026-0001','Test instruction',v_client,'LITIGATION',DATE '2026-10-08',v_owner)
  RETURNING id INTO v_matter;

  BEGIN
    DELETE FROM public.matters WHERE id=v_matter;
    RAISE EXCEPTION 'A matter was hard deleted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'kept' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.matters(org_id,matter_number,title,client_id,matter_type,opened_on)
    VALUES (v_org,'MAT-2026-0002','Wrong client','00000000-0000-0000-0000-0000000000c1','OTHER',DATE '2026-10-08');
    RAISE EXCEPTION 'A cross-organization client was accepted.';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO public.matter_parties(org_id,matter_id,name,role,created_by)
  VALUES (v_org,v_matter,'Fictional opponent','OPPOSING_PARTY',v_owner);
  BEGIN
    INSERT INTO public.matter_parties(org_id,matter_id,name,role)
    VALUES ('00000000-0000-0000-0000-0000000000aa',v_matter,'Wrong organization','OTHER');
    RAISE EXCEPTION 'A cross-organization party was accepted.';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  INSERT INTO public.court_events(org_id,matter_id,event_type,starts_at,status,created_by)
  VALUES (v_org,v_matter,'HEARING','2026-10-09 09:00+03','SCHEDULED',v_owner);
  INSERT INTO public.matter_tasks(org_id,matter_id,title,due_on,created_by)
  VALUES (v_org,v_matter,'File documents',DATE '2026-10-09',v_owner);
  INSERT INTO public.disbursements(org_id,matter_id,incurred_on,description,amount_cents,paid_from,created_by)
  VALUES (v_org,v_matter,DATE '2026-10-08','Court fee',250000,'OFFICE',v_owner);
  BEGIN
    DELETE FROM public.disbursements WHERE org_id=v_org AND matter_id=v_matter;
    RAISE EXCEPTION 'A disbursement was hard deleted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'kept' THEN RAISE; END IF;
  END;
  INSERT INTO public.time_entries(org_id,matter_id,entry_date,hours,description,billable,rate_cents,amount_cents,created_by)
  VALUES (v_org,v_matter,DATE '2026-10-08',1,'Research',true,100000,100000,v_owner);

  INSERT INTO public.projects(org_id,name,project_code) VALUES
    ('00000000-0000-0000-0000-0000000000aa','Existing business project','TEST') RETURNING id INTO v_project;
  INSERT INTO public.time_entries(org_id,project_id,entry_date,hours)
  VALUES ('00000000-0000-0000-0000-0000000000aa',v_project,DATE '2026-10-08',1);
  BEGIN
    INSERT INTO public.time_entries(org_id,entry_date,hours)
    VALUES (v_org,DATE '2026-10-08',1);
    RAISE EXCEPTION 'A time entry without project or matter was accepted.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='invoices' AND column_name='matter_id')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='invoice_lines' AND column_name='line_kind')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='invoice_payments' AND column_name='wht_cents') THEN
    RAISE EXCEPTION 'Fee-note invoice columns are missing.';
  END IF;

  INSERT INTO public.bank_transactions(org_id,date,description,amount_cents,direction)
  VALUES (v_org,DATE '2026-10-08','Control test',100,'IN') RETURNING id INTO v_bank_transaction;
  FOREACH v_source IN ARRAY ARRAY['MANUAL','ADJUSTMENT','BANK'] LOOP
    BEGIN
      PERFORM public.post_journal_entry(v_org, DATE '2026-10-08', 'Manual client money',
        v_source, CASE WHEN v_source='BANK' THEN v_bank_transaction ELSE NULL END,
        NULL, v_owner,
        jsonb_build_array(jsonb_build_object('accountId',v_bank,'debit',100,'credit',0),
          jsonb_build_object('accountId',v_liability,'debit',0,'credit',100)),
        'law-control-test-' || v_source);
      RAISE EXCEPTION '% journal reached client money accounts.',v_source;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      IF v_error !~* 'Client money.*1060/2200' THEN RAISE; END IF;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE org_id=v_org AND source_type IN ('MANUAL','ADJUSTMENT','BANK')) THEN
    RAISE EXCEPTION 'A refused client-money journal left an entry.';
  END IF;
END
$test$;
ROLLBACK;
