\c lltest
-- The VAT summary counts every document that carries VAT, standard-rated
-- and zero-rated lines apart, credits taken off, voids left out.
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
  v_invoice UUID;
  v_void UUID;
  v_bill UUID;
  v_row RECORD;
BEGIN
  -- An invoice with a standard-rated line and a zero-rated one.
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-02', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(
      jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 100000, 'taxCents', 16000),
      jsonb_build_object('description', 'Maize flour (zero-rated)', 'accountId', v_sales, 'amountCents', 20000, 'taxCents', 0)),
    'vat-inv-1');
  -- One voided: left out.
  v_void := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-09-03', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Mistake', 'accountId', v_sales, 'amountCents', 50000, 'taxCents', 8000)), 'vat-inv-2');
  PERFORM public.void_invoice_with_reversal(v_org, v_void, DATE '2026-09-04', v_owner);
  -- A cash sale with VAT, and a credit note with VAT.
  PERFORM public.record_sales_receipt(v_org, NULL, 'Walk-in', DATE '2026-09-05', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Nails', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 10000, 'taxRate', 16)), v_owner, 'vat-sr-1');
  PERFORM public.issue_credit_note(v_org, v_customer, v_invoice, DATE '2026-09-06', NULL,
    jsonb_build_array(jsonb_build_object('description', 'Price agreed down', 'accountId', v_sales, 'quantity', 1, 'unitPriceCents', 5000, 'taxRate', 16)), v_owner, 'vat-cn-1');
  -- A bill, an expense and a supplier credit, all with VAT; an expense without.
  v_bill := public.create_bill_with_journal(v_org, v_vendor, DATE '2026-09-07', DATE '2026-09-30', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Power', 'accountId', v_opex, 'amountCents', 40000, 'taxCents', 6400)), 'vat-bill-1', 'KP-9');
  PERFORM public.record_expense(v_org, NULL, 'Hardware shop', DATE '2026-09-08', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Paint', 'accountId', v_opex, 'amountCents', 10000, 'taxCents', 1600)), v_owner, 'vat-exp-1');
  PERFORM public.record_expense(v_org, NULL, 'Matatu', DATE '2026-09-08', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Fare', 'accountId', v_opex, 'amountCents', 2000)), v_owner, 'vat-exp-2');
  PERFORM public.record_supplier_credit(v_org, v_vendor, v_bill, DATE '2026-09-09', NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Overcharge', 'accountId', v_opex, 'amountCents', 5000, 'taxCents', 800)), v_owner, 'vat-sc-1');

  SELECT sum(taxable_cents) AS taxable, sum(untaxed_cents) AS untaxed, sum(tax_cents) AS tax INTO v_row
  FROM public.vat_summary(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE side = 'OUTPUT';
  ASSERT v_row.taxable = 100000 + 10000 - 5000, format('standard-rated sales %s', v_row.taxable);
  ASSERT v_row.untaxed = 20000, format('zero-rated sales %s', v_row.untaxed);
  ASSERT v_row.tax = 16000 + 1600 - 800, format('output VAT %s', v_row.tax);

  SELECT sum(taxable_cents) AS taxable, sum(untaxed_cents) AS untaxed, sum(tax_cents) AS tax INTO v_row
  FROM public.vat_summary(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE side = 'INPUT';
  ASSERT v_row.taxable = 40000 + 10000 - 5000, format('claimable purchases %s', v_row.taxable);
  ASSERT v_row.untaxed = 2000, format('purchases without VAT %s', v_row.untaxed);
  ASSERT v_row.tax = 6400 + 1600 - 800, format('input VAT %s', v_row.tax);

  -- The output and input VAT agree with what the VAT accounts moved, voids and all.
  ASSERT (SELECT sum(tax_cents) FROM public.vat_summary(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE side = 'OUTPUT')
    = (SELECT sum(l.credit - l.debit) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = v_org AND a.code = '2100'),
    'output VAT agrees with account 2100';
  ASSERT (SELECT sum(tax_cents) FROM public.vat_summary(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE side = 'INPUT')
    = (SELECT sum(l.debit - l.credit) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = v_org AND a.code = '1150'),
    'input VAT agrees with account 1150';
  ASSERT (SELECT documents FROM public.vat_summary(v_org, DATE '2026-09-01', DATE '2026-09-30') WHERE source = 'EXPENSE') = 2, 'two expenses';

  RAISE NOTICE 'ALL VAT SQL TESTS PASSED';
END $$;
SELECT 'ALL VAT SQL TESTS PASSED';
