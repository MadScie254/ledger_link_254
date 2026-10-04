\c lltest
-- Statements and sales and spending reports agree with the documents.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_cement UUID := '00000000-0000-0000-0000-0000000000e1';
  v_invoice UUID;
  v_invoice2 UUID;
  v_bill UUID;
  v_payment JSONB;
  v_row RECORD;
  v_closing BIGINT;
BEGIN
  -- August: an invoice of 1,160 (with VAT), part paid.
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-08-10', DATE '2026-09-09', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 100000, 'taxCents', 16000,
      'inventoryItemId', v_cement, 'quantity', 2)), 'rep-inv-1');
  PERFORM public.receive_invoice_payment(v_org, v_invoice, 60000, DATE '2026-08-20', v_bank, 'rep-pay-1', v_owner);
  -- September: another invoice, a credit note, a cash sale, a refund reversed.
  v_invoice2 := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-05', DATE '2026-10-05', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Delivery', 'accountId', v_sales, 'amountCents', 30000)), 'rep-inv-2');
  PERFORM public.issue_credit_note(v_org, v_customer, v_invoice2, DATE '2026-09-06', NULL,
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg returned', 'accountId', v_sales, 'inventoryItemId', v_cement,
      'quantity', 1, 'unitPriceCents', 10000, 'taxRate', 0)), v_owner, 'rep-cn-1');
  PERFORM public.record_sales_receipt(v_org, v_customer, NULL, DATE '2026-09-07', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'inventoryItemId', v_cement,
      'quantity', 1, 'unitPriceCents', 75000, 'taxRate', 0)), v_owner, 'rep-sr-1');
  PERFORM public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-08', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Nails', 'accountId', v_sales, 'quantity', 3, 'unitPriceCents', 500, 'taxRate', 0)), v_owner, 'rep-sr-2');

  -- The statement for September opens with August's balance and closes on what is owed.
  SELECT amount_cents INTO v_row FROM public.party_statement(v_org, 'CUSTOMER', v_customer, DATE '2026-09-01', DATE '2026-09-30') WHERE kind = 'OPENING';
  ASSERT v_row.amount_cents = 116000 - 60000, format('opening balance %s', v_row.amount_cents);
  SELECT sum(amount_cents) INTO v_closing FROM public.party_statement(v_org, 'CUSTOMER', v_customer, DATE '2026-09-01', DATE '2026-09-30');
  ASSERT v_closing = (SELECT open_cents FROM public.party_balances(v_org) WHERE party_type = 'CUSTOMER' AND party_id = v_customer),
    format('closing %s agrees with the open balance', v_closing);
  ASSERT (SELECT count(*) FROM public.party_statement(v_org, 'CUSTOMER', v_customer, DATE '2026-09-01', DATE '2026-09-30') WHERE kind = 'LINE') = 2,
    'the invoice and the credit note; the cash sale never owed anything';

  -- Sales by customer, before VAT.
  SELECT * INTO v_row FROM public.sales_by_customer(v_org, DATE '2026-08-01', DATE '2026-09-30') WHERE customer_id = v_customer;
  ASSERT v_row.invoiced_cents = 130000 AND v_row.cash_sales_cents = 75000 AND v_row.credited_cents = 10000 AND v_row.net_cents = 195000,
    format('sales by customer %s', row_to_json(v_row));
  ASSERT (SELECT net_cents FROM public.sales_by_customer(v_org, DATE '2026-08-01', DATE '2026-09-30') WHERE customer_id IS NULL) = 1500, 'walk-in sales';
  ASSERT (SELECT net_cents FROM public.sales_by_customer(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE customer_id = v_customer) = 95000, 'September only';

  -- Sales by item: 2 bags invoiced + 1 sold - 1 returned.
  SELECT * INTO v_row FROM public.sales_by_item(v_org, DATE '2026-08-01', DATE '2026-09-30') WHERE item_id = v_cement;
  ASSERT v_row.quantity = 2 AND v_row.amount_cents = 100000 + 75000 - 10000, format('cement %s', row_to_json(v_row));
  ASSERT (SELECT amount_cents FROM public.sales_by_item(v_org, DATE '2026-08-01', DATE '2026-09-30') WHERE item_id IS NULL) = 30000 + 1500, 'lines without items';

  -- Spending by supplier: a bill, an expense, a supplier credit.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-09-02', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Power', 'accountId', v_opex, 'amountCents', 40000, 'taxCents', 6400)), 'rep-bill-1', 'KP-1');
  PERFORM public.record_expense(v_org, v_vendor, NULL, DATE '2026-09-03', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Tokens', 'accountId', v_opex, 'amountCents', 5000)), v_owner, 'rep-exp-1');
  PERFORM public.record_supplier_credit(v_org, v_vendor, v_bill, DATE '2026-09-04', NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Overcharge', 'accountId', v_opex, 'amountCents', 2000)), v_owner, 'rep-sc-1');
  SELECT * INTO v_row FROM public.expenses_by_supplier(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE vendor_id = v_vendor;
  ASSERT v_row.billed_cents = 40000 AND v_row.paid_now_cents = 5000 AND v_row.credited_cents = 2000 AND v_row.net_cents = 43000,
    format('spending %s', row_to_json(v_row));
  SELECT sum(amount_cents) INTO v_closing FROM public.party_statement(v_org, 'VENDOR', v_vendor, DATE '2026-09-01', DATE '2026-09-30');
  ASSERT v_closing = 46400 - 2000, format('supplier statement closes on what is owed: %s', v_closing);

  RAISE NOTICE 'ALL REPORT SQL TESTS PASSED';
END $$;
SELECT 'ALL REPORT SQL TESTS PASSED';
