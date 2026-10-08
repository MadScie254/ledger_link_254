-- The VAT position for a period from every document that carries VAT, line
-- by line, so a line with VAT counts as a standard-rated supply and one
-- without as zero-rated or exempt:
--
--   output   invoices and sales receipts, less credit notes
--   input    bills and expenses paid on the spot, less supplier credits
--
-- The VAT summary used to read invoices and bills only, so cash sales,
-- expenses and credits were left out of the return. Void documents are left
-- out, as before. Amounts are in the base currency.

CREATE OR REPLACE FUNCTION public.vat_summary(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (side TEXT, source TEXT, taxable_cents BIGINT, untaxed_cents BIGINT, tax_cents BIGINT, documents INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  WITH lines AS (
    SELECT 'OUTPUT' AS side, 'INVOICE' AS source, invoice.id AS document_id, line.amount_cents AS amount, line.tax_cents AS tax
    FROM public.invoice_lines AS line
    JOIN public.invoices AS invoice ON invoice.org_id = line.org_id AND invoice.id = line.invoice_id
    WHERE line.org_id = p_org_id AND invoice.status <> 'VOID' AND invoice.date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'OUTPUT', 'SALES_RECEIPT', txn.id, line.amount_cents, line.tax_cents
    FROM public.cash_transaction_lines AS line
    JOIN public.cash_transactions AS txn ON txn.org_id = line.org_id AND txn.id = line.cash_transaction_id
    WHERE line.org_id = p_org_id AND txn.kind = 'SALES_RECEIPT' AND txn.status = 'POSTED' AND txn.txn_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'OUTPUT', 'CREDIT_NOTE', credit.id, -line.amount_cents, -line.tax_cents
    FROM public.credit_note_lines AS line
    JOIN public.credit_notes AS credit ON credit.org_id = line.org_id AND credit.id = line.credit_note_id
    WHERE line.org_id = p_org_id AND credit.kind = 'CUSTOMER' AND credit.status <> 'VOID' AND credit.credit_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'INPUT', 'BILL', bill.id, line.amount_cents, line.tax_cents
    FROM public.bill_lines AS line
    JOIN public.bills AS bill ON bill.org_id = line.org_id AND bill.id = line.bill_id
    WHERE line.org_id = p_org_id AND bill.status <> 'VOID' AND bill.date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'INPUT', 'EXPENSE', txn.id, line.amount_cents, line.tax_cents
    FROM public.cash_transaction_lines AS line
    JOIN public.cash_transactions AS txn ON txn.org_id = line.org_id AND txn.id = line.cash_transaction_id
    WHERE line.org_id = p_org_id AND txn.kind = 'EXPENSE' AND txn.status = 'POSTED' AND txn.txn_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'INPUT', 'SUPPLIER_CREDIT', credit.id, -line.amount_cents, -line.tax_cents
    FROM public.credit_note_lines AS line
    JOIN public.credit_notes AS credit ON credit.org_id = line.org_id AND credit.id = line.credit_note_id
    WHERE line.org_id = p_org_id AND credit.kind = 'SUPPLIER' AND credit.status <> 'VOID' AND credit.credit_date BETWEEN p_from AND p_to
  )
  SELECT lines.side, lines.source,
         COALESCE(sum(lines.amount) FILTER (WHERE lines.tax <> 0), 0)::BIGINT,
         COALESCE(sum(lines.amount) FILTER (WHERE lines.tax = 0), 0)::BIGINT,
         COALESCE(sum(lines.tax), 0)::BIGINT,
         count(DISTINCT lines.document_id)::INTEGER
  FROM lines
  GROUP BY lines.side, lines.source;
$function$;

REVOKE ALL ON FUNCTION public.vat_summary(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vat_summary(UUID, DATE, DATE) TO service_role;

-- Rollback: drop public.vat_summary.
