-- Estimates (quotes): a priced offer to a customer that, once accepted,
-- becomes an invoice or a sales order in one step.
--
-- An estimate never posts to the ledger. It is drafted, sent, accepted or
-- declined, and converted; the invoice raised from it posts through
-- create_invoice_with_journal exactly as a hand-written invoice would. An
-- estimate whose invoice is voided can be converted again.

-- 1. Numbering for every document type the app issues.
CREATE OR REPLACE FUNCTION private.next_document_number(
  p_org_id UUID,
  p_document_type TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_number INTEGER;
BEGIN
  IF p_document_type NOT IN (
    'INVOICE', 'BILL', 'SALES_ORDER', 'ESTIMATE', 'CREDIT_NOTE', 'SALES_RECEIPT',
    'EXPENSE', 'TRANSFER', 'PURCHASE_ORDER', 'SUPPLIER_CREDIT', 'REFUND', 'DEPOSIT'
  ) THEN
    RAISE EXCEPTION 'Unsupported document type.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.document_counters AS counter (org_id, doc_type, next_number)
  VALUES (p_org_id, p_document_type, 2)
  ON CONFLICT (org_id, doc_type)
  DO UPDATE SET next_number = counter.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  RETURN v_number;
END;
$function$;

REVOKE ALL ON FUNCTION private.next_document_number(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- 2. Priced sales lines, checked once for every document that carries them
-- (estimates, sales receipts, credit notes): a description, an active
-- income account, a quantity (whole for stock items), a unit price in
-- cents and a VAT rate. Returns the lines with their amounts and totals.
CREATE OR REPLACE FUNCTION private.prepare_sales_lines(
  p_org_id UUID,
  p_lines JSONB,
  p_document TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_line JSONB;
  v_position INTEGER := 0;
  v_description TEXT;
  v_account_id UUID;
  v_item_id UUID;
  v_item_type TEXT;
  v_quantity NUMERIC;
  v_unit_price BIGINT;
  v_tax_rate NUMERIC;
  v_amount BIGINT;
  v_tax BIGINT;
  v_subtotal BIGINT := 0;
  v_tax_total BIGINT := 0;
  v_prepared JSONB := '[]'::JSONB;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'A % needs between 1 and 200 lines.', p_document USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;
    BEGIN
      v_description := btrim(v_line->>'description');
      v_account_id := (v_line->>'accountId')::UUID;
      v_item_id := NULLIF(v_line->>'inventoryItemId', '')::UUID;
      v_quantity := (v_line->>'quantity')::NUMERIC;
      v_unit_price := (v_line->>'unitPriceCents')::BIGINT;
      v_tax_rate := COALESCE(NULLIF(v_line->>'taxRate', '')::NUMERIC, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;

    IF v_description IS NULL OR v_description = '' OR length(v_description) > 500 THEN
      RAISE EXCEPTION 'Line % needs a description of up to 500 characters.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000000000 OR v_quantity <> round(v_quantity, 3) THEN
      RAISE EXCEPTION 'Line % quantity must be above zero with at most three decimals.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Line % unit price must be zero or more, in whole cents.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 OR v_tax_rate <> round(v_tax_rate, 2) THEN
      RAISE EXCEPTION 'Line % VAT rate must be between 0 and 100 with at most two decimals.', v_position USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type = 'INCOME' AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line % must use an active income account in this organization.', v_position USING ERRCODE = '23503';
    END IF;

    v_item_type := NULL;
    IF v_item_id IS NOT NULL THEN
      SELECT item.type INTO v_item_type
      FROM public.inventory_items AS item
      WHERE item.org_id = p_org_id AND item.id = v_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line % uses a stock item from another organization or one that does not exist.', v_position
          USING ERRCODE = '23503';
      END IF;
      IF COALESCE(v_item_type, '') NOT ILIKE '%service%' AND v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION 'Line % is a stock item, so its quantity must be a whole number.', v_position USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_quantity * v_unit_price > 900000000000000 THEN
      RAISE EXCEPTION 'Line % is too large to record.', v_position USING ERRCODE = '22023';
    END IF;
    v_amount := round(v_quantity * v_unit_price)::BIGINT;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Line % comes to nothing; give it a price.', v_position USING ERRCODE = '22023';
    END IF;
    v_tax := round(v_amount * v_tax_rate / 100)::BIGINT;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;
    v_prepared := v_prepared || jsonb_build_array(jsonb_build_object(
      'position', v_position, 'description', v_description, 'accountId', v_account_id,
      'itemId', v_item_id, 'stocked', v_item_id IS NOT NULL AND COALESCE(v_item_type, '') NOT ILIKE '%service%',
      'quantity', v_quantity, 'unitPrice', v_unit_price,
      'taxRate', v_tax_rate, 'amount', v_amount, 'tax', v_tax
    ));
  END LOOP;

  RETURN jsonb_build_object('lines', v_prepared, 'subtotal', v_subtotal, 'tax', v_tax_total);
END;
$function$;

REVOKE ALL ON FUNCTION private.prepare_sales_lines(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Prepared lines as invoice lines: what was sold, how many and at what
-- price, so the invoice reads like the document it came from.
CREATE OR REPLACE FUNCTION private.invoice_lines_from(p_prepared JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'description', CASE WHEN (line->>'quantity')::NUMERIC = 1 THEN line->>'description'
      ELSE (line->>'description') || ' (' || trim_scale((line->>'quantity')::NUMERIC)::TEXT || ' x '
        || to_char((line->>'unitPrice')::NUMERIC / 100.0, 'FM999,999,999,990.00') || ')' END,
    'accountId', line->>'accountId',
    'amountCents', (line->>'amount')::BIGINT,
    'taxCents', (line->>'tax')::BIGINT,
    'inventoryItemId', line->>'itemId',
    'quantity', (line->>'quantity')::NUMERIC
  ) ORDER BY (line->>'position')::INTEGER), '[]'::JSONB)
  FROM jsonb_array_elements(p_prepared) AS prepared(line);
$function$;

REVOKE ALL ON FUNCTION private.invoice_lines_from(JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Tables.
CREATE TABLE public.estimates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  estimate_number  TEXT NOT NULL,
  customer_id      UUID NOT NULL,
  estimate_date    DATE NOT NULL,
  expiry_date      DATE,
  status           TEXT NOT NULL DEFAULT 'DRAFT',
  currency         TEXT NOT NULL,
  subtotal_cents   BIGINT NOT NULL,
  tax_cents        BIGINT NOT NULL DEFAULT 0,
  total_cents      BIGINT NOT NULL,
  notes            TEXT,
  decline_reason   TEXT,
  invoice_id       UUID,
  sales_order_id   UUID,
  converted_at     TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key  TEXT NOT NULL,
  CONSTRAINT estimates_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT estimates_org_number_key UNIQUE (org_id, estimate_number),
  CONSTRAINT estimates_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT estimates_org_customer_fkey FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT estimates_org_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT estimates_org_sales_order_fkey FOREIGN KEY (org_id, sales_order_id)
    REFERENCES public.sales_orders(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT estimates_status_check CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED')),
  CONSTRAINT estimates_expiry_check CHECK (expiry_date IS NULL OR expiry_date >= estimate_date),
  CONSTRAINT estimates_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT estimates_amounts_check
    CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents),
  CONSTRAINT estimates_notes_length_check CHECK (notes IS NULL OR length(notes) <= 4000),
  CONSTRAINT estimates_decline_reason_length_check CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  CONSTRAINT estimates_converted_check
    CHECK ((status = 'CONVERTED') = (converted_at IS NOT NULL AND (invoice_id IS NOT NULL OR sales_order_id IS NOT NULL)))
);

CREATE TABLE public.estimate_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  estimate_id       UUID NOT NULL,
  line_position     INTEGER NOT NULL,
  description       TEXT NOT NULL,
  inventory_item_id UUID,
  account_id        UUID NOT NULL,
  quantity          NUMERIC(14, 3) NOT NULL,
  unit_price_cents  BIGINT NOT NULL,
  tax_rate          NUMERIC(5, 2) NOT NULL DEFAULT 0,
  amount_cents      BIGINT NOT NULL,
  tax_cents         BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT estimate_lines_position_key UNIQUE (estimate_id, line_position),
  CONSTRAINT estimate_lines_estimate_fkey FOREIGN KEY (org_id, estimate_id)
    REFERENCES public.estimates(org_id, id) ON DELETE CASCADE,
  CONSTRAINT estimate_lines_item_fkey FOREIGN KEY (org_id, inventory_item_id)
    REFERENCES public.inventory_items(org_id, id) ON DELETE SET NULL (inventory_item_id),
  CONSTRAINT estimate_lines_account_fkey FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT estimate_lines_position_check CHECK (line_position > 0),
  CONSTRAINT estimate_lines_description_check CHECK (btrim(description) <> '' AND length(description) <= 500),
  CONSTRAINT estimate_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT estimate_lines_amounts_check CHECK (unit_price_cents >= 0 AND amount_cents > 0 AND tax_cents >= 0),
  CONSTRAINT estimate_lines_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 100)
);

CREATE INDEX idx_estimates_org_status ON public.estimates(org_id, status);
CREATE INDEX idx_estimates_org_customer ON public.estimates(org_id, customer_id);
CREATE INDEX idx_estimate_lines_estimate ON public.estimate_lines(estimate_id);

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY estimates_select_policy ON public.estimates
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY estimate_lines_select_policy ON public.estimate_lines
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.estimates, public.estimate_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estimates, public.estimate_lines TO service_role;

-- 4. Write an estimate, or rewrite one not yet converted.
CREATE OR REPLACE FUNCTION public.save_estimate(
  p_org_id UUID,
  p_estimate_id UUID,
  p_customer_id UUID,
  p_estimate_date DATE,
  p_expiry_date DATE,
  p_notes TEXT,
  p_actor UUID,
  p_lines JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing RECORD;
  v_currency TEXT;
  v_prepared JSONB;
  v_id UUID := p_estimate_id;
  v_number TEXT;
  v_total BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);

  IF p_estimate_id IS NULL THEN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
      RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_org_id::TEXT || ':estimate:' || p_idempotency_key, 0)
    );
    SELECT estimate.id, estimate.estimate_number, estimate.total_cents INTO v_existing
    FROM public.estimates AS estimate
    WHERE estimate.org_id = p_org_id AND estimate.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_existing.id, 'estimateNumber', v_existing.estimate_number, 'totalCents', v_existing.total_cents);
    END IF;
  ELSE
    SELECT estimate.id, estimate.estimate_number, estimate.status INTO v_existing
    FROM public.estimates AS estimate
    WHERE estimate.org_id = p_org_id AND estimate.id = p_estimate_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Estimate not found in this organization.' USING ERRCODE = '23503';
    END IF;
    IF v_existing.status = 'CONVERTED' THEN
      RAISE EXCEPTION 'Estimate % has been converted and can no longer be changed.', v_existing.estimate_number
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT upper(org.base_currency) INTO v_currency FROM public.organizations AS org WHERE org.id = p_org_id;
  PERFORM 1 FROM public.customers AS customer WHERE customer.org_id = p_org_id AND customer.id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer does not belong to this organization.' USING ERRCODE = '23503';
  END IF;
  IF p_estimate_date IS NULL THEN
    RAISE EXCEPTION 'The estimate date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_expiry_date IS NOT NULL AND p_expiry_date < p_estimate_date THEN
    RAISE EXCEPTION 'An estimate cannot expire before its date.' USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 4000 THEN
    RAISE EXCEPTION 'Notes must be 4,000 characters or fewer.' USING ERRCODE = '22023';
  END IF;

  v_prepared := private.prepare_sales_lines(p_org_id, p_lines, 'estimate');
  v_total := (v_prepared->>'subtotal')::BIGINT + (v_prepared->>'tax')::BIGINT;

  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    v_number := 'EST-' || to_char(p_estimate_date, 'YYYY') || '-' ||
      lpad(private.next_document_number(p_org_id, 'ESTIMATE')::TEXT, 5, '0');
    INSERT INTO public.estimates (
      id, org_id, estimate_number, customer_id, estimate_date, expiry_date, status, currency,
      subtotal_cents, tax_cents, total_cents, notes, created_by, idempotency_key
    ) VALUES (
      v_id, p_org_id, v_number, p_customer_id, p_estimate_date, p_expiry_date, 'DRAFT', v_currency,
      (v_prepared->>'subtotal')::BIGINT, (v_prepared->>'tax')::BIGINT, v_total,
      NULLIF(btrim(p_notes), ''), p_actor, p_idempotency_key
    );
  ELSE
    v_number := v_existing.estimate_number;
    UPDATE public.estimates
    SET customer_id = p_customer_id, estimate_date = p_estimate_date, expiry_date = p_expiry_date,
        subtotal_cents = (v_prepared->>'subtotal')::BIGINT, tax_cents = (v_prepared->>'tax')::BIGINT,
        total_cents = v_total, notes = NULLIF(btrim(p_notes), ''), updated_at = now()
    WHERE org_id = p_org_id AND id = v_id;
    DELETE FROM public.estimate_lines WHERE org_id = p_org_id AND estimate_id = v_id;
  END IF;

  INSERT INTO public.estimate_lines (
    org_id, estimate_id, line_position, description, inventory_item_id, account_id,
    quantity, unit_price_cents, tax_rate, amount_cents, tax_cents
  )
  SELECT p_org_id, v_id, (line->>'position')::INTEGER, line->>'description',
         NULLIF(line->>'itemId', '')::UUID, (line->>'accountId')::UUID,
         (line->>'quantity')::NUMERIC, (line->>'unitPrice')::BIGINT, (line->>'taxRate')::NUMERIC,
         (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, CASE WHEN p_estimate_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END, 'ESTIMATE', v_id,
    jsonb_build_object('estimateNumber', v_number, 'totalCents', v_total));

  RETURN jsonb_build_object('id', v_id, 'estimateNumber', v_number, 'totalCents', v_total);
