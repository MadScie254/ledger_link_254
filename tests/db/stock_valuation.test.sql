\c lltest
\set ON_ERROR_STOP 1
-- Stock valuation (20261024000600): weighted average cost, one journal entry
-- per movement, and the Inventory account always equal to the items' value.
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_member UUID := '00000000-0000-0000-0000-000000000004';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_cement UUID := '00000000-0000-0000-0000-0000000000e1';
  v_inventory UUID;
  v_cogs UUID;
  v_equity UUID;
  v_started JSONB;
  v_bill UUID;
  v_receipt JSONB;
  v_order UUID;
  v_report JSONB;
  v_tiles UUID;
  v_failed BOOLEAN;
  v_value BIGINT;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE org_id = v_org AND source_type = 'STOCK_VALUE'),
    'nothing is valued before valuation is turned on';
  ASSERT (SELECT count(*) FROM public.inventory_movements WHERE org_id = v_org AND value_cents IS NOT NULL) = 0,
    'movements before valuation carry no value';

  -- Only an owner or admin turns it on.
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_member, 'member') ON CONFLICT DO NOTHING;
  v_failed := false;
  BEGIN PERFORM public.start_stock_valuation(v_org, DATE '2026-09-01', NULL, v_member);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  ASSERT v_failed, 'a member cannot turn on stock valuation';

  -- On from 1 September: 5 bags on hand at 500.00 each, the chart's missing
  -- Inventory, COGS and Opening Balance Equity accounts are created.
  UPDATE public.inventory_items SET cost_price_cents = 50000 WHERE id = v_cement;
  v_started := public.start_stock_valuation(v_org, DATE '2026-09-01', NULL, v_owner);
  ASSERT (v_started->>'valueCents')::BIGINT = 250000, 'opening stock valued at cost';
  SELECT id INTO v_inventory FROM public.accounts WHERE org_id = v_org AND code = '1200';
  SELECT id INTO v_cogs FROM public.accounts WHERE org_id = v_org AND code = '5000';
  SELECT id INTO v_equity FROM public.accounts WHERE org_id = v_org AND code = '3050';
  ASSERT v_inventory IS NOT NULL AND v_cogs IS NOT NULL AND v_equity IS NOT NULL, 'stock accounts created';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_inventory) = 250000, 'inventory debited';
  ASSERT (SELECT sum(credit) - sum(debit) FROM public.journal_lines WHERE account_id = v_equity) = 250000, 'opening balance equity credited';
  ASSERT (public.start_stock_valuation(v_org, DATE '2026-09-02', NULL, v_owner)->>'alreadyOn')::BOOLEAN, 'turning it on twice changes nothing';

  -- A bill for 5 bags at 600.00 posted to cost of sales: moved to Inventory.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-09-03', DATE '2026-10-03', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg', 'accountId', v_cogs,
      'amountCents', 300000, 'inventoryItemId', v_cement, 'quantity', 5)), 'sv-bill-1');
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 550000, 'value 5,500.00 for 10 bags';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_cogs) = 0, 'the purchase left cost of sales';
  ASSERT (SELECT entry_date FROM public.journal_entries WHERE source_type = 'STOCK_VALUE'
    AND source_id = (SELECT id FROM public.inventory_movements WHERE source_id = v_bill)) = DATE '2026-09-03', 'dated with the bill';

  -- Two bags sold for cash: cost of sales at the 550.00 average.
  v_receipt := public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-04', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg', 'accountId', v_sales,
      'inventoryItemId', v_cement, 'quantity', 2, 'unitPriceCents', 80000)), v_owner, 'sv-sr-1');
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_cogs) = 110000, 'cost of sales 1,100.00';
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 440000, '8 bags at 4,400.00';

  -- Voided: the same value comes back.
  PERFORM public.void_cash_transaction(v_org, (v_receipt->>'id')::UUID, DATE '2026-09-05', 'Rang up twice', v_owner);
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_cogs) = 0, 'cost of sales reversed';
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 550000, 'value restored';

  -- An order completed and reopened moves the same value out and back.
  v_order := (public.create_sales_order(v_org, v_customer, DATE '2026-09-06', NULL, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'inventoryItemId', v_cement,
      'quantity', 3, 'unitPriceCents', 80000)), 'sv-so-1')->>'id')::UUID;
  PERFORM public.set_sales_order_status(v_org, v_order, 'COMPLETED', NULL, v_owner);
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_cogs) = 165000, 'order cost 1,650.00';
  PERFORM public.set_sales_order_status(v_org, v_order, 'IN_PROGRESS', NULL, v_owner);
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_cogs) = 0, 'reopened order reversed';
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 550000, 'value back after reopening';

  -- A count one bag short writes off one bag at average cost.
  PERFORM public.adjust_stock(v_org, v_cement, 9, 'Count: one bag split', v_owner, 'sv-adj-1');
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_cogs) = 55000, 'shrinkage 550.00';

  -- One bag sent back to the supplier at its 600.00 cost, on the Inventory account.
  PERFORM public.record_supplier_credit(v_org, v_vendor, v_bill, DATE '2026-09-07', 'CR-1', NULL,
    jsonb_build_array(jsonb_build_object('description', 'Cement returned', 'accountId', v_inventory, 'amountCents', 60000,
      'inventoryItemId', v_cement, 'quantity', 1)), v_owner, 'sv-sc-1');
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 435000, '8 bags at 4,350.00';

  -- A customer returns one bag: back in at the 543.75 average.
  PERFORM public.issue_credit_note(v_org, v_customer, NULL, DATE '2026-09-08', 'Wrong size',
    jsonb_build_array(jsonb_build_object('description', 'Cement returned', 'accountId', v_sales,
      'inventoryItemId', v_cement, 'quantity', 1, 'unitPriceCents', 80000)), v_owner, 'sv-cn-1');
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 489375, '9 bags at 4,893.75';

  -- A new item with stock is valued at its cost price.
  INSERT INTO public.inventory_items (org_id, name, type, quantity_on_hand, cost_price_cents, unit_price_cents)
  VALUES (v_org, 'Tiles box', 'Physical Product', 3, 1000, 2000) RETURNING id INTO v_tiles;
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_tiles) = 3000, 'opening item valued';

  -- Selling every bag leaves nothing behind.
  PERFORM public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-09', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg', 'accountId', v_sales,
      'inventoryItemId', v_cement, 'quantity', 9, 'unitPriceCents', 80000)), v_owner, 'sv-sr-2');
  ASSERT (SELECT stock_value_cents FROM public.inventory_items WHERE id = v_cement) = 0, 'no value without stock';

  -- The books agree with the items throughout.
  v_report := public.stock_valuation(v_org);
  ASSERT (v_report->>'itemsValueCents')::BIGINT = 3000, 'items value 30.00';
  ASSERT (v_report->>'ledgerValueCents')::BIGINT = (v_report->>'itemsValueCents')::BIGINT, 'inventory account equals items value';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE org_id = v_org) = 0, 'every entry balances';

  -- The value cannot be edited by hand.
  v_failed := false;
  BEGIN UPDATE public.inventory_items SET stock_value_cents = 1 WHERE id = v_tiles;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  ASSERT v_failed, 'stock value is changed only by movements';

  RAISE NOTICE 'stock valuation passed';
END $test$;
ROLLBACK;
SELECT 'stock valuation passed';
