\c lltest
-- Recurring invoices and bills: templates from documents, month-end dates,
-- the daily run catching up, ending, pausing and failures recorded.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_invoice UUID;
  v_bill UUID;
  v_template JSONB;
  v_bill_template JSONB;
  v_result JSONB;
  v_failed BOOLEAN;
  v_today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
BEGIN
  ASSERT private.recurring_date(DATE '2026-01-31', 'MONTHLY', 1, 1) = DATE '2026-02-28', 'February keeps to the month end';
  ASSERT private.recurring_date(DATE '2026-01-31', 'MONTHLY', 1, 2) = DATE '2026-03-31', 'March is counted from the start';
  ASSERT private.recurring_date(DATE '2026-01-15', 'QUARTERLY', 1, 2) = DATE '2026-07-15', 'quarterly';
  ASSERT private.recurring_date(DATE '2026-01-01', 'WEEKLY', 2, 3) = DATE '2026-02-12', 'every two weeks';

  -- A monthly retainer invoice.
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-06-01', DATE '2026-06-15', 'KES', 1, 'Monthly retainer', v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Bookkeeping retainer', 'accountId', v_sales, 'amountCents', 2500000, 'taxCents', 400000)), 'rec-src-1');
  v_template := public.save_recurring_template(v_org, NULL, v_invoice, 'INVOICE', NULL, 'MONTHLY', 1,
    v_today - 65, NULL, 3, 14, v_owner);
  ASSERT v_template->>'name' LIKE 'Acme, like INV-%', 'named after the customer and document';
  ASSERT (v_template->>'nextRunDate')::DATE = v_today - 65, 'first run on the start date';

  -- The daily run catches up the missed months: three, then the schedule ends.
  v_result := public.run_due_recurring();
  ASSERT (v_result->>'posted')::INTEGER = 3, format('three posted, got %s', v_result);
  ASSERT (SELECT count(*) FROM public.invoices WHERE customer_id = v_customer AND notes = 'Monthly retainer') = 4, 'three new invoices';
  ASSERT (SELECT status FROM public.recurring_templates WHERE id = (v_template->>'id')::UUID) = 'ENDED', 'ended after three';
  ASSERT (SELECT total_cents FROM public.invoices i JOIN public.recurring_runs r ON r.document_id = i.id
          WHERE r.template_id = (v_template->>'id')::UUID AND r.occurrence = 2) = 2900000, 'same amount with VAT';
  ASSERT (SELECT i.due_date - i.date FROM public.invoices i JOIN public.recurring_runs r ON r.document_id = i.id
          WHERE r.template_id = (v_template->>'id')::UUID AND r.occurrence = 1) = 14, 'due after the terms';
  ASSERT (public.run_due_recurring()->>'posted')::INTEGER = 0, 'nothing more to post';
  v_failed := false;
  BEGIN
    PERFORM public.run_recurring_template(v_org, (v_template->>'id')::UUID, NULL, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%has ended%';
  END;
  ASSERT v_failed, 'an ended schedule does not run';

  -- A quarterly bill, run by hand today, then paused.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-06-01', DATE '2026-06-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Office rent', 'accountId', v_opex, 'amountCents', 6000000)), 'rec-src-2', 'RENT-Q2');
  v_bill_template := public.save_recurring_template(v_org, NULL, v_bill, 'BILL', 'Office rent', 'QUARTERLY', 1,
    v_today + 10, NULL, NULL, 30, v_owner);
  v_result := public.run_recurring_template(v_org, (v_bill_template->>'id')::UUID, v_today, v_owner);
  ASSERT (v_result->>'documentDate')::DATE = v_today, 'dated today when run by hand';
  ASSERT (v_result->>'nextRunDate')::DATE = private.recurring_date(v_today + 10, 'QUARTERLY', 1, 1), 'next quarter';
  ASSERT (SELECT supplier_reference IS NULL FROM public.bills WHERE id = (v_result->>'documentId')::UUID), 'the supplier''s number is not copied';
  ASSERT (public.set_recurring_status(v_org, (v_bill_template->>'id')::UUID, 'PAUSED', v_owner))->>'status' = 'PAUSED', 'paused';
  UPDATE public.recurring_templates SET next_run_date = v_today - 1 WHERE id = (v_bill_template->>'id')::UUID;
  ASSERT (public.run_due_recurring()->>'posted')::INTEGER = 0, 'a paused schedule waits';

  -- A failure is recorded and the schedule keeps its place.
  PERFORM public.set_recurring_status(v_org, (v_bill_template->>'id')::UUID, 'ACTIVE', v_owner);
  UPDATE public.organizations SET books_closed_through = v_today WHERE id = v_org;
  v_result := public.run_due_recurring();
  ASSERT (v_result->>'failed')::INTEGER = 1, 'one failed';
  ASSERT (SELECT last_error LIKE '%books are closed%' FROM public.recurring_templates WHERE id = (v_bill_template->>'id')::UUID), 'why is recorded';
  ASSERT (SELECT next_run_date FROM public.recurring_templates WHERE id = (v_bill_template->>'id')::UUID) = v_today - 1, 'still due';
  UPDATE public.organizations SET books_closed_through = NULL WHERE id = v_org;

  -- Changing the schedule; a foreign-currency document is refused.
  v_result := public.save_recurring_template(v_org, (v_bill_template->>'id')::UUID, NULL, NULL, 'Rent, monthly', 'MONTHLY', 1,
    v_today + 10, NULL, NULL, 15, v_owner);
  ASSERT (SELECT frequency || ' ' || days_until_due FROM public.recurring_templates WHERE id = (v_bill_template->>'id')::UUID) = 'MONTHLY 15', 'schedule changed';
  v_failed := false;
  BEGIN
    PERFORM public.save_recurring_template(v_org, NULL,
      public.create_invoice_with_journal(v_org, v_customer, DATE '2026-06-01', DATE '2026-06-15', 'USD', 0.01, NULL, v_owner,
        jsonb_build_array(jsonb_build_object('description', 'Export', 'accountId', v_sales, 'amountCents', 13000, 'foreignAmountCents', 130)), 'rec-usd'),
      'INVOICE', NULL, 'MONTHLY', 1, v_today, NULL, NULL, 30, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%are in KES%';
  END;
  ASSERT v_failed, 'base currency only';

  RAISE NOTICE 'ALL RECURRING SQL TESTS PASSED';
END $$;
SELECT 'ALL RECURRING SQL TESTS PASSED';
