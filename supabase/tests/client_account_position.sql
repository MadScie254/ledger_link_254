-- Run after the full migration stack and tests/db/fixture.sql.
BEGIN;
DO $test$
DECLARE
  v_actor UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID;
  v_client UUID;
  v_matter UUID;
  v_position RECORD;
BEGIN
  IF has_function_privilege('authenticated', 'public.client_account_position(uuid,date)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.client_account_position(uuid,date)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'client_account_position is not service-role-only.';
  END IF;
  v_org := public.create_organization(v_actor, '{"name":"Position test","edition":"law"}',
    '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1060","name":"Client bank","type":"ASSET","currency":"KES","isBankAccount":true},
      {"code":"1100","name":"Receivables","type":"ASSET","currency":"KES"},
      {"code":"2200","name":"Client money held","type":"LIABILITY","currency":"KES"}]', 'position-test');
  INSERT INTO public.customers(org_id, display_name) VALUES (v_org, 'Fictional client') RETURNING id INTO v_client;
  INSERT INTO public.matters(org_id, matter_number, title, client_id, created_by)
  VALUES (v_org, 'MAT-TEST-9', 'Position matter', v_client, v_actor) RETURNING id INTO v_matter;

  PERFORM public.record_client_receipt(v_org, v_matter, 10000, DATE '2026-10-01', 'BANK', 'REF-1', 'position-receipt', v_actor);
  PERFORM public.record_client_payment(v_org, v_matter, 3000, DATE '2026-10-05', 'Court', 'Filing fee', false, 'position-payment', v_actor);

  SELECT * INTO v_position FROM public.client_account_position(v_org, DATE '2026-10-03');
  IF v_position.client_bank_cents <> 10000 OR v_position.client_held_cents <> 10000 OR v_position.matter_ledgers_cents <> 10000 THEN
    RAISE EXCEPTION 'Position before the payment is wrong: %', row_to_json(v_position);
  END IF;
  SELECT * INTO v_position FROM public.client_account_position(v_org, DATE '2026-10-31');
  IF v_position.client_bank_cents <> 7000 OR v_position.client_held_cents <> 7000
    OR v_position.matter_ledgers_cents <> 7000 OR v_position.untagged_held_cents <> 0 THEN
    RAISE EXCEPTION 'Position after the payment is wrong: %', row_to_json(v_position);
  END IF;
  IF (SELECT client_bank_cents FROM public.client_account_position(v_org, DATE '2026-09-30')) <> 0 THEN
    RAISE EXCEPTION 'Nothing is held before the first receipt.';
  END IF;
END
$test$;
ROLLBACK;
