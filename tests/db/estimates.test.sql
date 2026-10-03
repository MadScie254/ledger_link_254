\c lltest
-- Estimates: saved, edited, accepted, converted to an invoice once, and
-- converted again only after that invoice is voided.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_cement UUID := '00000000-0000-0000-0000-0000000000e1';
  v_saved JSONB;
  v_again JSONB;
  v_converted JSONB;
  v_id UUID;
  v_invoice RECORD;
  v_failed BOOLEAN;
  v_order JSONB;
BEGIN
  v_saved := public.save_estimate(v_org, NULL, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'Quote for site B', v_owner,
    jsonb_build_array(
      jsonb_build_object('description', 'Cement 50kg', 'accountId', v_sales, 'inventoryItemId', v_cement, 'quantity', 10, 'unitPriceCents', 75000, 'taxRate', 16),
      jsonb_build_object('description', 'Delivery', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 50000, 'taxRate', 0)
    ), 'est-key-1');
  v_id := (v_saved->>'id')::UUID;
  ASSERT v_saved->>'estimateNumber' = 'EST-2026-00001', 'first estimate number';
  ASSERT (v_saved->>'totalCents')::BIGINT = 750000 + 120000 + 50000, 'total with VAT';
  v_again := public.save_estimate(v_org, NULL, v_customer, DATE '2026-09-01', NULL, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 1)), 'est-key-1');
  ASSERT v_again->>'id' = v_id::TEXT, 'a retry returns the same estimate';
  ASSERT NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE source_id = v_id), 'an estimate posts nothing';

  -- Half a bag is refused; an expiry before the date is refused.
  v_failed := false;
  BEGIN
    PERFORM public.save_estimate(v_org, NULL, v_customer, DATE '2026-09-01', NULL, NULL, v_owner,
      jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'inventoryItemId', v_cement, 'quantity', 1.5, 'unitPriceCents', 75000)), 'est-key-2');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%whole number%';
  END;
  ASSERT v_failed, 'stock quantities are whole';

  -- Edited: one line now.
  PERFORM public.save_estimate(v_org, v_id, v_customer, DATE '2026-09-02', DATE '2026-10-02', 'Revised', v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg', 'accountId', v_sales, 'inventoryItemId', v_cement, 'quantity', 8, 'unitPriceCents', 75000, 'taxRate', 16)), NULL);
  ASSERT (SELECT count(*) FROM public.estimate_lines WHERE estimate_id = v_id) = 1, 'lines replaced';
  ASSERT (SELECT total_cents FROM public.estimates WHERE id = v_id) = 696000, 'total recomputed';

  PERFORM public.set_estimate_status(v_org, v_id, 'DECLINED', 'Too dear', v_owner);
  v_failed := false;
  BEGIN
    PERFORM public.convert_estimate(v_org, v_id, 'INVOICE', DATE '2026-09-05', DATE '2026-10-05', v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%declined%';
  END;
  ASSERT v_failed, 'a declined estimate is not converted';
  PERFORM public.set_estimate_status(v_org, v_id, 'ACCEPTED', NULL, v_owner);
  ASSERT (SELECT decline_reason FROM public.estimates WHERE id = v_id) IS NULL, 'reason cleared on accept';

  v_converted := public.convert_estimate(v_org, v_id, 'INVOICE', DATE '2026-09-05', DATE '2026-10-05', v_owner);
  SELECT * INTO v_invoice FROM public.invoices WHERE id = (v_converted->>'id')::UUID;
  ASSERT v_invoice.total_cents = 696000, 'invoice total equals the estimate';
  ASSERT (SELECT description FROM public.invoice_lines WHERE invoice_id = v_invoice.id) = 'Cement 50kg (8 x 750.00)', 'line reads quantity and price';
  ASSERT (SELECT status FROM public.estimates WHERE id = v_id) = 'CONVERTED', 'converted';
  ASSERT public.convert_estimate(v_org, v_id, 'INVOICE', DATE '2026-09-05', DATE '2026-10-05', v_owner)->>'id' = v_invoice.id::TEXT, 'converting twice returns the same invoice';

  v_failed := false;
  BEGIN
    PERFORM public.save_estimate(v_org, v_id, v_customer, DATE '2026-09-02', NULL, NULL, v_owner,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 1)), NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%converted%';
  END;
  ASSERT v_failed, 'a converted estimate is not edited';

  PERFORM public.void_invoice_with_reversal(v_org, v_invoice.id, DATE '2026-09-06', v_owner);
  v_converted := public.convert_estimate(v_org, v_id, 'INVOICE', DATE '2026-09-07', DATE '2026-10-07', v_owner);
  ASSERT v_converted->>'id' <> v_invoice.id::TEXT, 'converted again after its invoice was voided';

  -- To a sales order instead.
  v_saved := public.save_estimate(v_org, NULL, v_customer, DATE '2026-09-10', NULL, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg', 'accountId', v_sales, 'inventoryItemId', v_cement, 'quantity', 2, 'unitPriceCents', 75000)), 'est-key-3');
  v_order := public.convert_estimate(v_org, (v_saved->>'id')::UUID, 'SALES_ORDER', DATE '2026-09-11', NULL, v_owner);
  ASSERT v_order->>'number' LIKE 'SO-2026-%', 'became a sales order';
  ASSERT (SELECT count(*) FROM public.sales_order_lines WHERE order_id = (v_order->>'id')::UUID AND inventory_item_id = v_cement) = 1, 'order keeps the stock item';

  RAISE NOTICE 'ALL ESTIMATE SQL TESTS PASSED';
END $$;
SELECT 'ALL ESTIMATE SQL TESTS PASSED';
