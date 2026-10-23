\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_org UUID;
  v_fund UUID;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Fund budget test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving","type":"INCOME"},
      {"code":"4040","name":"Building giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"}]', 'fund-budget-test');
  SELECT id INTO v_fund FROM public.funds WHERE org_id = v_org AND code = 'GENERAL';
  INSERT INTO public.church_fund_budgets (org_id, fund_id, period_start, period_end,
    income_target_cents, expense_limit_cents, created_by)
  VALUES (v_org, v_fund, DATE '2026-01-01', DATE '2026-12-31', 12000000, 8500000, v_owner);
  IF (SELECT income_target_cents FROM public.church_fund_budgets WHERE org_id = v_org AND fund_id = v_fund) <> 12000000 THEN
    RAISE EXCEPTION 'The fund budget was not stored in cents.';
  END IF;
  BEGIN
    INSERT INTO public.church_fund_budgets (org_id, fund_id, period_start, period_end,
      income_target_cents, expense_limit_cents)
    VALUES (v_org, v_fund, DATE '2026-01-01', DATE '2026-12-31', 1, 1);
    RAISE EXCEPTION 'Duplicate fund budget was accepted.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.church_fund_budgets (org_id, fund_id, period_start, period_end,
      income_target_cents, expense_limit_cents)
    VALUES (v_org, v_fund, DATE '2027-01-01', DATE '2027-12-31', -1, 1);
    RAISE EXCEPTION 'Negative fund budget was accepted.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;
ROLLBACK;
SELECT 'CHURCH FUND BUDGET TEST PASSED';
