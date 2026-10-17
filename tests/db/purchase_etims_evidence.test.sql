\c lltest
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_other UUID := '00000000-0000-0000-0000-0000000000bb';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_lines JSONB := jsonb_build_array(jsonb_build_object('description', 'Supply',
    'accountId', '00000000-0000-0000-0000-00000000a600', 'amountCents', 10000, 'taxCents', 1600));
  v_bill UUID;
  v_expense JSONB;
  v_row RECORD;
BEGIN
  v_bill := public.create_bill_with_evidence(v_org, v_vendor, DATE '2026-09-10', DATE '2026-10-10',
    'KES', 1, NULL, v_owner, v_lines, 'etims-bill-missing', 'INV-101', NULL, NULL, NULL);
  ASSERT v_bill = public.create_bill_with_evidence(v_org, v_vendor, DATE '2026-09-10', DATE '2026-10-10',
    'KES', 1, NULL, v_owner, v_lines, 'etims-bill-missing', 'INV-101', NULL, NULL, NULL), 'bill retry is idempotent';
  v_expense := public.record_expense_with_evidence(v_org, v_vendor, NULL, DATE '2026-09-11',
    v_bank, NULL, NULL, v_lines, v_owner, 'etims-exp-missing', NULL, NULL, NULL);
  ASSERT v_expense = public.record_expense_with_evidence(v_org, v_vendor, NULL, DATE '2026-09-11',
    v_bank, NULL, NULL, v_lines, v_owner, 'etims-exp-missing', NULL, NULL, NULL), 'expense retry is idempotent';
  PERFORM public.create_bill_with_evidence(v_org, v_vendor, DATE '2026-09-12', DATE '2026-10-12',
    'KES', 1, NULL, v_owner, v_lines, 'etims-bill-cu', 'INV-102', 'CU-102', DATE '2026-09-12', NULL);
  PERFORM public.record_expense_with_evidence(v_org, v_vendor, NULL, DATE '2026-09-13',
    v_bank, NULL, NULL, v_lines, v_owner, 'etims-exp-exempt', NULL, NULL, 'Supplier not VAT-registered');

  SELECT * INTO v_row FROM public.input_vat_at_risk(v_org, DATE '2026-09-01', DATE '2026-09-30');
  ASSERT v_row.period = '2026-09' AND v_row.supplier_id = v_vendor
    AND v_row.bill_count = 1 AND v_row.expense_count = 1 AND v_row.vat_cents = 3200,
    'only posted VAT without evidence is counted by month and supplier';
  ASSERT (SELECT count(*) FROM public.input_vat_at_risk(v_other, DATE '2026-09-01', DATE '2026-09-30')) = 0,
    'another organization cannot see these purchases';

  BEGIN
    PERFORM public.create_bill_with_evidence(v_org, v_vendor, DATE '2026-09-14', DATE '2026-10-14',
      'KES', 1, NULL, v_owner, v_lines, 'etims-bill-bad', 'INV-103', 'CU-103', NULL, NULL);
    RAISE EXCEPTION 'accepted a CU number without its date';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.create_bill_with_evidence(v_org, v_vendor, DATE '2026-09-10', DATE '2026-10-10',
      'KES', 1, NULL, v_owner, v_lines, 'etims-bill-missing', 'INV-101', 'DIFFERENT', DATE '2026-09-10', NULL);
    RAISE EXCEPTION 'changed evidence on an idempotent retry';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  PERFORM public.set_purchase_etims_evidence(v_org, 'BILL', v_bill, v_owner, 'CU-101', DATE '2026-09-10', NULL);
  ASSERT (SELECT vat_cents FROM public.input_vat_at_risk(v_org, DATE '2026-09-01', DATE '2026-09-30')) = 1600,
    'later evidence removes the bill from risk without changing its journal';
  PERFORM public.set_purchase_etims_evidence(v_org, 'EXPENSE', (v_expense->>'id')::UUID, v_owner,
    NULL, NULL, 'Exempt supply');
  ASSERT (SELECT count(*) FROM public.input_vat_at_risk(v_org, DATE '2026-09-01', DATE '2026-09-30')) = 0,
    'an exemption removes the expense from risk';
  BEGIN
    PERFORM public.set_purchase_etims_evidence(v_other, 'BILL', v_bill, v_owner, NULL, NULL, NULL);
    RAISE EXCEPTION 'changed another organization purchase';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT NOT has_function_privilege('authenticated',
    'public.set_purchase_etims_evidence(uuid,text,uuid,uuid,text,date,text)', 'EXECUTE'),
    'browser role cannot call evidence mutation directly';
  RAISE NOTICE 'PURCHASE ETIMS SQL TESTS PASSED';
END $$;
SELECT 'PURCHASE ETIMS SQL TESTS PASSED';
