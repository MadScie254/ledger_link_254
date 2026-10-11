\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE v_employee uuid := gen_random_uuid(); v_evidence uuid; v_run uuid;
BEGIN
  IF (SELECT count(*) FROM public.statutory_adjustment_rules) <> 15 OR EXISTS (
    SELECT 1 FROM public.statutory_adjustment_rules WHERE verified OR source NOT LIKE '%https://www.kra.go.ke/%'
  ) THEN RAISE EXCEPTION 'Expected sourced unverified rules for all three versions.'; END IF;
  INSERT INTO public.employees (id, org_id, first_name, last_name, hire_date, base_salary)
    VALUES (v_employee, '00000000-0000-0000-0000-0000000000aa', 'Evidence', 'Test', DATE '2026-01-01', 10000000);
  INSERT INTO public.employee_adjustments (org_id, employee_id, adjustment_type, amount_cents, valid_from, reference_number)
    VALUES ('00000000-0000-0000-0000-0000000000aa', v_employee, 'MORTGAGE_INTEREST', 100000, DATE '2026-01-01', 'MORT-1') RETURNING id INTO v_evidence;
  PERFORM private.validate_payroll_adjustments('00000000-0000-0000-0000-0000000000aa', v_employee, DATE '2026-09-30',
    jsonb_build_array(jsonb_build_object('id', v_evidence, 'type', 'MORTGAGE_INTEREST', 'amountCents', 100000, 'appliedCents', 100000, 'referenceNumber', 'MORT-1')));
  BEGIN
    PERFORM private.validate_payroll_adjustments('00000000-0000-0000-0000-0000000000aa', gen_random_uuid(), DATE '2026-09-30',
      jsonb_build_array(jsonb_build_object('id', v_evidence, 'type', 'MORTGAGE_INTEREST', 'amountCents', 100000, 'appliedCents', 100000, 'referenceNumber', 'MORT-1')));
    RAISE EXCEPTION 'Cross-employee evidence was accepted.';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.payroll_runs (org_id, period, pay_date, rate_version)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'Rule lock', DATE '2026-09-30', 'KE-2026-02') RETURNING id INTO v_run;
  BEGIN
    UPDATE public.statutory_adjustment_rules SET monthly_cap_cents = 1 WHERE version = 'KE-2026-02';
    RAISE EXCEPTION 'Used relief rules were changed.';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM public.statutory_adjustment_rules WHERE version = 'KE-2026-02';
    RAISE EXCEPTION 'Used relief rules were deleted.';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF has_table_privilege('authenticated', 'public.employee_adjustments', 'SELECT') THEN
    RAISE EXCEPTION 'Payroll evidence bypasses the Worker access check.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'employee evidence passed';