END;
$function$;

-- 5. Sent, accepted or declined (or back to a draft). Converted is final.
CREATE OR REPLACE FUNCTION public.set_estimate_status(
  p_org_id UUID,
  p_estimate_id UUID,
  p_status TEXT,
  p_reason TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estimate RECORD;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_status NOT IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED') THEN
    RAISE EXCEPTION 'An estimate can be marked draft, sent, accepted or declined.' USING ERRCODE = '22023';
  END IF;
  SELECT estimate.estimate_number, estimate.status INTO v_estimate
  FROM public.estimates AS estimate
  WHERE estimate.org_id = p_org_id AND estimate.id = p_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_estimate.status = 'CONVERTED' THEN
    RAISE EXCEPTION 'Estimate % has been converted.', v_estimate.estimate_number USING ERRCODE = '23514';
  END IF;
  IF p_reason IS NOT NULL AND length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the reason to 500 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_estimate.status = p_status THEN
    RETURN jsonb_build_object('estimateNumber', v_estimate.estimate_number, 'status', p_status);
  END IF;

  UPDATE public.estimates
  SET status = p_status,
      decline_reason = CASE WHEN p_status = 'DECLINED' THEN NULLIF(btrim(COALESCE(p_reason, '')), '') END,
      updated_at = now()
  WHERE org_id = p_org_id AND id = p_estimate_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'UPDATE', 'ESTIMATE', p_estimate_id,
    jsonb_build_object('estimateNumber', v_estimate.estimate_number, 'from', v_estimate.status, 'to', p_status));

  RETURN jsonb_build_object('estimateNumber', v_estimate.estimate_number, 'status', p_status);
