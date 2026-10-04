\c lltest
-- Credit notes, supplier credits and refunds: what each posts, applying to
-- invoices and bills, refunds, undoing, voiding and the control check.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_ar UUID := '00000000-0000-0000-0000-00000000a110';
  v_ap UUID := '00000000-0000-0000-0000-00000000a200';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_output_vat UUID := '00000000-0000-0000-0000-00000000a210';
  v_input_vat UUID := '00000000-0000-0000-0000-00000000a150';
  v_cement UUID := '00000000-0000-0000-0000-0000000000e1';
  v_stock_asset UUID := gen_random_uuid();
  v_other_customer UUID := gen_random_uuid();
  v_invoice UUID;
  v_invoice2 UUID;
  v_usd_invoice UUID;
  v_bill UUID;
  v_cn1 JSONB;
  v_cn2 JSONB;
  v_sc JSONB;
  v_refund JSONB;
  v_result JSONB;
  v_application UUID;
  v_failed BOOLEAN;
  v_check RECORD;
BEGIN
  INSERT INTO public.accounts (id, org_id, code, name, type) VALUES (v_stock_asset, v_org, '1200', 'Inventory asset', 'ASSET');
  INSERT INTO public.customers (id, org_id, display_name) VALUES (v_other_customer, v_org, 'Other');

  -- An invoice of 1,000.00 + 160.00 VAT.
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 100000, 'taxCents', 16000)), 'cn-inv-1');

  -- One bag returned against it: 750 + 16% VAT, applied to the invoice at once.
  v_cn1 := public.issue_credit_note(v_org, v_customer, v_invoice, DATE '2026-09-05', 'Bag split',
    jsonb_build_array(jsonb_build_object('description', 'Cement 50kg returned', 'accountId', v_sales,
      'inventoryItemId', v_cement, 'quantity', 1, 'unitPriceCents', 75000, 'taxRate', 16)),
    v_owner, 'cn-1');
  ASSERT v_cn1->>'number' = 'CN-2026-00001', 'credit note number';
  ASSERT (v_cn1->>'totalCents')::BIGINT = 87000 AND (v_cn1->>'appliedCents')::BIGINT = 87000, 'credit applied to the invoice';
  ASSERT (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) = 29000, 'invoice due lowered';
  ASSERT (SELECT status FROM public.invoices WHERE id = v_invoice) = 'PARTIALLY_PAID', 'invoice partly settled';
  ASSERT (SELECT status FROM public.credit_notes WHERE id = (v_cn1->>'id')::UUID) = 'CLOSED', 'credit fully used';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 6, 'returned bag back in stock';
  ASSERT (SELECT sum(debit) FROM public.journal_lines WHERE account_id = v_output_vat) = 12000, 'output VAT debited';
  ASSERT (SELECT sum(credit) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id
          WHERE l.account_id = v_ar AND e.source_type = 'CREDIT_NOTE') = 87000, 'receivables credited';
  ASSERT (public.issue_credit_note(v_org, v_customer, NULL, DATE '2026-09-05', NULL,
    jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 1)), v_owner, 'cn-1'))->>'id'
    = v_cn1->>'id', 'retry returns the same credit note';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents, 'receivables agree after an applied credit';

  -- Paying the rest in full counts the credit as already paid.
  PERFORM public.receive_invoice_payment(v_org, v_invoice, 29000, DATE '2026-09-06', v_bank, 'cn-pay-1', v_owner);
  ASSERT (SELECT status FROM public.invoices WHERE id = v_invoice) = 'PAID', 'invoice paid';
  ASSERT (SELECT foreign_amount_cents FROM public.invoice_payments WHERE invoice_id = v_invoice) = 29000, 'payment foreign amount net of the credit';

  -- An unused credit counts against the customer's balance.
  v_cn2 := public.issue_credit_note(v_org, v_customer, NULL, DATE '2026-09-07', 'Goodwill',
    jsonb_build_array(jsonb_build_object('description', 'Late delivery discount', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 50000)),
    v_owner, 'cn-2');
  ASSERT (v_cn2->>'appliedCents')::BIGINT = 0, 'nothing applied';
  ASSERT (SELECT open_cents FROM public.party_balances(v_org) WHERE party_id = v_customer) = -50000, 'customer is owed 500';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents, 'receivables agree with an unused credit';

  -- Applying: not more than is left, not to another customer's invoice, not to a foreign-currency invoice.
  v_invoice2 := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-08', DATE '2026-10-08', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Delivery', 'accountId', v_sales, 'amountCents', 40000)), 'cn-inv-2');
  v_failed := false;
  BEGIN
    PERFORM public.apply_credit(v_org, (v_cn2->>'id')::UUID, v_invoice2, 45000, DATE '2026-09-08', v_owner, 'ap-over');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%cents due%';
  END;
  ASSERT v_failed, 'no more than the invoice due';
  v_failed := false;
  BEGIN
    PERFORM public.apply_credit(v_org, (v_cn2->>'id')::UUID,
      public.create_invoice_with_journal(v_org, v_other_customer, DATE '2026-09-08', DATE '2026-10-08', 'KES', 1, NULL, v_owner,
        jsonb_build_array(jsonb_build_object('description', 'x', 'accountId', v_sales, 'amountCents', 1000)), 'cn-inv-other'),
      500, DATE '2026-09-08', v_owner, 'ap-other');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%different customer%';
  END;
  ASSERT v_failed, 'not another customer''s invoice';
  v_usd_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-08', DATE '2026-10-08', 'USD', 0.01, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Export', 'accountId', v_sales, 'amountCents', 13000, 'foreignAmountCents', 130)), 'cn-inv-usd');
  v_failed := false;
  BEGIN
    PERFORM public.apply_credit(v_org, (v_cn2->>'id')::UUID, v_usd_invoice, 1000, DATE '2026-09-08', v_owner, 'ap-usd');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%apply to documents in KES%';
  END;
  ASSERT v_failed, 'credits apply in the base currency only';
  v_failed := false;
  BEGIN
    PERFORM public.apply_credit(v_org, (v_cn2->>'id')::UUID, v_invoice2, 1000, DATE '2026-09-01', v_owner, 'ap-early');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%on or after its own date%';
  END;
  ASSERT v_failed, 'not before the credit';

  v_result := public.apply_credit(v_org, (v_cn2->>'id')::UUID, v_invoice2, 30000, DATE '2026-09-08', v_owner, 'ap-1');
  v_application := (v_result->>'applicationId')::UUID;
  ASSERT (v_result->>'remainingCents')::BIGINT = 20000, 'credit left';
  ASSERT (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice2) = 10000, 'invoice 2 due lowered';
  ASSERT (public.apply_credit(v_org, (v_cn2->>'id')::UUID, v_invoice2, 30000, DATE '2026-09-08', v_owner, 'ap-1'))->>'applicationId'
    = v_application::TEXT, 'retry applies once';

  -- Refund part of what is left from the bank.
  v_refund := public.refund_credit(v_org, (v_cn2->>'id')::UUID, 15000, DATE '2026-09-09', v_bank, 'MPESA QX1', v_owner, 'rf-1');
  ASSERT v_refund->>'number' = 'RF-2026-00001', 'refund number';
  ASSERT (v_refund->>'remainingCents')::BIGINT = 5000, 'credit left after refund';
  ASSERT (SELECT sum(credit) FROM public.journal_lines WHERE journal_entry_id = (v_refund->>'journalEntryId')::UUID AND account_id = v_bank) = 15000, 'bank credited';
  ASSERT (SELECT sum(debit) FROM public.journal_lines WHERE journal_entry_id = (v_refund->>'journalEntryId')::UUID AND account_id = v_ar) = 15000, 'receivables debited';
  v_failed := false;
  BEGIN
    PERFORM public.refund_credit(v_org, (v_cn2->>'id')::UUID, 6000, DATE '2026-09-09', v_bank, NULL, v_owner, 'rf-2');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%refund no more than that%';
  END;
  ASSERT v_failed, 'not more than is left';
  v_failed := false;
  BEGIN
    PERFORM public.refund_credit(v_org, (v_cn2->>'id')::UUID, 1000, DATE '2026-09-09', v_sales, NULL, v_owner, 'rf-3');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%bank, cash or M-Pesa%';
  END;
  ASSERT v_failed, 'refunds move through money accounts';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents, 'receivables agree after a refund';

  -- Undoing a refund needs a reason and puts the amount back on the credit.
  v_failed := false;
  BEGIN
    PERFORM public.reverse_credit_application(v_org, (v_refund->>'applicationId')::UUID, DATE '2026-09-10', '', v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%reason%';
  END;
  ASSERT v_failed, 'a reason is required';
  v_result := public.reverse_credit_application(v_org, (v_refund->>'applicationId')::UUID, DATE '2026-09-10', 'Paid to the wrong number', v_owner);
  ASSERT (v_result->>'remainingCents')::BIGINT = 20000, 'refund back on the credit';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id
          WHERE l.account_id = v_bank AND e.source_type IN ('CREDIT_REFUND', 'ADJUSTMENT') AND e.reference_no LIKE '%RF-2026-00001') = 0, 'bank back';

  -- Voiding: not while used; voiding an invoice releases credits applied to it.
  v_failed := false;
  BEGIN
    PERFORM public.void_credit_note(v_org, (v_cn2->>'id')::UUID, DATE '2026-09-10', 'Issued in error', v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%Undo those first%';
  END;
  ASSERT v_failed, 'a used credit is not voided';
  PERFORM public.void_invoice_with_reversal(v_org, v_invoice2, DATE '2026-09-10', v_owner);
  ASSERT (SELECT remaining_cents FROM public.credit_notes WHERE id = (v_cn2->>'id')::UUID) = 50000, 'void released the credit';
  ASSERT (SELECT reversed_at IS NOT NULL FROM public.credit_applications WHERE id = v_application), 'application marked released';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents, 'receivables agree after a void releases a credit';
  v_result := public.void_credit_note(v_org, (v_cn2->>'id')::UUID, DATE '2026-09-11', 'Issued in error', v_owner);
  ASSERT (SELECT status FROM public.credit_notes WHERE id = (v_cn2->>'id')::UUID) = 'VOID', 'credit voided';
  ASSERT NOT EXISTS (SELECT 1 FROM public.party_balances(v_org) WHERE party_id = v_customer AND open_cents < 0), 'no credit left on the customer';

  -- A supplier credit against a bill: one bag sent back, plus a refund of a service charge with VAT.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-09-02', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Supplies', 'accountId', v_opex, 'amountCents', 50000)), 'sc-bill-1', 'KPLC-1');
  v_sc := public.record_supplier_credit(v_org, v_vendor, v_bill, DATE '2026-09-04', 'KPLC-CR-9', NULL,
    jsonb_build_array(
      jsonb_build_object('description', 'Overcharge', 'accountId', v_opex, 'amountCents', 10000, 'taxCents', 1600),
      jsonb_build_object('description', 'Cement returned', 'accountId', v_stock_asset, 'amountCents', 5000,
        'inventoryItemId', v_cement, 'quantity', 1)),
    v_owner, 'sc-1');
  ASSERT v_sc->>'number' = 'SC-2026-00001', 'supplier credit number';
  ASSERT (v_sc->>'appliedCents')::BIGINT = 16600, 'applied to the bill';
  ASSERT (SELECT amount_due_cents FROM public.bills WHERE id = v_bill) = 33400, 'bill due lowered';
  ASSERT (SELECT sum(debit) FROM public.journal_lines WHERE journal_entry_id = (v_sc->>'journalEntryId')::UUID AND account_id = v_ap) = 16600, 'payables debited';
  ASSERT (SELECT sum(credit) FROM public.journal_lines WHERE journal_entry_id = (v_sc->>'journalEntryId')::UUID AND account_id = v_input_vat) = 1600, 'recoverable VAT credited';
  ASSERT (SELECT quantity_on_hand FROM public.inventory_items WHERE id = v_cement) = 5, 'bag sent back left stock';
  PERFORM public.pay_bill(v_org, v_bill, 33400, DATE '2026-09-05', v_bank, 'sc-pay-1', v_owner);
  ASSERT (SELECT status FROM public.bills WHERE id = v_bill) = 'PAID', 'bill paid';
  ASSERT (SELECT foreign_amount_cents FROM public.bill_payments WHERE bill_id = v_bill) = 33400, 'bill payment net of the credit';

  -- Undoing the application reopens the bill for that amount.
  SELECT id INTO v_application FROM public.credit_applications WHERE credit_note_id = (v_sc->>'id')::UUID;
  v_result := public.reverse_credit_application(v_org, v_application, NULL, 'Supplier withdrew the credit', v_owner);
  ASSERT (SELECT amount_due_cents FROM public.bills WHERE id = v_bill) = 16600, 'bill owes the credited amount again';
  ASSERT (SELECT status FROM public.bills WHERE id = v_bill) = 'PARTIALLY_PAID', 'bill partly paid';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ap_ledger_cents = v_check.open_bill_cents, 'payables agree with an unused supplier credit';

  -- Money back from the supplier.
  v_refund := public.refund_credit(v_org, (v_sc->>'id')::UUID, 16600, DATE '2026-09-12', v_bank, NULL, v_owner, 'rf-sc');
  ASSERT (SELECT sum(debit) FROM public.journal_lines WHERE journal_entry_id = (v_refund->>'journalEntryId')::UUID AND account_id = v_bank) = 16600, 'bank debited';
  ASSERT (SELECT status FROM public.credit_notes WHERE id = (v_sc->>'id')::UUID) = 'CLOSED', 'supplier credit used up';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents AND v_check.ap_ledger_cents = v_check.open_bill_cents, 'both control accounts agree';

  -- Rows recording a use of a credit are permanent outside the functions.
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'credit_applications_permanent'), 'applications are permanent';

  RAISE NOTICE 'ALL CREDIT NOTE SQL TESTS PASSED';
END $$;
SELECT 'ALL CREDIT NOTE SQL TESTS PASSED';
