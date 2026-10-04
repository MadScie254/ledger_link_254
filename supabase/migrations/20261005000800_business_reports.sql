-- Reports added up in Postgres rather than in the Worker: a customer's or
-- supplier's statement, sales by customer and by item, and spending by
-- supplier. All are read-only and callable by the Worker's service role,
-- which checks the caller's membership of p_org_id first.

-- A customer's or supplier's account as the ledger holds it: every line
-- posted to receivables (1100) or payables (2000) for them, so invoices,
-- bills, payments, credits, refunds, voids and reversals all appear and the
-- closing balance is what the ledger says is owed. Amounts are positive
-- when they add to what is owed (by the customer, or to the supplier).
-- The first row (kind OPENING) carries the balance before p_from.
CREATE OR REPLACE FUNCTION public.party_statement(
  p_org_id UUID,
  p_party_type TEXT,
  p_party_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  kind TEXT, entry_date DATE, journal_entry_id UUID, source_type TEXT, source_id UUID,
  reference_no TEXT, memo TEXT, description TEXT, amount_cents BIGINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  WITH lines AS (
    SELECT entry.entry_date, entry.id AS entry_id, entry.source_type, entry.source_id, entry.reference_no,
           entry.memo, line.description, entry.posted_at, line.id AS line_id,
           (CASE WHEN p_party_type = 'CUSTOMER' THEN line.debit - line.credit ELSE line.credit - line.debit END)::BIGINT AS amount
    FROM public.journal_lines AS line
    JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
    JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
    WHERE line.org_id = p_org_id
      AND account.code = CASE WHEN p_party_type = 'CUSTOMER' THEN '1100' ELSE '2000' END
      AND line.entity_type = p_party_type AND line.entity_id = p_party_id
      AND entry.entry_date <= p_to
  )
  SELECT 'OPENING', p_from, NULL::UUID, NULL, NULL::UUID, NULL, NULL, NULL,
         COALESCE((SELECT sum(amount) FROM lines WHERE entry_date < p_from), 0)::BIGINT
  UNION ALL
  SELECT 'LINE', entry_date, entry_id, source_type, source_id, reference_no, memo, description, amount
  FROM (
    SELECT * FROM lines WHERE entry_date >= p_from ORDER BY entry_date, posted_at, line_id
  ) AS period;
$function$;

-- Sales in a period by customer, before VAT: invoices (not void), sales
-- receipts (not void) and credit notes (not void, taken off). Cash sales with
-- no customer are one row with no customer id.
CREATE OR REPLACE FUNCTION public.sales_by_customer(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (customer_id UUID, customer_name TEXT, invoiced_cents BIGINT, cash_sales_cents BIGINT, credited_cents BIGINT, net_cents BIGINT, documents INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT sales.customer_id, COALESCE(customer.display_name, 'Walk-in and unnamed cash sales'),
         sum(sales.invoiced)::BIGINT, sum(sales.cash)::BIGINT, sum(sales.credited)::BIGINT,
         sum(sales.invoiced + sales.cash - sales.credited)::BIGINT, count(*)::INTEGER
  FROM (
    SELECT invoice.customer_id, invoice.subtotal_cents AS invoiced, 0 AS cash, 0 AS credited
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.status <> 'VOID' AND invoice.date BETWEEN p_from AND p_to
    UNION ALL
    SELECT txn.customer_id, 0, txn.subtotal_cents, 0
    FROM public.cash_transactions AS txn
    WHERE txn.org_id = p_org_id AND txn.kind = 'SALES_RECEIPT' AND txn.status = 'POSTED' AND txn.txn_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT credit.customer_id, 0, 0, credit.subtotal_cents
    FROM public.credit_notes AS credit
    WHERE credit.org_id = p_org_id AND credit.kind = 'CUSTOMER' AND credit.status <> 'VOID' AND credit.credit_date BETWEEN p_from AND p_to
  ) AS sales
  LEFT JOIN public.customers AS customer ON customer.org_id = p_org_id AND customer.id = sales.customer_id
  GROUP BY sales.customer_id, customer.display_name
  ORDER BY sum(sales.invoiced + sales.cash - sales.credited) DESC, 2;
$function$;

-- Sales in a period by stock item, before VAT, with quantities: invoice and
-- sales-receipt lines, less credit-note lines. Lines with no item are one row
-- with no item id.
CREATE OR REPLACE FUNCTION public.sales_by_item(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (item_id UUID, item_name TEXT, quantity NUMERIC, amount_cents BIGINT, lines INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT sold.item_id, COALESCE(item.name, 'Lines without a stock item'),
         sum(sold.quantity), sum(sold.amount)::BIGINT, count(*)::INTEGER
  FROM (
    SELECT line.inventory_item_id AS item_id, COALESCE(line.quantity, 0) AS quantity, line.amount_cents AS amount
    FROM public.invoice_lines AS line
    JOIN public.invoices AS invoice ON invoice.org_id = line.org_id AND invoice.id = line.invoice_id
    WHERE line.org_id = p_org_id AND invoice.status <> 'VOID' AND invoice.date BETWEEN p_from AND p_to
    UNION ALL
    SELECT line.inventory_item_id, COALESCE(line.quantity, 0), line.amount_cents
    FROM public.cash_transaction_lines AS line
    JOIN public.cash_transactions AS txn ON txn.org_id = line.org_id AND txn.id = line.cash_transaction_id
    WHERE line.org_id = p_org_id AND txn.kind = 'SALES_RECEIPT' AND txn.status = 'POSTED' AND txn.txn_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT line.inventory_item_id, -COALESCE(line.quantity, 0), -line.amount_cents
    FROM public.credit_note_lines AS line
    JOIN public.credit_notes AS credit ON credit.org_id = line.org_id AND credit.id = line.credit_note_id
    WHERE line.org_id = p_org_id AND credit.kind = 'CUSTOMER' AND credit.status <> 'VOID' AND credit.credit_date BETWEEN p_from AND p_to
  ) AS sold
  LEFT JOIN public.inventory_items AS item ON item.org_id = p_org_id AND item.id = sold.item_id
  GROUP BY sold.item_id, item.name
  ORDER BY sold.item_id IS NULL, sum(sold.amount) DESC, 2;
$function$;

-- Spending in a period by supplier, before VAT: bills (not void), expenses
-- paid on the spot (not void) and supplier credits (not void, taken off).
-- Expenses with no supplier record are one row with no vendor id.
CREATE OR REPLACE FUNCTION public.expenses_by_supplier(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (vendor_id UUID, vendor_name TEXT, billed_cents BIGINT, paid_now_cents BIGINT, credited_cents BIGINT, net_cents BIGINT, documents INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT spent.vendor_id, COALESCE(vendor.display_name, 'Other payees'),
         sum(spent.billed)::BIGINT, sum(spent.paid_now)::BIGINT, sum(spent.credited)::BIGINT,
         sum(spent.billed + spent.paid_now - spent.credited)::BIGINT, count(*)::INTEGER
  FROM (
    SELECT bill.vendor_id, bill.subtotal_cents AS billed, 0 AS paid_now, 0 AS credited
    FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.status <> 'VOID' AND bill.date BETWEEN p_from AND p_to
    UNION ALL
    SELECT txn.vendor_id, 0, txn.subtotal_cents, 0
    FROM public.cash_transactions AS txn
    WHERE txn.org_id = p_org_id AND txn.kind = 'EXPENSE' AND txn.status = 'POSTED' AND txn.txn_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT credit.vendor_id, 0, 0, credit.subtotal_cents
    FROM public.credit_notes AS credit
    WHERE credit.org_id = p_org_id AND credit.kind = 'SUPPLIER' AND credit.status <> 'VOID' AND credit.credit_date BETWEEN p_from AND p_to
  ) AS spent
  LEFT JOIN public.vendors AS vendor ON vendor.org_id = p_org_id AND vendor.id = spent.vendor_id
  GROUP BY spent.vendor_id, vendor.display_name
  ORDER BY sum(spent.billed + spent.paid_now - spent.credited) DESC, 2;
$function$;

-- Invoices keep the stock item and quantity of each line, as bills do, for
-- sales by item. Otherwise as in 20260917172909.
CREATE OR REPLACE FUNCTION public.create_invoice_with_journal(
  p_org_id UUID,
  p_customer_id UUID,
  p_issue_date DATE,
  p_due_date DATE,
  p_currency TEXT,
  p_exchange_rate NUMERIC,
  p_notes TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_base_currency TEXT;
  v_currency TEXT := upper(btrim(p_currency));
  v_line JSONB;
  v_position INTEGER := 0;
  v_account_id UUID;
  v_amount BIGINT;
  v_tax BIGINT;
  v_foreign_amount BIGINT;
  v_foreign_tax BIGINT;
  v_subtotal BIGINT := 0;
  v_tax_total BIGINT := 0;
  v_foreign_total BIGINT := 0;
  v_total BIGINT;
  v_ar_account_id UUID;
  v_vat_account_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_item_id UUID;
  v_quantity NUMERIC;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':invoice:' || p_idempotency_key, 0)
  );

  SELECT invoice.id INTO v_invoice_id
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id
    AND invoice.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_invoice_id;
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org
  WHERE org.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM public.customers AS customer
  WHERE customer.org_id = p_org_id AND customer.id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer does not belong to this organization.' USING ERRCODE = '23503';
  END IF;

  IF p_issue_date IS NULL OR p_due_date IS NULL OR p_due_date < p_issue_date THEN
    RAISE EXCEPTION 'Invoice dates are invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$'
     OR p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Invoice currency or exchange rate is invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_currency = v_base_currency AND p_exchange_rate <> 1 THEN
    RAISE EXCEPTION 'Base-currency invoices must use an exchange rate of 1.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'An invoice requires at least one line.' USING ERRCODE = '22023';
  END IF;

  SELECT account.id INTO v_ar_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '1100'
    AND account.type = 'ASSET' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Accounts Receivable account 1100 is required.' USING ERRCODE = '23503';
  END IF;

  SELECT account.id INTO v_vat_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '2100'
    AND account.type = 'LIABILITY' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Output VAT account 2100 is required.' USING ERRCODE = '23503';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;
    BEGIN
      v_account_id := (v_line->>'accountId')::UUID;
      v_amount := (v_line->>'amountCents')::BIGINT;
      v_tax := COALESCE((v_line->>'taxCents')::BIGINT, 0);
      v_foreign_amount := NULLIF(v_line->>'foreignAmountCents', '')::BIGINT;
      v_item_id := NULLIF(v_line->>'inventoryItemId', '')::UUID;
      v_quantity := NULLIF(v_line->>'quantity', '')::NUMERIC;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invoice line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;
    -- What was sold and how many, kept for sales-by-item; an invoice does not
    -- move stock (an order's completion or a sales receipt does).
    IF v_quantity IS NOT NULL AND (v_quantity <= 0 OR v_quantity > 1000000000) THEN
      RAISE EXCEPTION 'Invoice line % quantity must be greater than zero.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_item_id IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_items AS item WHERE item.org_id = p_org_id AND item.id = v_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice line %: the stock item is not in this organization.', v_position USING ERRCODE = '23503';
      END IF;
    END IF;

    IF NULLIF(btrim(v_line->>'description'), '') IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_tax < 0 THEN
      RAISE EXCEPTION 'Invoice line % requires a description and positive integer-cent amount.', v_position
        USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type = 'INCOME' AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice line % must use an active income account in this organization.', v_position
        USING ERRCODE = '23503';
    END IF;

    IF v_currency = v_base_currency THEN
      v_foreign_amount := COALESCE(v_foreign_amount, v_amount);
      IF v_foreign_amount <> v_amount THEN
        RAISE EXCEPTION 'Base and foreign amounts must match for a base-currency invoice.' USING ERRCODE = '22023';
      END IF;
      v_foreign_tax := v_tax;
    ELSE
      IF v_foreign_amount IS NULL OR v_foreign_amount <= 0
         OR abs(round(v_foreign_amount / p_exchange_rate)::BIGINT - v_amount) > 1 THEN
        RAISE EXCEPTION 'Invoice line % foreign amount does not match its booked exchange rate.', v_position
          USING ERRCODE = '22023';
      END IF;
      v_foreign_tax := round(v_tax * p_exchange_rate)::BIGINT;
    END IF;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;
    v_foreign_total := v_foreign_total + v_foreign_amount + v_foreign_tax;

    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_account_id,
      'debit', 0,
      'credit', v_amount,
      'description', NULLIF(btrim(v_line->>'description'), ''),
      'entityType', 'CUSTOMER',
      'entityId', p_customer_id,
      'currency', v_currency,
      'foreignDebit', 0,
      'foreignCredit', v_foreign_amount,
      'exchangeRate', p_exchange_rate
    ));
  END LOOP;

  v_total := v_subtotal + v_tax_total;
  v_invoice_id := gen_random_uuid();
  v_invoice_number := 'INV-' || to_char(p_issue_date, 'YYYY') || '-' ||
    lpad(private.next_document_number(p_org_id, 'INVOICE')::TEXT, 5, '0');

  INSERT INTO public.invoices (
    id, org_id, invoice_number, customer_id, date, due_date,
    subtotal_cents, tax_cents, total_cents, amount_due_cents, status,
    currency, exchange_rate, foreign_amount_cents, notes, created_by, idempotency_key
  ) VALUES (
    v_invoice_id, p_org_id, v_invoice_number, p_customer_id, p_issue_date, p_due_date,
    v_subtotal, v_tax_total, v_total, v_total, 'SENT',
    v_currency, p_exchange_rate, v_foreign_total, NULLIF(btrim(p_notes), ''),
    p_created_by, p_idempotency_key
  );

  v_position := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;
    v_amount := (v_line->>'amountCents')::BIGINT;
    v_tax := COALESCE((v_line->>'taxCents')::BIGINT, 0);
    v_foreign_amount := COALESCE(NULLIF(v_line->>'foreignAmountCents', '')::BIGINT, v_amount);
    v_foreign_tax := CASE WHEN v_currency = v_base_currency
      THEN v_tax ELSE round(v_tax * p_exchange_rate)::BIGINT END;

    INSERT INTO public.invoice_lines (
      org_id, invoice_id, description, account_id, amount_cents, tax_cents,
      foreign_amount_cents, foreign_tax_cents, line_position, inventory_item_id, quantity
    ) VALUES (
      p_org_id, v_invoice_id, btrim(v_line->>'description'),
      (v_line->>'accountId')::UUID, v_amount, v_tax,
      v_foreign_amount, v_foreign_tax, v_position, v_item_id, v_quantity
    );
  END LOOP;

  v_journal_lines := jsonb_build_array(jsonb_build_object(
    'accountId', v_ar_account_id,
    'debit', v_total,
    'credit', 0,
    'description', 'Accounts receivable — ' || v_invoice_number,
    'entityType', 'CUSTOMER',
    'entityId', p_customer_id,
    'currency', v_currency,
    'foreignDebit', v_foreign_total,
    'foreignCredit', 0,
    'exchangeRate', p_exchange_rate
  )) || v_journal_lines;

  IF v_tax_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_vat_account_id,
      'debit', 0,
      'credit', v_tax_total,
      'description', 'Output VAT — ' || v_invoice_number,
      'entityType', 'CUSTOMER',
      'entityId', p_customer_id,
      'currency', v_currency,
      'foreignDebit', 0,
      'foreignCredit', CASE WHEN v_currency = v_base_currency THEN v_tax_total
        ELSE round(v_tax_total * p_exchange_rate)::BIGINT END,
      'exchangeRate', p_exchange_rate
    ));
  END IF;

  PERFORM private.insert_journal_entry(
    p_org_id, p_issue_date, 'Invoice ' || v_invoice_number, 'INVOICE', v_invoice_id,
    v_invoice_number, p_created_by, v_journal_lines,
    'invoice-post:' || p_idempotency_key
  );

  UPDATE public.customers
  SET balance = COALESCE(balance, 0) + v_total
  WHERE org_id = p_org_id AND id = p_customer_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'CREATE', 'INVOICE', v_invoice_id,
    jsonb_build_object('invoiceNumber', v_invoice_number, 'totalCents', v_total,
      'currency', v_currency, 'foreignAmountCents', v_foreign_total)
  );

  RETURN v_invoice_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.party_statement(UUID, TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_by_customer(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_by_item(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expenses_by_supplier(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_statement(UUID, TEXT, UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_by_customer(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_by_item(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.expenses_by_supplier(UUID, DATE, DATE) TO service_role;

-- Rollback: drop the four functions and restore create_invoice_with_journal
-- from 20260917172909.