END;
$function$;

-- 6. Turn an estimate into an invoice (posted) or a sales order (recorded).
CREATE OR REPLACE FUNCTION public.convert_estimate(
  p_org_id UUID,
  p_estimate_id UUID,
  p_target TEXT,
  p_date DATE,
  p_due_date DATE,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estimate RECORD;
  v_lines JSONB;
  v_document_id UUID;
  v_document_number TEXT;
  v_previous_status TEXT;
  v_order JSONB;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_target NOT IN ('INVOICE', 'SALES_ORDER') THEN
    RAISE EXCEPTION 'An estimate converts to an invoice or a sales order.' USING ERRCODE = '22023';
  END IF;

  SELECT estimate.* INTO v_estimate
  FROM public.estimates AS estimate
  WHERE estimate.org_id = p_org_id AND estimate.id = p_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found in this organization.' USING ERRCODE = '23503';
  END IF;

  -- Already converted: return that document, unless it was an invoice since voided.
  IF v_estimate.status = 'CONVERTED' THEN
    IF v_estimate.sales_order_id IS NOT NULL THEN
      SELECT sales_order.order_number INTO v_document_number
      FROM public.sales_orders AS sales_order WHERE sales_order.org_id = p_org_id AND sales_order.id = v_estimate.sales_order_id;
      RETURN jsonb_build_object('target', 'SALES_ORDER', 'id', v_estimate.sales_order_id, 'number', v_document_number);
    END IF;
    SELECT invoice.invoice_number, invoice.status INTO v_document_number, v_previous_status
    FROM public.invoices AS invoice WHERE invoice.org_id = p_org_id AND invoice.id = v_estimate.invoice_id;
    IF v_previous_status IS DISTINCT FROM 'VOID' THEN
      RETURN jsonb_build_object('target', 'INVOICE', 'id', v_estimate.invoice_id, 'number', v_document_number);
    END IF;
  ELSIF v_estimate.status = 'DECLINED' THEN
    RAISE EXCEPTION 'Estimate % was declined. Mark it accepted first.', v_estimate.estimate_number USING ERRCODE = '23514';
  END IF;

  IF p_target = 'INVOICE' THEN
    SELECT private.invoice_lines_from(jsonb_agg(jsonb_build_object(
      'position', line.line_position, 'description', line.description, 'accountId', line.account_id,
      'itemId', line.inventory_item_id, 'quantity', line.quantity, 'unitPrice', line.unit_price_cents,
      'amount', line.amount_cents, 'tax', line.tax_cents)))
    INTO v_lines
    FROM public.estimate_lines AS line
    WHERE line.org_id = p_org_id AND line.estimate_id = p_estimate_id;

    v_document_id := public.create_invoice_with_journal(
      p_org_id, v_estimate.customer_id, p_date, p_due_date, v_estimate.currency, 1,
      'Estimate ' || v_estimate.estimate_number || COALESCE(E'\n' || v_estimate.notes, ''),
      p_actor, v_lines,
      'estimate:' || p_estimate_id::TEXT || COALESCE(':after:' || v_estimate.invoice_id::TEXT, '')
    );
    SELECT invoice.invoice_number INTO v_document_number
    FROM public.invoices AS invoice WHERE invoice.org_id = p_org_id AND invoice.id = v_document_id;
    UPDATE public.estimates
    SET status = 'CONVERTED', invoice_id = v_document_id, converted_at = now(), updated_at = now()
    WHERE org_id = p_org_id AND id = p_estimate_id;
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
      'description', line.description, 'accountId', line.account_id, 'inventoryItemId', line.inventory_item_id,
      'quantity', line.quantity, 'unitPriceCents', line.unit_price_cents, 'taxRate', line.tax_rate
    ) ORDER BY line.line_position)
    INTO v_lines
    FROM public.estimate_lines AS line
    WHERE line.org_id = p_org_id AND line.estimate_id = p_estimate_id;

    v_order := public.create_sales_order(
      p_org_id, v_estimate.customer_id, p_date, NULL,
      'Estimate ' || v_estimate.estimate_number || COALESCE(E'\n' || v_estimate.notes, ''),
      p_actor, v_lines, 'estimate:' || p_estimate_id::TEXT
    );
    v_document_id := (v_order->>'id')::UUID;
    v_document_number := v_order->>'orderNumber';
    UPDATE public.estimates
    SET status = 'CONVERTED', sales_order_id = v_document_id, converted_at = now(), updated_at = now()
    WHERE org_id = p_org_id AND id = p_estimate_id;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CONVERT', 'ESTIMATE', p_estimate_id,
    jsonb_build_object('estimateNumber', v_estimate.estimate_number, 'target', p_target,
      'documentId', v_document_id, 'documentNumber', v_document_number));

  RETURN jsonb_build_object('target', p_target, 'id', v_document_id, 'number', v_document_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_estimate(UUID, UUID, UUID, DATE, DATE, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_estimate_status(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_estimate(UUID, UUID, TEXT, DATE, DATE, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate(UUID, UUID, UUID, DATE, DATE, TEXT, UUID, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_estimate_status(UUID, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_estimate(UUID, UUID, TEXT, DATE, DATE, UUID) TO service_role;

-- Rollback: drop the three public functions, private.invoice_lines_from,
-- private.prepare_sales_lines, public.estimate_lines and public.estimates,
-- and restore private.next_document_number from 20261003000000.
