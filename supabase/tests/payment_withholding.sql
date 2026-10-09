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
  v_bill UUID;
  v_result JSONB;
  v_payment UUID;
  v_balance BIGINT;
BEGIN
  IF has_function_privilege('authenticated', 'public.receive_invoice_payment_withheld(uuid,uuid,bigint,bigint,bigint,text,text,date,uuid,text,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.pay_bill_withheld(uuid,uuid,bigint,bigint,bigint,text,text,date,uuid,text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Withholding payment functions are not service-role-only.';
  END IF;

  -- KES 100,000 plus 16,000 VAT. The customer withholds KES 5,000 income
  -- tax and KES 2,000 VAT and pays KES 109,000.
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-01', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Consultancy', 'accountId', v_sales, 'amountCents', 10000000, 'taxCents', 1600000)), 'wht-inv-1');
  BEGIN
    PERFORM public.receive_invoice_payment_withheld(v_org, v_invoice, 10900000, 500000, 200000, NULL, 'WVAT-1', DATE '2026-09-20', v_bank, 'wht-p0', v_owner);
    RAISE EXCEPTION 'Income tax withheld was taken with no certificate.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.receive_invoice_payment_withheld(v_org, v_invoice, 10000000, 0, 1700000, NULL, 'WVAT-1', DATE '2026-09-20', v_bank, 'wht-p0', v_owner);
    RAISE EXCEPTION 'More VAT was withheld than the invoice carries.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.receive_invoice_payment_withheld(v_org, v_invoice, 11000000, 500000, 200000, 'WHT-1', 'WVAT-1', DATE '2026-09-20', v_bank, 'wht-p0', v_owner);
    RAISE EXCEPTION 'A payment settled more than was due.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v_result := public.receive_invoice_payment_withheld(v_org, v_invoice, 10900000, 500000, 200000, 'WHT-1', 'WVAT-1', DATE '2026-09-20', v_bank, 'wht-p1', v_owner);
  IF v_result->>'status' <> 'PAID' OR (v_result->>'amountDueCents')::BIGINT <> 0 THEN
    RAISE EXCEPTION 'The invoice is not settled by cash and tax withheld: %', v_result;
  END IF;
  -- The same request again returns the same payment.
  IF public.receive_invoice_payment_withheld(v_org, v_invoice, 10900000, 500000, 200000, 'WHT-1', 'WVAT-1', DATE '2026-09-20', v_bank, 'wht-p1', v_owner)->>'paymentId'
     <> v_result->>'paymentId' THEN
    RAISE EXCEPTION 'A retried payment posted twice.';
  END IF;
  IF (SELECT sum(line.debit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND account.code = '1170') <> 500000
    OR (SELECT sum(line.debit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND account.code = '1175') <> 200000
    OR (SELECT sum(line.debit) FROM public.journal_lines AS line
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND line.account_id = v_bank) <> 10900000
    OR (SELECT sum(line.credit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND account.code = '1100') <> 11600000 THEN
    RAISE EXCEPTION 'The payment did not post cash, tax withheld and receivables as expected.';
  END IF;
  IF (SELECT type::TEXT || ':' || name FROM public.accounts WHERE org_id = v_org AND code = '1175') <> 'ASSET:VAT withheld by customers' THEN
    RAISE EXCEPTION 'The VAT withheld account was not made.';
  END IF;
  SELECT id INTO v_payment FROM public.invoice_payments WHERE invoice_id = v_invoice;
  IF (SELECT amount_cents || ':' || wht_cents || ':' || wvat_cents || ':' || wht_certificate_number || ':' || wvat_certificate_number
      FROM public.invoice_payments WHERE id = v_payment) <> '11600000:500000:200000:WHT-1:WVAT-1' THEN
    RAISE EXCEPTION 'The payment row does not keep what was withheld.';
  END IF;

  -- Reversed, the whole entry goes back, tax withheld included.
  PERFORM public.reverse_invoice_payment(v_org, v_payment, DATE '2026-09-21', 'Certificate was cancelled', v_owner);
  IF (SELECT amount_due_cents FROM public.invoices WHERE id = v_invoice) <> 11600000 THEN
    RAISE EXCEPTION 'The reversed payment did not reopen the invoice.';
  END IF;
  SELECT COALESCE(sum(line.debit - line.credit), 0) INTO v_balance FROM public.journal_lines AS line
  JOIN public.accounts AS account ON account.id = line.account_id WHERE account.org_id = v_org AND account.code IN ('1170', '1175');
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'Tax withheld is still on the books after the reversal: %', v_balance;
  END IF;

  -- A bill paid net: the business owes the tax it withheld to KRA.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-09-02', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Audit fees', 'accountId', v_opex, 'amountCents', 5000000, 'taxCents', 800000)), 'wht-bill-1');
  v_result := public.pay_bill_withheld(v_org, v_bill, 5450000, 250000, 100000, NULL, NULL, DATE '2026-09-25', v_bank, 'wht-b1', v_owner);
  IF v_result->>'status' <> 'PAID' THEN
    RAISE EXCEPTION 'The bill is not settled by the payment and the tax withheld.';
  END IF;
  IF (SELECT sum(line.credit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND account.code = '2150') <> 250000
    OR (SELECT sum(line.credit) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND account.code = '2155') <> 100000
    OR (SELECT type::TEXT FROM public.accounts WHERE org_id = v_org AND code = '2150') <> 'LIABILITY' THEN
    RAISE EXCEPTION 'The tax withheld from the supplier is not owed to KRA.';
  END IF;
  BEGIN
    PERFORM public.pay_bill_withheld(v_org, v_bill, 100, 0, 0, NULL, NULL, DATE '2026-09-25', v_bank, 'wht-b2', v_owner);
    RAISE EXCEPTION 'A paid bill took another payment.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.reverse_bill_payment(v_org, (SELECT id FROM public.bill_payments WHERE bill_id = v_bill), DATE '2026-09-26', 'Paid the wrong supplier', v_owner);
  IF (SELECT amount_due_cents FROM public.bills WHERE id = v_bill) <> 5800000 THEN
    RAISE EXCEPTION 'The reversed bill payment did not reopen the bill.';
  END IF;
  IF (SELECT COALESCE(sum(line.credit - line.debit), 0) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE account.org_id = v_org AND account.code IN ('2150', '2155')) <> 0 THEN
    RAISE EXCEPTION 'Tax owed to KRA stays after the bill payment was reversed.';
  END IF;

  -- The ledger still balances.
  IF (SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = v_org) <> 0 THEN
    RAISE EXCEPTION 'The ledger does not balance.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'ALL PAYMENT WITHHOLDING SQL TESTS PASSED';
