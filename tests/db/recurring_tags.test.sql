\c lltest
-- A recurring document is posted under the class and location of the
-- document it was made from, by hand or by the daily run, and keeps running
-- untagged once a tag is no longer in use.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
  v_contracts UUID;
  v_kisumu UUID;
  v_invoice UUID;
  v_template JSONB;
  v_run JSONB;
BEGIN
  INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'CLASS', 'Contracts') RETURNING id INTO v_contracts;
  INSERT INTO public.tracking_categories (org_id, kind, name) VALUES (v_org, 'LOCATION', 'Kisumu') RETURNING id INTO v_kisumu;

  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-class', v_contracts, 'x-ledger-location', v_kisumu)::TEXT, true);
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-06-01', DATE '2026-06-15', 'KES', 1, 'Maintenance', v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Monthly maintenance', 'accountId', v_sales, 'amountCents', 800000)), 'rt-src');
  PERFORM set_config('request.headers', '{}', true);

  v_template := public.save_recurring_template(v_org, NULL, v_invoice, 'INVOICE', NULL, 'MONTHLY', 1, v_today - 40, NULL, 2, 14, v_owner);
  ASSERT (SELECT class_id = v_contracts AND location_id = v_kisumu FROM public.recurring_templates WHERE id = (v_template->>'id')::UUID),
    'the template keeps the source document''s tags';

  -- The daily run, with no request headers, posts both under them.
  ASSERT (public.run_due_recurring()->>'posted')::INTEGER = 2, 'two posted';
  ASSERT (SELECT count(*) FROM public.journal_entries e JOIN public.recurring_runs r ON r.document_id = e.source_id
          WHERE r.template_id = (v_template->>'id')::UUID AND e.source_type = 'INVOICE'
            AND e.class_id = v_contracts AND e.location_id = v_kisumu) = 2, 'both tagged';
  ASSERT current_setting('ledger.class_id', true) IS NULL OR current_setting('ledger.class_id', true) = '', 'the setting is cleared after posting';

  -- A class no longer in use is left off; the schedule still runs.
  v_template := public.save_recurring_template(v_org, NULL, v_invoice, 'INVOICE', 'Maintenance, weekly', 'WEEKLY', 1, v_today, NULL, NULL, 7, v_owner);
  UPDATE public.tracking_categories SET is_active = false WHERE id = v_contracts;
  v_run := public.run_recurring_template(v_org, (v_template->>'id')::UUID, v_today, v_owner);
  ASSERT (SELECT class_id IS NULL AND location_id = v_kisumu FROM public.journal_entries
          WHERE source_type = 'INVOICE' AND source_id = (v_run->>'documentId')::UUID), 'inactive class left off, location kept';

  RAISE NOTICE 'ALL RECURRING TAG SQL TESTS PASSED';
END $$;
SELECT 'ALL RECURRING TAG SQL TESTS PASSED';
