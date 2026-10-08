BEGIN;
DO $test$
DECLARE v_actor UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID; v_client UUID; v_matter UUID; v_other UUID; v_event UUID; v_next UUID;
  v_error TEXT;
BEGIN
  v_org := public.create_organization(v_actor,
    '{"name":"Law routes test","edition":"law"}',
    '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1060","name":"Client bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1100","name":"Receivables","type":"ASSET","currency":"KES"},
      {"code":"1170","name":"WHT receivable","type":"ASSET","currency":"KES"},
      {"code":"1180","name":"Recoverable disbursements","type":"ASSET","currency":"KES"},
      {"code":"2100","name":"Output VAT","type":"LIABILITY","currency":"KES"},
      {"code":"2200","name":"Client money","type":"LIABILITY","currency":"KES"},
      {"code":"4300","name":"Fees","type":"INCOME","currency":"KES"}]',
    'law-routes-test');
  INSERT INTO public.customers(org_id,display_name) VALUES(v_org,'Acme Trading')
    RETURNING id INTO v_client;
  v_matter := public.create_law_matter(v_org,
    jsonb_build_object('title','Acme lease dispute','clientId',v_client,
      'matterType','LITIGATION','responsibleUserId',v_actor),v_actor);
  IF (SELECT matter_number FROM public.matters WHERE id=v_matter) !~ '^MAT-[0-9]{4}-0001$' THEN
    RAISE EXCEPTION 'Matter number was not issued by the MATTER counter.';
  END IF;
  INSERT INTO public.matter_parties(org_id,matter_id,name,role,created_by)
  VALUES(v_org,v_matter,'Acme Holdings','OPPOSING_PARTY',v_actor);
  IF NOT EXISTS (SELECT 1 FROM public.search_matter_conflicts(v_org,'Acme')
      WHERE matter_id=v_matter AND matter_number IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM public.search_matter_conflicts(v_org,'Acme')
      WHERE source='CUSTOMER' AND name='Acme Trading') THEN
    RAISE EXCEPTION 'Conflict search omitted a party or client.';
  END IF;
  INSERT INTO public.court_events(org_id,matter_id,event_type,starts_at,created_by)
  VALUES(v_org,v_matter,'MENTION','2026-10-15T09:00:00+03:00',v_actor)
  RETURNING id INTO v_event;
  BEGIN
    UPDATE public.court_events SET outcome='Directions issued',status='DONE' WHERE id=v_event;
    RAISE EXCEPTION 'An outcome was saved without a next date decision.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error !~* 'next' THEN RAISE; END IF;
  END;
  UPDATE public.court_events SET outcome='Directions issued',status='DONE',
    no_further_date=true WHERE id=v_event;
  v_other := public.create_law_matter(v_org,
    jsonb_build_object('title','Separate matter','clientId',v_client),v_actor);
  INSERT INTO public.court_events(org_id,matter_id,event_type,starts_at,created_by)
  VALUES(v_org,v_other,'HEARING','2026-10-20T09:00:00+03:00',v_actor)
  RETURNING id INTO v_next;
  BEGIN
    UPDATE public.court_events SET next_event_id=v_next,no_further_date=false WHERE id=v_event;
    RAISE EXCEPTION 'A next court event in another matter was accepted.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF has_table_privilege('authenticated','public.calendar_tokens','INSERT')
    OR NOT has_table_privilege('service_role','public.calendar_tokens','INSERT') THEN
    RAISE EXCEPTION 'Calendar token table grants are wrong.';
  END IF;
END
$test$;
ROLLBACK;
