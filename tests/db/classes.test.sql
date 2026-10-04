\c lltest
-- Classes and locations: postings tagged from the request, reversals taking
-- the tags of what they reverse, and the profit and loss cut by them.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_retail UUID;
  v_wholesale UUID;
  v_kisumu UUID;
  v_invoice UUID;
  v_invoice2 UUID;
  v_expense JSONB;
  v_failed BOOLEAN;
BEGIN
  INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'CLASS', 'Retail') RETURNING id INTO v_retail;
  INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'CLASS', 'Wholesale') RETURNING id INTO v_wholesale;
  INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'LOCATION', 'Kisumu') RETURNING id INTO v_kisumu;
  v_failed := false;
  BEGIN
    INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'CLASS', ' retail ');
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  ASSERT v_failed, 'one Retail per organization';

  -- A retail sale in Kisumu, as the Worker names them in the request headers.
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-class', v_retail, 'x-ledger-location', v_kisumu)::TEXT, true);
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Counter sale', 'accountId', v_sales, 'amountCents', 50000)), 'cls-inv-1');
  ASSERT (SELECT class_id = v_retail AND location_id = v_kisumu FROM public.journal_entries WHERE source_type = 'INVOICE' AND source_id = v_invoice), 'invoice tagged';

  -- Wholesale, no location: an invoice later voided, and an expense.
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-class', v_wholesale)::TEXT, true);
  v_invoice2 := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-02', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Bulk order', 'accountId', v_sales, 'amountCents', 200000)), 'cls-inv-2');
  v_expense := public.record_expense(v_org, NULL, 'Transporter', DATE '2026-09-03', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Delivery', 'accountId', v_opex, 'amountCents', 30000)), v_owner, 'cls-exp-1');
  PERFORM set_config('request.headers', '{}', true);
  PERFORM public.void_invoice_with_reversal(v_org, v_invoice2, DATE '2026-09-04', v_owner);
  ASSERT (SELECT class_id FROM public.journal_entries WHERE source_type = 'ADJUSTMENT' AND source_id = v_invoice2) = v_wholesale,
    'the void takes the class of what it reverses';

  -- The profit and loss by class: Retail 500 income, Wholesale 0 income (voided) and 300 expense.
  ASSERT (SELECT sum(credit_cents - debit_cents) FROM public.profit_and_loss_by_tag(v_org, 'CLASS', DATE '2026-09-01', DATE '2026-09-30') AS t
          JOIN public.accounts a ON a.id = t.account_id WHERE t.tag_id = v_retail AND a.type::TEXT = 'INCOME') = 50000, 'retail income';
  ASSERT (SELECT sum(credit_cents - debit_cents) FROM public.profit_and_loss_by_tag(v_org, 'CLASS', DATE '2026-09-01', DATE '2026-09-30') AS t
          JOIN public.accounts a ON a.id = t.account_id WHERE t.tag_id = v_wholesale AND a.type::TEXT = 'INCOME') = 0, 'voided wholesale nets to nothing';
  ASSERT (SELECT sum(debit_cents - credit_cents) FROM public.profit_and_loss_by_tag(v_org, 'CLASS', DATE '2026-09-01', DATE '2026-09-30') AS t
          WHERE t.tag_id = v_wholesale AND t.account_id = v_opex) = 30000, 'wholesale delivery cost';
  ASSERT (SELECT count(*) FROM public.profit_and_loss_by_tag(v_org, 'LOCATION', DATE '2026-09-01', DATE '2026-09-30') WHERE tag_id IS NULL) > 0, 'untagged entries grouped';

  -- An inactive, unknown or other kind of tag is refused.
  UPDATE public.tracking_categories SET is_active = false WHERE id = v_retail;
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-class', v_retail)::TEXT, true);
  v_failed := false;
  BEGIN
    PERFORM public.record_expense(v_org, NULL, 'x', DATE '2026-09-05', v_bank, NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_opex, 'amountCents', 100)), v_owner, 'cls-exp-2');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%not an active one%';
  END;
  ASSERT v_failed, 'inactive class refused';
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-class', v_kisumu)::TEXT, true);
  v_failed := false;
  BEGIN
    PERFORM public.record_expense(v_org, NULL, 'x', DATE '2026-09-05', v_bank, NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_opex, 'amountCents', 100)), v_owner, 'cls-exp-3');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%not an active one%';
  END;
  ASSERT v_failed, 'a location is not a class';
  PERFORM set_config('request.headers', '{}', true);

  RAISE NOTICE 'ALL CLASS AND LOCATION SQL TESTS PASSED';
END $$;
SELECT 'ALL CLASS AND LOCATION SQL TESTS PASSED';
