-- Run after the full migration stack and tests/db/fixture.sql.
-- One payment across several invoices: shared oldest due first or as the
-- person says, the rest kept as credit, posted as one entry, reversed whole.
SET client_min_messages = warning;
DO $$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_other UUID;
  v_usd_bank UUID;
  v_a UUID;
  v_b UUID;
  v_c UUID;
  v_d UUID;
  v_usd UUID;
  v_theirs UUID;
  v_first JSONB;
  v_second JSONB;
  v_retry JSONB;
  v_entry UUID;
  v_credit UUID;
  v_line UUID;
  v_check RECORD;
  v_message TEXT;
BEGIN
  v_a := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-10', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 10000)), 'cp-a');
  v_b := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-02', DATE '2026-09-20', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Sand', 'accountId', v_sales, 'amountCents', 20000)), 'cp-b');
  v_c := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-03', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Ballast', 'accountId', v_sales, 'amountCents', 30000)), 'cp-c');
  v_usd := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-05', 'USD', 0.01, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Export', 'accountId', v_sales, 'amountCents', 13000, 'foreignAmountCents', 130)), 'cp-usd');

  -- Shared oldest due first: A and B in full, the rest to C; the foreign
  -- invoice, though due first, is paid on its own.
  v_first := public.receive_customer_payment(v_org, v_customer, DATE '2026-09-15', v_bank, 35000, NULL, 'QJK7XY', NULL, v_owner, 'cp-pay-1');
  ASSERT v_first->>'number' LIKE 'PMT-2026-%', format('numbered %s', v_first->>'number');
  ASSERT (v_first->>'appliedCents')::BIGINT = 35000 AND (v_first->>'creditCents')::BIGINT = 0, 'all of it applied';
  ASSERT (SELECT status || ' ' || amount_due_cents FROM public.invoices WHERE id = v_a) = 'PAID 0', 'A paid';
  ASSERT (SELECT status || ' ' || amount_due_cents FROM public.invoices WHERE id = v_b) = 'PAID 0', 'B paid';
  ASSERT (SELECT status || ' ' || amount_due_cents FROM public.invoices WHERE id = v_c) = 'PARTIALLY_PAID 25000', 'C part paid';
  ASSERT (SELECT amount_due_cents FROM public.invoices WHERE id = v_usd) = 13000, 'the foreign invoice is left alone';

  -- One entry: the bank debited once, receivables credited invoice by invoice.
  v_entry := (v_first->>'journalEntryId')::UUID;
  ASSERT (SELECT source_type || ' ' || reference_no FROM public.journal_entries WHERE id = v_entry) = 'CUSTOMER_PAYMENT ' || (v_first->>'number');
  ASSERT (SELECT count(*) FROM public.journal_lines WHERE journal_entry_id = v_entry AND account_id = v_bank AND debit = 35000) = 1, 'banked once';
  ASSERT (SELECT count(*) FROM public.journal_lines AS l JOIN public.accounts AS a ON a.id = l.account_id
          WHERE l.journal_entry_id = v_entry AND a.code = '1100' AND l.credit > 0) = 3, 'one receivable line per invoice';
  ASSERT (SELECT count(*) FROM public.invoice_payments WHERE customer_payment_id = (v_first->>'id')::UUID AND journal_entry_id = v_entry) = 3;

  -- A retry with the same key returns the same payment.
  v_retry := public.receive_customer_payment(v_org, v_customer, DATE '2026-09-15', v_bank, 35000, NULL, 'QJK7XY', NULL, v_owner, 'cp-pay-1');
  ASSERT v_retry->>'id' = v_first->>'id' AND (SELECT count(*) FROM public.customer_payments) = 1, 'posted once';

  -- As the person says, with the rest kept as credit.
  v_second := public.receive_customer_payment(v_org, v_customer, DATE '2026-09-16', v_bank, 40000,
    jsonb_build_array(jsonb_build_object('invoiceId', v_c, 'amountCents', 25000)), NULL, 'Paid ahead for October', v_owner, 'cp-pay-2');
  ASSERT (v_second->>'appliedCents')::BIGINT = 25000 AND (v_second->>'creditCents')::BIGINT = 15000, 'rest kept as credit';
  v_credit := (v_second->>'creditNoteId')::UUID;
  ASSERT (SELECT status || ' ' || remaining_cents || ' ' || number FROM public.credit_notes WHERE id = v_credit)
    = 'OPEN 15000 ' || (v_second->>'number'), 'an open credit under the payment''s number';
  ASSERT NOT EXISTS (SELECT 1 FROM public.credit_note_lines WHERE credit_note_id = v_credit), 'no lines: it is not a sale taken back';
  ASSERT (SELECT credited_cents FROM public.sales_by_customer(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE customer_id = v_customer) = 0,
    'sales are not lowered by money received';
  ASSERT NOT EXISTS (SELECT 1 FROM public.vat_summary(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE source = 'CREDIT_NOTE'), 'no VAT moves';
  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents, format('receivables agree: %s vs %s', v_check.ar_ledger_cents, v_check.open_invoice_cents);

  -- Money paid in advance, with nothing open: all of it credit.
  v_retry := public.receive_customer_payment(v_org, v_customer, DATE '2026-09-16', v_bank, 5000, '[]'::JSONB, NULL, NULL, v_owner, 'cp-pay-3');
  ASSERT (v_retry->>'creditCents')::BIGINT = 5000 AND (v_retry->>'appliedCents')::BIGINT = 0, 'a deposit is all credit';

  -- Refusals.
  INSERT INTO public.customers (org_id, display_name) VALUES (v_org, 'Other Ltd') RETURNING id INTO v_other;
  v_theirs := public.create_invoice_with_journal(v_org, v_other, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Nails', 'accountId', v_sales, 'amountCents', 1000)), 'cp-theirs');
  v_d := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-20', DATE '2026-10-20', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Paint', 'accountId', v_sales, 'amountCents', 10000)), 'cp-d');
  INSERT INTO public.accounts (org_id, code, name, type, currency, is_bank_account)
  VALUES (v_org, '1010', 'USD account', 'ASSET', 'USD', true) RETURNING id INTO v_usd_bank;

  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_bank, 1000,
      jsonb_build_array(jsonb_build_object('invoiceId', v_d, 'amountCents', 2000)), NULL, NULL, v_owner, 'cp-x1');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%more than the 1000 cents received%', format('more to invoices than received: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_bank, 30000,
      jsonb_build_array(jsonb_build_object('invoiceId', v_d, 'amountCents', 1000), jsonb_build_object('invoiceId', v_d, 'amountCents', 1000)),
      NULL, NULL, v_owner, 'cp-x2');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%appears twice%', format('an invoice twice: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_bank, 30000,
      jsonb_build_array(jsonb_build_object('invoiceId', v_d, 'amountCents', 10001)), NULL, NULL, v_owner, 'cp-x3');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%has 10000 cents due%', format('more than is due: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_bank, 30000,
      jsonb_build_array(jsonb_build_object('invoiceId', v_usd, 'amountCents', 1000)), NULL, NULL, v_owner, 'cp-x4');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%is in USD%', format('a foreign invoice: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-19', v_bank, 30000,
      jsonb_build_array(jsonb_build_object('invoiceId', v_d, 'amountCents', 1000)), NULL, NULL, v_owner, 'cp-x5');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%dated before invoice%', format('before the invoice: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_bank, 30000,
      jsonb_build_array(jsonb_build_object('invoiceId', v_theirs, 'amountCents', 1000)), NULL, NULL, v_owner, 'cp-x6');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%one of this customer''s%', format('another customer''s invoice: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_usd_bank, 1000, NULL, NULL, NULL, v_owner, 'cp-x7');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%received in KES%', format('a USD account: %s', v_message);
  BEGIN
    PERFORM public.receive_customer_payment(v_org, v_customer, DATE '2026-09-25', v_sales, 1000, NULL, NULL, NULL, v_owner, 'cp-x8');
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%bank, cash or M-Pesa account%', format('not a money account: %s', v_message);
  ASSERT (SELECT count(*) FROM public.customer_payments) = 3, 'nothing refused was posted';

  -- The credit pays a later invoice like any other credit.
  PERFORM public.apply_credit(v_org, v_credit, v_d, 10000, DATE '2026-09-21', v_owner, 'cp-apply');
  ASSERT (SELECT status FROM public.invoices WHERE id = v_d) = 'PAID', 'D paid from the credit';

  -- An invoice's share is not reversed alone, and the credit is not voided alone.
  BEGIN
    PERFORM public.reverse_invoice_payment(v_org, (SELECT id FROM public.invoice_payments WHERE invoice_id = v_a), DATE '2026-09-20', 'Bounced', v_owner);
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%came with payment ' || (v_first->>'number') || '%Reverse that payment instead%', format('share alone: %s', v_message);
  BEGIN
    PERFORM public.void_credit_note(v_org, v_credit, DATE '2026-09-20', 'Mistake', v_owner);
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%left over from a payment%', format('credit alone: %s', v_message);

  -- The second payment waits until the use of its credit is undone.
  BEGIN
    PERFORM public.reverse_customer_payment(v_org, (v_second->>'id')::UUID, DATE '2026-09-22', 'Cheque returned', v_owner);
    v_message := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_message := SQLERRM;
  END;
  ASSERT v_message LIKE '%has been applied or refunded%', format('used credit: %s', v_message);
  PERFORM public.reverse_credit_application(v_org, (SELECT id FROM public.credit_applications WHERE credit_note_id = v_credit),
    DATE '2026-09-22', 'Cheque returned', v_owner);
  v_retry := public.reverse_customer_payment(v_org, (v_second->>'id')::UUID, DATE '2026-09-22', 'Cheque returned', v_owner);
  ASSERT (SELECT amount_due_cents FROM public.invoices WHERE id = v_c) = 25000, 'C owed again';
  ASSERT (SELECT status || ' ' || remaining_cents FROM public.credit_notes WHERE id = v_credit) = 'VOID 0', 'its credit withdrawn';
  ASSERT (SELECT status FROM public.customer_payments WHERE id = (v_second->>'id')::UUID) = 'REVERSED';
  -- Asking twice returns the first reversal.
  ASSERT public.reverse_customer_payment(v_org, (v_second->>'id')::UUID, DATE '2026-09-23', 'Again', v_owner)->>'reversalJournalEntryId'
    = v_retry->>'reversalJournalEntryId', 'reversed once';

  -- The first payment, matched to its bank line, is reversed and the line freed.
  INSERT INTO public.bank_transactions (org_id, date, description, amount_cents, direction)
  VALUES (v_org, DATE '2026-09-15', 'MPESA QJK7XY ACME', 35000, 'IN') RETURNING id INTO v_line;
  PERFORM public.match_bank_transaction(v_org, v_line, NULL, v_entry, NULL, NULL, v_owner);
  ASSERT (SELECT status FROM public.bank_transactions WHERE id = v_line) = 'MATCHED', 'one deposit, one entry';
  PERFORM public.reverse_customer_payment(v_org, (v_first->>'id')::UUID, DATE '2026-09-24', 'Paid by the wrong customer', v_owner);
  ASSERT (SELECT string_agg(status || ' ' || amount_due_cents, ', ' ORDER BY invoice_number) FROM public.invoices WHERE id IN (v_a, v_b, v_c))
    = 'SENT 10000, SENT 20000, SENT 30000', 'all three owed in full again';
  ASSERT (SELECT status FROM public.bank_transactions WHERE id = v_line) = 'UNREVIEWED', 'the statement line can be matched again';
  ASSERT (SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE account_id = v_bank) = 5000, 'only the deposit is still in the bank';

  SELECT * INTO v_check FROM public.control_account_check(v_org);
  ASSERT v_check.ar_ledger_cents = v_check.open_invoice_cents, format('receivables still agree: %s vs %s', v_check.ar_ledger_cents, v_check.open_invoice_cents);

  RAISE NOTICE 'ALL CUSTOMER PAYMENT SQL TESTS PASSED';
END $$;
SELECT 'ALL CUSTOMER PAYMENT SQL TESTS PASSED';
