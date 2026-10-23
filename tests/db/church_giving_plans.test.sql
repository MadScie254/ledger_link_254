\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_org UUID;
  v_fund UUID;
  v_member UUID;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Giving plan test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving","type":"INCOME"},
      {"code":"4040","name":"Building giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"}]', 'giving-plan-test');
  SELECT id INTO v_fund FROM public.funds WHERE org_id = v_org AND code = 'GENERAL';
  INSERT INTO public.members (org_id, member_number, first_name)
    VALUES (v_org, 'PLAN-1', 'Maria') RETURNING id INTO v_member;
  INSERT INTO public.church_giving_plans (org_id, member_id, fund_id, monthly_cents, starts_on, created_by)
    VALUES (v_org, v_member, v_fund, 50000, DATE '2026-01-01', v_owner);
  PERFORM public.record_contribution(v_org, v_member, v_fund, NULL, 25000, 'BANK',
    DATE '2026-03-12', NULL, 'plan-gift-1', v_owner);
  IF (SELECT received_cents FROM public.church_giving_plan_monthly(v_org, DATE '2026-03-01')) <> 25000 THEN
    RAISE EXCEPTION 'Giving plan did not count posted giving.';
  END IF;
  BEGIN
    INSERT INTO public.church_giving_plans (org_id, member_id, fund_id, monthly_cents, starts_on)
      VALUES (v_org, v_member, v_fund, 10000, DATE '2026-06-01');
    RAISE EXCEPTION 'Overlapping giving plans were accepted.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.church_giving_plans (org_id, member_id, fund_id, monthly_cents, starts_on)
      VALUES (v_org, v_member, v_fund, 0, DATE '2027-01-01');
    RAISE EXCEPTION 'Zero monthly giving was accepted.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;
ROLLBACK;
SELECT 'CHURCH GIVING PLAN TEST PASSED';
