\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_payable UUID := '00000000-0000-0000-0000-00000000a216';
  v_employee UUID := gen_random_uuid();
  v_run UUID;
  v_payment JSONB;
  v_again JSONB;
  v_reversal JSONB;
  v_failed BOOLEAN;
BEGIN
  INSERT INTO public.employees(id, org_id, first_name, last_name, base_salary, hire_date)
    VALUES(v_employee, v_org, 'Salary', 'Test', 100000, DATE '2026-01-01');
  v_run := public.run_payroll_with_journal(v_org, 'September 2026', DATE '2026-09-30', 'KE-2026-02',
    v_owner, 'salary-test-run', '00000000-0000-0000-0000-00000000a610',
    '00000000-0000-0000-0000-00000000a611', v_payable,
    '00000000-0000-0000-0000-00000000a211', '00000000-0000-0000-0000-00000000a212',
    '00000000-0000-0000-0000-00000000a213', '00000000-0000-0000-0000-00000000a214',
    jsonb_build_array(jsonb_build_object('employeeId', v_employee, 'grossCents', 100000,
      'taxablePayCents', 100000, 'payeCents', 0, 'nssfCents', 6000, 'shifCents', 2750,
      'ahlCents', 1500, 'employerNssfCents', 6000, 'employerAhlCents', 1500,
      'netCents', 89750, 'rateVersion', 'KE-2026-02')));
  IF (SELECT net_pay_account_id FROM public.payroll_runs WHERE id = v_run) <> v_payable THEN
    RAISE EXCEPTION 'New payroll run did not record payable account.';
  END IF;
  IF (SELECT count(*) FROM public.journal_lines WHERE journal_entry_id =
      (SELECT journal_entry_id FROM public.payroll_runs WHERE id = v_run)
      AND account_id = v_payable AND credit = 89750) <> 1 THEN
    RAISE EXCEPTION 'Payroll did not credit net salaries payable.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_lines WHERE journal_entry_id =
      (SELECT journal_entry_id FROM public.payroll_runs WHERE id = v_run) AND account_id = v_bank) THEN
    RAISE EXCEPTION 'Payroll touched the bank before payment.';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.pay_salaries(v_org, v_run, v_bank, DATE '2026-09-29', v_owner, 'salary-too-early');
  EXCEPTION WHEN invalid_parameter_value THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Early salary payment was accepted.'; END IF;
  v_payment := public.pay_salaries(v_org, v_run, v_bank, DATE '2026-10-01', v_owner, 'salary-test-payment');
  v_again := public.pay_salaries(v_org, v_run, v_bank, DATE '2026-10-01', v_owner, 'salary-test-payment');
  IF v_again->>'id' <> v_payment->>'id' THEN RAISE EXCEPTION 'Retry posted a second payment.'; END IF;
  IF (SELECT count(*) FROM public.journal_lines WHERE journal_entry_id = (v_payment->>'journalEntryId')::UUID
    AND account_id = v_payable AND debit = 89750) <> 1 OR
    (SELECT count(*) FROM public.journal_lines WHERE journal_entry_id = (v_payment->>'journalEntryId')::UUID
    AND account_id = v_bank AND credit = 89750) <> 1 THEN
    RAISE EXCEPTION 'Salary payment posting is not balanced against payable and bank.';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.pay_salaries(v_org, v_run, v_bank, DATE '2026-10-02', v_owner, 'salary-duplicate');
  EXCEPTION WHEN unique_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Second active salary payment was accepted.'; END IF;
  PERFORM public.reverse_payroll_run(v_org, v_run, DATE '2026-10-02', 'Wrong salary', v_owner);
  IF (SELECT reversed_at FROM public.salary_payments WHERE id = (v_payment->>'id')::UUID) IS NOT NULL THEN
    RAISE EXCEPTION 'Run reversal also reversed its payment.';
  END IF;
  v_reversal := public.reverse_salary_payment(v_org, v_run, (v_payment->>'id')::UUID,
    DATE '2026-10-03', 'Bank payment was wrong', v_owner);
  IF v_reversal->>'reversalJournalEntryId' IS NULL OR
     (SELECT reversed_at FROM public.salary_payments WHERE id = (v_payment->>'id')::UUID) IS NULL THEN
    RAISE EXCEPTION 'Salary payment reversal was not recorded.';
  END IF;
  IF (SELECT count(*) FROM public.journal_lines WHERE journal_entry_id =
      (v_reversal->>'reversalJournalEntryId')::UUID AND account_id = v_bank AND debit = 89750) <> 1 THEN
    RAISE EXCEPTION 'Salary payment reversal did not restore bank.';
  END IF;
  IF (public.reverse_salary_payment(v_org, v_run, (v_payment->>'id')::UUID,
    DATE '2026-10-03', 'Retry', v_owner))->>'reversalJournalEntryId' <> v_reversal->>'reversalJournalEntryId' THEN
    RAISE EXCEPTION 'Payment reversal retry created a second journal.';
  END IF;
  IF has_table_privilege('authenticated', 'public.salary_payments', 'SELECT') THEN
    RAISE EXCEPTION 'Salary payments bypass Worker payroll access.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'salary payments passed';
