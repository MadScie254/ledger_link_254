-- Bills with several lines can carry stock items.
--
-- A bill line may name a stock item and the quantity received. Posting the
-- bill counts that stock in (a BILL movement) and sets the item's cost price
-- to the line's unit cost; voiding the bill counts it back out. The line
-- still posts to the account chosen (usually cost of sales or inventory),
-- so stock is valued periodically from counts, as orders already assume.
-- Invoice lines get the same two columns for documents that sell stock.

ALTER TABLE public.bill_lines
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(16, 3);
ALTER TABLE public.bill_lines
  ADD CONSTRAINT bill_lines_org_item_fkey
    FOREIGN KEY (org_id, inventory_item_id) REFERENCES public.inventory_items(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT bill_lines_quantity_check CHECK (quantity IS NULL OR quantity > 0);
CREATE INDEX IF NOT EXISTS idx_bill_lines_item ON public.bill_lines(org_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;

ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(16, 3);
ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_org_item_fkey
    FOREIGN KEY (org_id, inventory_item_id) REFERENCES public.inventory_items(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT invoice_lines_quantity_check CHECK (quantity IS NULL OR quantity > 0);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_item ON public.invoice_lines(org_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- Undoes exactly what one document moved, whatever the items are now.
CREATE OR REPLACE FUNCTION private.reverse_stock_for(
  p_org_id UUID,
  p_source_type TEXT,
  p_source_id UUID,
  p_note TEXT,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_move RECORD;
BEGIN
  FOR v_move IN
    SELECT movement.item_id, sum(movement.quantity)::INTEGER AS quantity
    FROM public.inventory_movements AS movement
    WHERE movement.org_id = p_org_id AND movement.source_type = p_source_type
      AND movement.source_id = p_source_id
    GROUP BY movement.item_id
    HAVING sum(movement.quantity) <> 0
    ORDER BY movement.item_id
  LOOP
    PERFORM private.move_stock(p_org_id, v_move.item_id, -v_move.quantity, p_source_type, p_source_id, p_note, p_actor);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.reverse_stock_for(UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_bill_with_journal(
  p_org_id UUID,
  p_vendor_id UUID,
  p_bill_date DATE,
  p_due_date DATE,
  p_currency TEXT,
  p_exchange_rate NUMERIC,
  p_notes TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_idempotency_key TEXT,
  p_supplier_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bill_id UUID;
  v_bill_number TEXT;
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
  v_ap_account_id UUID;
  v_input_vat_account_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_reference TEXT := NULLIF(btrim(COALESCE(p_supplier_reference, '')), '');
  v_duplicate TEXT;
  v_item_id UUID;
  v_quantity NUMERIC;
  v_item_type TEXT;
  v_stock JSONB := '[]'::JSONB;
  v_stock_line JSONB;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':bill:' || p_idempotency_key, 0)
  );

  SELECT bill.id INTO v_bill_id
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id
    AND bill.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_bill_id;
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org
  WHERE org.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM public.vendors AS vendor
  WHERE vendor.org_id = p_org_id AND vendor.id = p_vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor does not belong to this organization.' USING ERRCODE = '23503';
  END IF;

  -- The supplier's own invoice number: entered once per supplier, so the
  -- same bill cannot be recorded (and paid) twice.
  IF v_reference IS NOT NULL THEN
    IF length(v_reference) > 100 THEN
      RAISE EXCEPTION 'The supplier reference must be 100 characters or fewer.' USING ERRCODE = '22023';
    END IF;
    SELECT bill.bill_number INTO v_duplicate
    FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.vendor_id = p_vendor_id
      AND lower(bill.supplier_reference) = lower(v_reference) AND bill.status <> 'VOID'
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'This supplier''s invoice % is already recorded as bill %.', v_reference, v_duplicate
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF p_bill_date IS NULL OR p_due_date IS NULL OR p_due_date < p_bill_date THEN
    RAISE EXCEPTION 'Bill dates are invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$'
     OR p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Bill currency or exchange rate is invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_currency = v_base_currency AND p_exchange_rate <> 1 THEN
    RAISE EXCEPTION 'Base-currency bills must use an exchange rate of 1.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'A bill requires at least one line.' USING ERRCODE = '22023';
  END IF;

  SELECT account.id INTO v_ap_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '2000'
    AND account.type = 'LIABILITY' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Accounts Payable account 2000 is required.' USING ERRCODE = '23503';
  END IF;

  SELECT account.id INTO v_input_vat_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '1150'
    AND account.type = 'ASSET' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Recoverable VAT account 1150 is required.' USING ERRCODE = '23503';
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
      RAISE EXCEPTION 'Bill line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;

    -- A line for a stock item counts that quantity in when the bill posts.
    IF v_item_id IS NOT NULL THEN
      SELECT item.type INTO v_item_type
      FROM public.inventory_items AS item
      WHERE item.org_id = p_org_id AND item.id = v_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Bill line %: the stock item is not in this organization.', v_position USING ERRCODE = '23503';
      END IF;
      IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000000000 THEN
        RAISE EXCEPTION 'Bill line %: enter the quantity received.', v_position USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_item_type, '') NOT ILIKE '%service%' THEN
        IF v_quantity <> trunc(v_quantity) THEN
          RAISE EXCEPTION 'Bill line %: stock is counted in whole units.', v_position USING ERRCODE = '22023';
        END IF;
        v_stock := v_stock || jsonb_build_array(jsonb_build_object(
          'itemId', v_item_id, 'quantity', v_quantity::INTEGER, 'amountCents', (v_line->>'amountCents')::BIGINT, 'position', v_position));
      END IF;
    ELSIF v_quantity IS NOT NULL AND (v_quantity <= 0 OR v_quantity > 1000000000) THEN
      RAISE EXCEPTION 'Bill line %: the quantity must be greater than zero.', v_position USING ERRCODE = '22023';
    END IF;

    IF NULLIF(btrim(v_line->>'description'), '') IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_tax < 0 THEN
      RAISE EXCEPTION 'Bill line % requires a description and positive integer-cent amount.', v_position
        USING ERRCODE = '22023';
    END IF;
    -- Receivables, recoverable VAT and money accounts move only through their
    -- own workflows (payments, VAT lines), never as a bill line.
    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type IN ('ASSET', 'COGS', 'EXPENSE') AND account.is_active
      AND NOT account.is_bank_account
      AND account.code NOT IN ('1100', '1150');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill line % must use an active expense, cost of sales or asset account. Receivables, recoverable VAT and bank accounts are not bill lines.', v_position
        USING ERRCODE = '23503';
    END IF;

    IF v_currency = v_base_currency THEN
      v_foreign_amount := COALESCE(v_foreign_amount, v_amount);
      IF v_foreign_amount <> v_amount THEN
        RAISE EXCEPTION 'Base and foreign amounts must match for a base-currency bill.' USING ERRCODE = '22023';
      END IF;
      v_foreign_tax := v_tax;
    ELSE
      IF v_foreign_amount IS NULL OR v_foreign_amount <= 0
         OR abs(round(v_foreign_amount / p_exchange_rate)::BIGINT - v_amount) > 1 THEN
        RAISE EXCEPTION 'Bill line % foreign amount does not match its booked exchange rate.', v_position
          USING ERRCODE = '22023';
      END IF;
      v_foreign_tax := round(v_tax * p_exchange_rate)::BIGINT;
    END IF;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;
    v_foreign_total := v_foreign_total + v_foreign_amount + v_foreign_tax;

    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_account_id,
      'debit', v_amount,
      'credit', 0,
      'description', NULLIF(btrim(v_line->>'description'), ''),
      'entityType', 'VENDOR',
      'entityId', p_vendor_id,
      'currency', v_currency,
      'foreignDebit', v_foreign_amount,
      'foreignCredit', 0,
      'exchangeRate', p_exchange_rate
    ));
  END LOOP;

  v_total := v_subtotal + v_tax_total;
  v_bill_id := gen_random_uuid();
  v_bill_number := 'BILL-' || to_char(p_bill_date, 'YYYY') || '-' ||
    lpad(private.next_document_number(p_org_id, 'BILL')::TEXT, 5, '0');

  INSERT INTO public.bills (
    id, org_id, bill_number, vendor_id, date, due_date,
    subtotal_cents, tax_cents, total_cents, amount_due_cents, status,
    currency, exchange_rate, foreign_amount_cents, notes, created_by, idempotency_key,
    supplier_reference
  ) VALUES (
    v_bill_id, p_org_id, v_bill_number, p_vendor_id, p_bill_date, p_due_date,
    v_subtotal, v_tax_total, v_total, v_total, 'OPEN',
    v_currency, p_exchange_rate, v_foreign_total, NULLIF(btrim(p_notes), ''),
    p_created_by, p_idempotency_key, v_reference
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

    INSERT INTO public.bill_lines (
      org_id, bill_id, description, account_id, amount_cents, tax_cents,
      foreign_amount_cents, foreign_tax_cents, line_position, inventory_item_id, quantity
    ) VALUES (
      p_org_id, v_bill_id, btrim(v_line->>'description'),
      (v_line->>'accountId')::UUID, v_amount, v_tax,
      v_foreign_amount, v_foreign_tax, v_position,
      NULLIF(v_line->>'inventoryItemId', '')::UUID, NULLIF(v_line->>'quantity', '')::NUMERIC
    );
  END LOOP;

  IF v_tax_total > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_input_vat_account_id,
      'debit', v_tax_total,
      'credit', 0,
      'description', 'Recoverable VAT — ' || v_bill_number,
      'entityType', 'VENDOR',
      'entityId', p_vendor_id,
      'currency', v_currency,
      'foreignDebit', CASE WHEN v_currency = v_base_currency THEN v_tax_total
        ELSE round(v_tax_total * p_exchange_rate)::BIGINT END,
      'foreignCredit', 0,
      'exchangeRate', p_exchange_rate
    ));
  END IF;

  v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
    'accountId', v_ap_account_id,
    'debit', 0,
    'credit', v_total,
    'description', 'Accounts payable — ' || v_bill_number,
    'entityType', 'VENDOR',
    'entityId', p_vendor_id,
    'currency', v_currency,
    'foreignDebit', 0,
    'foreignCredit', v_foreign_total,
    'exchangeRate', p_exchange_rate
  ));

  PERFORM private.insert_journal_entry(
    p_org_id, p_bill_date, 'Bill ' || v_bill_number, 'BILL', v_bill_id,
    v_bill_number, p_created_by, v_journal_lines,
    'bill-post:' || p_idempotency_key
  );

  UPDATE public.vendors
  SET balance = COALESCE(balance, 0) + v_total
  WHERE org_id = p_org_id AND id = p_vendor_id;

  -- Stock received on this bill: counted in, and its unit cost becomes the
  -- item's latest cost price.
  FOR v_stock_line IN SELECT value FROM jsonb_array_elements(v_stock)
  LOOP
    PERFORM private.move_stock(
      p_org_id, (v_stock_line->>'itemId')::UUID, (v_stock_line->>'quantity')::INTEGER,
      'BILL', v_bill_id, 'Received on bill ' || v_bill_number, p_created_by,
      'bill:' || v_bill_id::TEXT || ':' || (v_stock_line->>'position')
    );
    UPDATE public.inventory_items
    SET cost_price_cents = round((v_stock_line->>'amountCents')::NUMERIC / (v_stock_line->>'quantity')::NUMERIC)::BIGINT
    WHERE org_id = p_org_id AND id = (v_stock_line->>'itemId')::UUID;
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'CREATE', 'BILL', v_bill_id,
    jsonb_build_object('billNumber', v_bill_number, 'totalCents', v_total,
      'currency', v_currency, 'foreignAmountCents', v_foreign_total, 'supplierReference', v_reference)
  );

  RETURN v_bill_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_bill_with_reversal(
  p_org_id UUID,
  p_bill_id UUID,
  p_void_date DATE,
  p_created_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bill RECORD;
  v_original_journal_id UUID;
  v_reversal_lines JSONB;
  v_reversal_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_void_date IS NULL THEN
    RAISE EXCEPTION 'Void date is required.' USING ERRCODE = '22023';
  END IF;

  SELECT bill.vendor_id, bill.bill_number, bill.status, bill.amount_due_cents
  INTO v_bill
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id AND bill.id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_bill.status = 'VOID' THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bill_payments AS payment
    WHERE payment.org_id = p_org_id AND payment.bill_id = p_bill_id
      AND payment.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A paid or partially paid bill cannot be voided; reverse its payments first.'
      USING ERRCODE = '23514';
  END IF;

  SELECT entry.id INTO v_original_journal_id
  FROM public.journal_entries AS entry
  WHERE entry.org_id = p_org_id AND entry.source_type = 'BILL'
    AND entry.source_id = p_bill_id
  ORDER BY entry.posted_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The bill posting journal was not found.' USING ERRCODE = '23503';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'accountId', line.account_id,
    'debit', line.credit,
    'credit', line.debit,
    'description', 'Reversal: ' || COALESCE(line.description, v_bill.bill_number),
    'entityType', line.entity_type,
    'entityId', line.entity_id,
    'currency', line.currency,
    'foreignDebit', line.foreign_credit,
    'foreignCredit', line.foreign_debit,
    'exchangeRate', line.exchange_rate
  ) ORDER BY line.id)
  INTO v_reversal_lines
  FROM public.journal_lines AS line
  WHERE line.org_id = p_org_id AND line.journal_entry_id = v_original_journal_id;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_void_date, 'Void bill ' || v_bill.bill_number,
    'ADJUSTMENT', p_bill_id, 'VOID-' || v_bill.bill_number,
    p_created_by, v_reversal_lines, 'void:bill:' || p_bill_id::TEXT
  );

  UPDATE public.bills
  SET status = 'VOID', amount_due_cents = 0
  WHERE org_id = p_org_id AND id = p_bill_id;

  -- Stock this bill counted in is counted back out.
  PERFORM private.reverse_stock_for(p_org_id, 'BILL', p_bill_id, 'Bill ' || v_bill.bill_number || ' voided', p_created_by);
  UPDATE public.vendors
  SET balance = greatest(COALESCE(balance, 0) - v_bill.amount_due_cents, 0)
  WHERE org_id = p_org_id AND id = v_bill.vendor_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'VOID', 'BILL', p_bill_id,
    jsonb_build_object('reversalJournalEntryId', v_reversal_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_bill_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.void_bill_with_reversal(UUID, UUID, DATE, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_bill_with_reversal(UUID, UUID, DATE, UUID) TO service_role;

-- Rollback: restore both functions from 20261004000100, drop
-- private.reverse_stock_for, and drop the added columns and constraints.
