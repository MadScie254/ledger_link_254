\c lltest
-- Purchase orders: writing, billing in part and in full, stock received,
-- closing, and a voided bill putting its quantities back.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_ap UUID := '00000000-0000-0000-0000-00000000a200';
  v_cement UUID := '00000000-0000-0000-0000-0000000000e1';
  v_stock_asset UUID := gen_random_uuid();
  v_po JSONB;
  v_po2 JSONB;
  v_bill JSONB;
  v_bill2 JSONB;
  v_failed BOOLEAN;
  v_check RECORD;
BEGIN
  INSERT INTO public.accounts (id, org_id, code, name, type) VALUES (v_stock_asset, v_org, '1200', 'Inventory asset', 'ASSET');

  -- 10 bags at 720 + 16% VAT, and a delivery charge.
  v_po := public.save_purchase_order(v_org, NULL, v_vendor, DATE '2026-09-01', DATE '2026-09-10', 'Deliver to the yard',
    jsonb_build_array(
      jsonb_build_object('description', 'Cement 50kg', 'accountId', v_stock_asset, 'inventoryItemId', v_cement,
        'quantity', 10, 'unitCostCents', 72000, 'taxRate', 16),
      jsonb_build_object('description', 'Delivery', 'accountId', v_opex, 'quantity', 1, 'unitCostCents', 5000)),
    v_owner, 'po-1');
  ASSERT v_po->>'number' = 'PO-2026-00001', 'order number';
  ASSERT (v_po->>'totalCents')::BIGINT = 720000 + 115200 + 5000, 'order total with VAT';
  ASSERT NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE source_id = (v_po->>'id')::UUID), 'an order posts nothing';
  ASSERT (public.save_purchase_order(v_org, NULL, v_vendor, DATE '2026-09-01', NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_opex, 'quantity', 1, 'unitCostCents', 1)), v_owner, 'po-1'))->>'id'
    = v_po->>'id', 'retry returns the same order';

  -- Not into receivables, not half a bag.
  v_failed := false;
  BEGIN
    PERFORM public.save_purchase_order(v_org, NULL, v_vendor, DATE '2026-09-01', NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', '00000000-0000-0000-0000-00000000a110', 'quantity', 1, 'unitCostCents', 100)), v_owner, 'po-bad');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%not purchase lines%';
  END;
  ASSERT v_failed, 'receivables are not a purchase line';
  v_failed := false;
  BEGIN
    PERFORM public.save_purchase_order(v_org, NULL, v_vendor, DATE '2026-09-01', NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_stock_asset, 'inventoryItemId', v_cement, 'quantity', 0.5, 'unitCostCents', 100)), v_owner, 'po-half');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%whole units%';
  END;
  ASSERT v_failed, 'stock in whole units';

  -- Rewriting while nothing is billed.
  v_po := public.save_purchase_order(v_org, (v_po->>'id')::UUID, v_vendor, DATE '2026-09-01', DATE '2026-09-12', 'Deliver to the yard',
    jsonb_build_array(
      jsonb_build_object('description', 'Cement 50kg', 'accountId', v_stock_asset, 'inventoryItemId', v_cement,
        'quantity', 10, 'unitCostCents', 72000, 'taxRate', 16),
      jsonb_build_object('description', 'Delivery', 'accountId', v_opex, 'quantity', 1, 'unitCostCents', 6000)),
    v_owner, NULL);
  ASSERT (SELECT amount_cents FROM public.purchase_order_lines WHERE purchase_order_id = (v_po->>'id')::UUID AND line_position = 2) = 6000, 'rewritten';

  -- 4 bags arrive with the first bill.
  v_bill := public.bill_purchase_order(v_org, (v_po->>'id')::UUID, DATE '2026-09-05', DATE '2026-10-05', 'KP-778',
    jsonb_build_array(jsonb_build_object('position', 1, 'quantity', 4)), v_owner, 'pob-1');
  ASSERT v_bill->>'status' = 'OPEN', 'partly billed';
  ASSERT (SELECT total_cents FROM public.bills WHERE id = (v_bill->>'billId')::UUID) = 288000 + 46080, 'bill for 4 bags with VAT';
  ASSERT (SELECT purchase_order_id FROM public.bills WHERE id = (v_bill->>'billId')::UUID) = (v_po->>'id')::UUID, 'bill linked';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 9, 'four bags counted in';
  ASSERT (SELECT quantity_billed FROM public.purchase_order_lines WHERE purchase_order_id = (v_po->>'id')::UUID AND line_position = 1) = 4, 'four billed';
  ASSERT (public.bill_purchase_order(v_org, (v_po->>'id')::UUID, DATE '2026-09-05', DATE '2026-10-05', 'KP-778',
    jsonb_build_array(jsonb_build_object('position', 1, 'quantity', 4)), v_owner, 'pob-1'))->>'billId' = v_bill->>'billId', 'retry bills once';
  v_failed := false;
  BEGIN
    PERFORM public.save_purchase_order(v_org, (v_po->>'id')::UUID, v_vendor, DATE '2026-09-01', NULL, NULL,
      jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_opex, 'quantity', 1, 'unitCostCents', 1)), v_owner, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%can no longer be changed%';
  END;
  ASSERT v_failed, 'a billed order is not rewritten';
  v_failed := false;
  BEGIN
    PERFORM public.bill_purchase_order(v_org, (v_po->>'id')::UUID, DATE '2026-09-06', DATE '2026-10-06', NULL,
      jsonb_build_array(jsonb_build_object('position', 1, 'quantity', 7)), v_owner, 'pob-over');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%left to bill%';
  END;
  ASSERT v_failed, 'not more than is left';

  -- The rest arrives: billed in full.
  v_bill2 := public.bill_purchase_order(v_org, (v_po->>'id')::UUID, DATE '2026-09-08', DATE '2026-10-08', 'KP-790', NULL, v_owner, 'pob-2');
  ASSERT v_bill2->>'status' = 'BILLED', 'billed in full';
  ASSERT (SELECT sum(subtotal_cents) FROM public.bills WHERE purchase_order_id = (v_po->>'id')::UUID) = 726000, 'bills add up to the order';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 15, 'all ten bags in';

  -- Voiding the second bill puts its quantities back and reopens the order.
  PERFORM public.void_bill_with_reversal(v_org, (v_bill2->>'billId')::UUID, DATE '2026-09-09', v_owner);
  ASSERT (SELECT status FROM public.purchase_orders WHERE id = (v_po->>'id')::UUID) = 'OPEN', 'order open again';
  ASSERT (SELECT quantity_billed FROM public.purchase_order_lines WHERE purchase_order_id = (v_po->>'id')::UUID AND line_position = 1) = 4, 'back to four billed';
  ASSERT (SELECT quantity_billed FROM public.purchase_order_lines WHERE purchase_order_id = (v_po->>'id')::UUID AND line_position = 2) = 0, 'delivery unbilled';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 9, 'six bags counted out again';

  -- Closing with the rest unbilled needs a reason; a closed order is reopened before billing.
  v_failed := false;
  BEGIN
    PERFORM public.set_purchase_order_status(v_org, (v_po->>'id')::UUID, 'CLOSED', '', v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%reason%';
  END;
  ASSERT v_failed, 'closing needs a reason';
  ASSERT (public.set_purchase_order_status(v_org, (v_po->>'id')::UUID, 'CLOSED', 'Supplier out of stock', v_owner))->>'status' = 'CLOSED', 'closed with the rest unbilled';
  v_failed := false;
  BEGIN
    PERFORM public.bill_purchase_order(v_org, (v_po->>'id')::UUID, DATE '2026-09-10', DATE '2026-10-10', NULL, NULL, v_owner, 'pob-3');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%reopen it%';
  END;
  ASSERT v_failed, 'a closed order is not billed';
  ASSERT (public.set_purchase_order_status(v_org, (v_po->>'id')::UUID, 'OPEN', NULL, v_owner))->>'status' = 'OPEN', 'reopened';

  -- An order nothing was billed from is cancelled, not closed.
  v_po2 := public.save_purchase_order(v_org, NULL, v_vendor, DATE '2026-09-02', NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Paper', 'accountId', v_opex, 'quantity', 5, 'unitCostCents', 50000)), v_owner, 'po-2');
  ASSERT (public.set_purchase_order_status(v_org, (v_po2->>'id')::UUID, 'CLOSED', 'Ordered elsewhere', v_owner))->>'status' = 'CANCELLED', 'cancelled';

  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ap_ledger_cents = v_check.open_bill_cents, 'payables agree';

  RAISE NOTICE 'ALL PURCHASE ORDER SQL TESTS PASSED';
END $$;
SELECT 'ALL PURCHASE ORDER SQL TESTS PASSED';
