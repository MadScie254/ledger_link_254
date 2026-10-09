-- Run after the full migration stack and tests/db/fixture.sql. The
-- transaction leaves the fixture unchanged.
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_vendor UUID := '00000000-0000-0000-0000-0000000000d1';
  v_bank UUID := '00000000-0000-0000-0000-00000000a000';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_opex UUID := '00000000-0000-0000-0000-00000000a600';
  v_invoice UUID;
  v_kes_invoice UUID;
  v_bill UUID;
  v_first JSONB;
  v_second JSONB;
  v_result JSONB;
  v_fx BIGINT;
BEGIN
  IF has_function_privilege('authenticated', 'public.receive_invoice_payment_at_rate(uuid,uuid,bigint,bigint,date,uuid,text,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.pay_bill_at_rate(uuid,uuid,bigint,bigint,date,uuid,text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Exchange-rate payment functions are not service-role-only.';
  END IF;

  -- USD 1,000 booked at KES 100 to the dollar (0.01 dollars a shilling).
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'USD', 0.01, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Export consultancy', 'accountId', v_sales, 'amountCents', 10000000, 'foreignAmountCents', 100000)), 'fx-inv-1');
  -- USD 400 received when the dollar buys KES 98: KES 39,200 against KES 40,000 booked, a loss of KES 800.
  v_first := public.receive_invoice_payment_at_rate(v_org, v_invoice, 40000, 3920000, DATE '2026-09-15', v_bank, 'fx-p1', v_owner);
  IF (v_first->>'realizedFxCents')::BIGINT <> -80000 OR v_first->>'status' <> 'PARTIALLY_PAID' OR (v_first->>'amountDueCents')::BIGINT <> 6000000 THEN
    RAISE EXCEPTION 'The first payment did not realize a KES 800 loss: %', v_first;
  END IF;
  BEGIN
    PERFORM public.receive_invoice_payment_at_rate(v_org, v_invoice, 60001, 6000000, DATE '2026-09-20', v_bank, 'fx-p2x', v_owner);
    RAISE EXCEPTION 'More dollars were settled than are owed.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- The other USD 600 at KES 103: KES 61,800 against KES 60,000 still booked, a gain of KES 1,800.
  v_second := public.receive_invoice_payment_at_rate(v_org, v_invoice, 60000, 6180000, DATE '2026-09-25', v_bank, 'fx-p2', v_owner);
  IF (v_second->>'realizedFxCents')::BIGINT <> 180000 OR v_second->>'status' <> 'PAID' OR (v_second->>'amountDueCents')::BIGINT <> 0 THEN
    RAISE EXCEPTION 'The second payment did not settle the invoice with a KES 1,800 gain: %', v_second;
  END IF;
  SELECT COALESCE(sum(line.credit - line.debit), 0) INTO v_fx FROM public.journal_lines AS line
  JOIN public.accounts AS account ON account.id = line.account_id WHERE account.org_id = v_org AND account.code = '8100';
  IF v_fx <> 100000 THEN
    RAISE EXCEPTION 'Realized exchange gain is %, not KES 1,000.', v_fx;
  END IF;
  IF (SELECT sum(foreign_credit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE account.org_id = v_org AND account.code = '1100' AND line.journal_entry_id IN ((v_first->>'journalEntryId')::UUID, (v_second->>'journalEntryId')::UUID)) <> 100000 THEN
    RAISE EXCEPTION 'The receivable did not clear USD 1,000.';
  END IF;
  -- Retried, the same payment comes back.
  IF public.receive_invoice_payment_at_rate(v_org, v_invoice, 60000, 6180000, DATE '2026-09-25', v_bank, 'fx-p2', v_owner)->>'paymentId' <> v_second->>'paymentId' THEN
    RAISE EXCEPTION 'A retried payment posted twice.';
  END IF;

  -- Reversed, the gain goes back with the payment and the invoice is owed USD 600 at its booked rate.
  PERFORM public.reverse_invoice_payment(v_org, (v_second->>'paymentId')::UUID, DATE '2026-09-26', 'Paid in error', v_owner);
  IF (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) <> 6000000 THEN
    RAISE EXCEPTION 'The reversed payment did not reopen the invoice at its booked rate.';
  END IF;
  SELECT COALESCE(sum(line.credit - line.debit), 0) INTO v_fx FROM public.journal_lines AS line
  JOIN public.accounts AS account ON account.id = line.account_id WHERE account.org_id = v_org AND account.code = '8100';
  IF v_fx <> -80000 THEN
    RAISE EXCEPTION 'After the reversal the exchange result is %, not the KES 800 loss.', v_fx;
  END IF;

  -- A shilling invoice is paid the usual way.
  v_kes_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 50000)), 'fx-inv-kes');
  BEGIN
    PERFORM public.receive_invoice_payment_at_rate(v_org, v_kes_invoice, 50000, 50000, DATE '2026-09-15', v_bank, 'fx-kes', v_owner);
    RAISE EXCEPTION 'A shilling invoice was paid at a rate.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- A USD 500 bill booked at KES 100, paid when the dollar costs KES 102: a KES 1,000 loss.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-09-02', DATE '2026-09-30', 'USD', 0.01, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Software licence', 'accountId', v_opex, 'amountCents', 5000000, 'foreignAmountCents', 50000)), 'fx-bill-1');
  v_result := public.pay_bill_at_rate(v_org, v_bill, 50000, 5100000, DATE '2026-09-20', v_bank, 'fx-b1', v_owner);
  IF (v_result->>'realizedFxCents')::BIGINT <> -100000 OR v_result->>'status' <> 'PAID' THEN
    RAISE EXCEPTION 'The bill did not realize a KES 1,000 loss: %', v_result;
  END IF;
  SELECT COALESCE(sum(line.credit - line.debit), 0) INTO v_fx FROM public.journal_lines AS line
  JOIN public.accounts AS account ON account.id = line.account_id WHERE account.org_id = v_org AND account.code = '8100';
  IF v_fx <> -180000 THEN
    RAISE EXCEPTION 'The exchange result is %, not the KES 1,800 of losses.', v_fx;
  END IF;

  IF (SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = v_org) <> 0 THEN
    RAISE EXCEPTION 'The ledger does not balance.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'ALL REALIZED FX SQL TESTS PASSED';
