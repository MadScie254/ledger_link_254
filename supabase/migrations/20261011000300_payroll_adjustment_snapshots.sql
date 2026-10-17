CREATE OR REPLACE FUNCTION public.run_payroll_with_journal(
  p_org_id UUID,
  p_period TEXT,
  p_pay_date DATE,
  p_rate_version TEXT,
  p_created_by UUID,
  p_idempotency_key TEXT,
  p_salary_expense_account_id UUID,
  p_employer_expense_account_id UUID,
  p_cash_account_id UUID,
  p_paye_payable_account_id UUID,
  p_nssf_payable_account_id UUID,
  p_shif_payable_account_id UUID,
  p_ahl_payable_account_id UUID,
  p_payslips JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run_id UUID;
  v_journal_id UUID;
  v_base_currency TEXT;
  v_item JSONB;
  v_employee_id UUID;
  v_seen_employees UUID[] := ARRAY[]::UUID[];
  v_gross BIGINT;
  v_taxable BIGINT;
  v_paye BIGINT;
  v_nssf BIGINT;
  v_shif BIGINT;
  v_ahl BIGINT;
  v_employer_nssf BIGINT;
  v_employer_ahl BIGINT;
  v_net BIGINT;
  v_total_gross BIGINT := 0;
  v_total_taxable BIGINT := 0;
  v_total_paye BIGINT := 0;
  v_total_nssf BIGINT := 0;
  v_total_shif BIGINT := 0;
  v_total_ahl BIGINT := 0;
  v_total_employer_nssf BIGINT := 0;
  v_total_employer_ahl BIGINT := 0;
  v_total_net BIGINT := 0;
  v_journal_lines JSONB := '[]'::JSONB;
  v_line_number INTEGER := 0;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_period IS NULL OR btrim(p_period) = '' OR length(btrim(p_period)) > 100
     OR p_pay_date IS NULL OR p_rate_version IS NULL OR btrim(p_rate_version) = '' THEN
    RAISE EXCEPTION 'Payroll period, pay date, and rate version are required.' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':payroll:' || p_idempotency_key, 0)
  );

  SELECT run.id INTO v_run_id
  FROM public.payroll_runs AS run
  WHERE run.org_id = p_org_id AND run.idempotency_key = p_idempotency_key
    AND run.reversed_at IS NULL;
  IF FOUND THEN
    RETURN v_run_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs AS run
    WHERE run.org_id = p_org_id AND run.period = btrim(p_period)
      AND run.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Payroll has already been run for this period.' USING ERRCODE = '23505';
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_salary_expense_account_id AND code = '6100' AND type = 'EXPENSE' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_employer_expense_account_id AND code = '6110' AND type = 'EXPENSE' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_cash_account_id AND code = '1000' AND type = 'ASSET' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_paye_payable_account_id AND code = '2110' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_nssf_payable_account_id AND code = '2120' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_shif_payable_account_id AND code = '2130' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_ahl_payable_account_id AND code = '2140' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active) THEN
    RAISE EXCEPTION 'Payroll accounts are inactive, incorrectly typed, or outside this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(p_payslips) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payslips) = 0 THEN
    RAISE EXCEPTION 'Payroll requires at least one payslip.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payslips)
  LOOP
    v_line_number := v_line_number + 1;
    BEGIN
      v_employee_id := (v_item->>'employeeId')::UUID;
      v_gross := (v_item->>'grossCents')::BIGINT;
      v_taxable := (v_item->>'taxablePayCents')::BIGINT;
      v_paye := (v_item->>'payeCents')::BIGINT;
      v_nssf := (v_item->>'nssfCents')::BIGINT;
      v_shif := (v_item->>'shifCents')::BIGINT;
      v_ahl := (v_item->>'ahlCents')::BIGINT;
      v_employer_nssf := (v_item->>'employerNssfCents')::BIGINT;
      v_employer_ahl := (v_item->>'employerAhlCents')::BIGINT;
      v_net := (v_item->>'netCents')::BIGINT;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Payslip % contains an invalid value.', v_line_number USING ERRCODE = '22023';
    END;

    IF v_employee_id IS NULL OR v_gross IS NULL OR v_taxable IS NULL OR v_paye IS NULL
       OR v_nssf IS NULL OR v_shif IS NULL OR v_ahl IS NULL OR v_employer_nssf IS NULL
       OR v_employer_ahl IS NULL OR v_net IS NULL
       OR v_gross < 0 OR v_taxable < 0 OR v_taxable > v_gross OR v_paye < 0 OR v_nssf < 0
       OR v_shif < 0 OR v_ahl < 0 OR v_employer_nssf < 0 OR v_employer_ahl < 0 OR v_net < 0
       OR v_net <> v_gross - v_paye - v_nssf - v_shif - v_ahl
       OR NULLIF(v_item->>'rateVersion', '') IS DISTINCT FROM p_rate_version THEN
      RAISE EXCEPTION 'Payslip % totals or statutory rate version are inconsistent.', v_line_number
        USING ERRCODE = '23514';
    END IF;
    IF v_employee_id = ANY(v_seen_employees) THEN
      RAISE EXCEPTION 'An employee appears more than once in this payroll run.' USING ERRCODE = '23505';
    END IF;
    v_seen_employees := array_append(v_seen_employees, v_employee_id);

    PERFORM 1 FROM public.employees AS employee
    WHERE employee.org_id = p_org_id AND employee.id = v_employee_id
      AND employee.status = 'Active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payslip % references an inactive or cross-organization employee.', v_line_number
        USING ERRCODE = '23503';
    END IF;

    PERFORM private.validate_payroll_adjustments(p_org_id, v_employee_id, p_pay_date, COALESCE(v_item->'appliedAdjustments', '[]'::jsonb));
    v_total_gross := v_total_gross + v_gross;
    v_total_taxable := v_total_taxable + v_taxable;
    v_total_paye := v_total_paye + v_paye;
    v_total_nssf := v_total_nssf + v_nssf;
    v_total_shif := v_total_shif + v_shif;
    v_total_ahl := v_total_ahl + v_ahl;
    v_total_employer_nssf := v_total_employer_nssf + v_employer_nssf;
    v_total_employer_ahl := v_total_employer_ahl + v_employer_ahl;
    v_total_net := v_total_net + v_net;
  END LOOP;

  IF v_total_gross <= 0 THEN
    RAISE EXCEPTION 'Payroll gross amount must be positive.' USING ERRCODE = '23514';
  END IF;

  v_run_id := gen_random_uuid();
  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'accountId', p_salary_expense_account_id, 'debit', v_total_gross, 'credit', 0,
      'description', 'Gross salaries — ' || btrim(p_period),
      'currency', v_base_currency, 'foreignDebit', v_total_gross,
      'foreignCredit', 0, 'exchangeRate', 1
    ),
    jsonb_build_object(
      'accountId', p_employer_expense_account_id,
      'debit', v_total_employer_nssf + v_total_employer_ahl, 'credit', 0,
      'description', 'Employer statutory contributions — ' || btrim(p_period),
      'currency', v_base_currency,
      'foreignDebit', v_total_employer_nssf + v_total_employer_ahl,
      'foreignCredit', 0, 'exchangeRate', 1
    ),
    jsonb_build_object(
      'accountId', p_cash_account_id, 'debit', 0, 'credit', v_total_net,
      'description', 'Net payroll — ' || btrim(p_period),
      'currency', v_base_currency, 'foreignDebit', 0,
      'foreignCredit', v_total_net, 'exchangeRate', 1
    )
  );
  IF v_total_paye > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_paye_payable_account_id, 'debit', 0, 'credit', v_total_paye,
      'description', 'PAYE payable — ' || btrim(p_period), 'currency', v_base_currency,
      'foreignDebit', 0, 'foreignCredit', v_total_paye, 'exchangeRate', 1
    ));
  END IF;
  IF v_total_nssf + v_total_employer_nssf > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_nssf_payable_account_id, 'debit', 0,
      'credit', v_total_nssf + v_total_employer_nssf,
      'description', 'NSSF payable — ' || btrim(p_period), 'currency', v_base_currency,
      'foreignDebit', 0, 'foreignCredit', v_total_nssf + v_total_employer_nssf, 'exchangeRate', 1
    ));
  END IF;
  IF v_total_shif > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_shif_payable_account_id, 'debit', 0, 'credit', v_total_shif,
      'description', 'SHIF payable — ' || btrim(p_period), 'currency', v_base_currency,
      'foreignDebit', 0, 'foreignCredit', v_total_shif, 'exchangeRate', 1
    ));
  END IF;
  IF v_total_ahl + v_total_employer_ahl > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_ahl_payable_account_id, 'debit', 0,
      'credit', v_total_ahl + v_total_employer_ahl,
      'description', 'Affordable Housing Levy payable — ' || btrim(p_period),
      'currency', v_base_currency, 'foreignDebit', 0,
      'foreignCredit', v_total_ahl + v_total_employer_ahl, 'exchangeRate', 1
    ));
  END IF;

  v_journal_id := private.insert_journal_entry(
    p_org_id, p_pay_date, 'Payroll — ' || btrim(p_period), 'PAYROLL', v_run_id,
    btrim(p_period), p_created_by, v_journal_lines,
    'payroll-post:' || v_run_id::TEXT
  );

  INSERT INTO public.payroll_runs (
    id, org_id, period, pay_date, journal_entry_id,
    total_gross_cents, total_net_cents, total_paye_cents, total_nssf_cents,
    total_shif_cents, total_ahl_cents, total_employer_nssf_cents,
    total_employer_ahl_cents, rate_version, idempotency_key, created_by
  ) VALUES (
    v_run_id, p_org_id, btrim(p_period), p_pay_date, v_journal_id,
    v_total_gross, v_total_net, v_total_paye, v_total_nssf,
    v_total_shif, v_total_ahl, v_total_employer_nssf,
    v_total_employer_ahl, p_rate_version, p_idempotency_key, p_created_by
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payslips)
  LOOP
    INSERT INTO public.payslips (
      org_id, payroll_run_id, employee_id, gross_cents, taxable_pay_cents,
      paye_cents, nssf_cents, shif_cents, ahl_cents,
      employer_nssf_cents, employer_ahl_cents, rate_version, net_cents, applied_adjustments
    ) VALUES (
      p_org_id, v_run_id, (v_item->>'employeeId')::UUID,
      (v_item->>'grossCents')::BIGINT, (v_item->>'taxablePayCents')::BIGINT,
      (v_item->>'payeCents')::BIGINT, (v_item->>'nssfCents')::BIGINT,
      (v_item->>'shifCents')::BIGINT, (v_item->>'ahlCents')::BIGINT,
      (v_item->>'employerNssfCents')::BIGINT, (v_item->>'employerAhlCents')::BIGINT,
      p_rate_version, (v_item->>'netCents')::BIGINT, COALESCE(v_item->'appliedAdjustments', '[]'::jsonb)
    );
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'CREATE', 'PAYROLL_RUN', v_run_id,
    jsonb_build_object('period', btrim(p_period), 'rateVersion', p_rate_version,
      'employeeCount', jsonb_array_length(p_payslips), 'totalGrossCents', v_total_gross,
      'totalNetCents', v_total_net, 'totalTaxablePayCents', v_total_taxable)
  );

  RETURN v_run_id;
END;
$function$;

