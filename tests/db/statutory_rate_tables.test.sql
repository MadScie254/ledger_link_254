\c lltest
\set ON_ERROR_STOP 1
BEGIN;

DO $test$
DECLARE
  v_error TEXT;
BEGIN
  IF (SELECT count(*) FROM public.statutory_rate_tables) <> 3 THEN
    RAISE EXCEPTION 'Expected the three seeded rate versions.';
  END IF;
  IF (SELECT version FROM public.statutory_rate_tables
      WHERE effective_from <= DATE '2025-01-31'
      ORDER BY effective_from DESC LIMIT 1) <> 'KE-2024-12' THEN
    RAISE EXCEPTION 'The effective-date lookup selected the wrong version.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.statutory_rate_tables', 'SELECT')
      OR has_table_privilege('authenticated', 'public.statutory_rate_tables', 'UPDATE')
      OR has_table_privilege('anon', 'public.statutory_rate_tables', 'SELECT') THEN
    RAISE EXCEPTION 'The rate table grants are incorrect.';
  END IF;

  INSERT INTO public.payroll_runs (org_id, period, pay_date, rate_version, created_by)
  VALUES ('00000000-0000-0000-0000-0000000000aa', 'Rate lock test', DATE '2026-09-30',
          'KE-2026-02', '00000000-0000-0000-0000-000000000001');
  BEGIN
    UPDATE public.statutory_rate_tables SET source = 'Changed' WHERE version = 'KE-2026-02';
    RAISE EXCEPTION 'A used rate version was updated.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~ 'used by payroll' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.statutory_rate_tables WHERE version = 'KE-2026-02';
    RAISE EXCEPTION 'A used rate version was deleted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~ 'used by payroll' THEN RAISE; END IF;
  END;
END;
$test$;

ROLLBACK;
SELECT 'statutory rate versions passed';
