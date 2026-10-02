-- Sales orders: a customer's order recorded when it is placed, worked on,
-- completed (delivered) or cancelled, and invoiced in one step.
--
-- An order is a promise, not a sale, so it never posts to the ledger. Only
-- the invoice raised from it does, through create_invoice_with_journal, which
-- moves receivables, revenue and output VAT exactly as a hand-written invoice
-- would.
--
-- Completing an order lowers the stock count of each stocked item on it, and
-- reopening a completed order puts the count back. Items whose type is a
-- service are not counted. No cost-of-goods entry is posted: inventory is not
-- yet valued in the ledger anywhere in the app, so this keeps counts current
-- without inventing an accounting entry. A count may go below zero when more
-- is delivered than the system thought was on hand; that is recorded as it
-- happened and the screen warns before completing.

-- 1. Order numbers come from the same gap-free counter as invoices and bills.
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
  IF p_document_type NOT IN ('INVOICE', 'BILL', 'SALES_ORDER') THEN
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

REVOKE ALL ON FUNCTION private.next_document_number(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- 2. Tables.
CREATE TABLE public.sales_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_number    TEXT NOT NULL,
  customer_id     UUID NOT NULL,
  order_date      DATE NOT NULL,
  promised_date   DATE,
  status          TEXT NOT NULL DEFAULT 'OPEN',
  currency        TEXT NOT NULL,
  subtotal_cents  BIGINT NOT NULL,
  tax_cents       BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL,
  notes           TEXT,
  invoice_id      UUID,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason   TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  CONSTRAINT sales_orders_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT sales_orders_org_number_key UNIQUE (org_id, order_number),
  CONSTRAINT sales_orders_org_idempotency_key UNIQUE (org_id, idempotency_key),
  -- One invoice belongs to at most one order.
  CONSTRAINT sales_orders_org_invoice_key UNIQUE (org_id, invoice_id),
  CONSTRAINT sales_orders_org_customer_fkey FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_orders_org_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_orders_status_check
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT sales_orders_promised_date_check
    CHECK (promised_date IS NULL OR promised_date >= order_date),
  CONSTRAINT sales_orders_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT sales_orders_amounts_check
    CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents),
  CONSTRAINT sales_orders_notes_length_check CHECK (notes IS NULL OR length(notes) <= 4000),
  CONSTRAINT sales_orders_cancel_reason_length_check
    CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  CONSTRAINT sales_orders_completed_check
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CONSTRAINT sales_orders_cancelled_check
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE TABLE public.sales_order_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  order_id          UUID NOT NULL,
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
  CONSTRAINT sales_order_lines_position_key UNIQUE (order_id, line_position),
  CONSTRAINT sales_order_lines_order_fkey FOREIGN KEY (org_id, order_id)
    REFERENCES public.sales_orders(org_id, id) ON DELETE CASCADE,
  -- Deleting a stock item keeps the order line and forgets the link; the
  -- column list stops SET NULL from also clearing org_id.
  CONSTRAINT sales_order_lines_item_fkey FOREIGN KEY (org_id, inventory_item_id)
    REFERENCES public.inventory_items(org_id, id) ON DELETE SET NULL (inventory_item_id),
  CONSTRAINT sales_order_lines_account_fkey FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_order_lines_position_check CHECK (line_position > 0),
  CONSTRAINT sales_order_lines_description_check
    CHECK (btrim(description) <> '' AND length(description) <= 500),
  CONSTRAINT sales_order_lines_quantity_check CHECK (quantity > 0),
  CONSTRAINT sales_order_lines_amounts_check
    CHECK (unit_price_cents >= 0 AND amount_cents > 0 AND tax_cents >= 0),
  CONSTRAINT sales_order_lines_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 100)
);

CREATE INDEX idx_sales_orders_org_status ON public.sales_orders(org_id, status);
CREATE INDEX idx_sales_orders_org_customer ON public.sales_orders(org_id, customer_id);
CREATE INDEX idx_sales_order_lines_order ON public.sales_order_lines(order_id);

-- 3. Access: the Worker reads and writes with the service role; signed-in
-- browsers get no table grants, as for every other financial table.
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_orders_select_policy ON public.sales_orders
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY sales_order_lines_select_policy ON public.sales_order_lines
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));

REVOKE ALL ON TABLE public.sales_orders, public.sales_order_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_orders, public.sales_order_lines TO service_role;

-- 4. Record an order.
CREATE OR REPLACE FUNCTION public.create_sales_order(
  p_org_id UUID,
  p_customer_id UUID,
  p_order_date DATE,
  p_promised_date DATE,
  p_notes TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_id UUID;
  v_order_number TEXT;
  v_existing RECORD;
  v_currency TEXT;
  v_line JSONB;
  v_position INTEGER := 0;
  v_description TEXT;
  v_account_id UUID;
  v_item_id UUID;
  v_quantity NUMERIC;
  v_unit_price BIGINT;
  v_tax_rate NUMERIC;
  v_amount BIGINT;
  v_tax BIGINT;
  v_subtotal BIGINT := 0;
  v_tax_total BIGINT := 0;
  v_prepared JSONB := '[]'::JSONB;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':sales-order:' || p_idempotency_key, 0)
  );

  SELECT sales_order.id, sales_order.order_number, sales_order.total_cents
  INTO v_existing
  FROM public.sales_orders AS sales_order
  WHERE sales_order.org_id = p_org_id AND sales_order.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_existing.id, 'orderNumber', v_existing.order_number, 'totalCents', v_existing.total_cents
    );
  END IF;

  SELECT upper(org.base_currency) INTO v_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM public.customers AS customer
  WHERE customer.org_id = p_org_id AND customer.id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer does not belong to this organization.' USING ERRCODE = '23503';
  END IF;

  IF p_order_date IS NULL THEN
    RAISE EXCEPTION 'The order date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_promised_date IS NOT NULL AND p_promised_date < p_order_date THEN
    RAISE EXCEPTION 'The promised date cannot be before the order date.' USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 4000 THEN
    RAISE EXCEPTION 'Order notes must be 4,000 characters or fewer.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'An order needs between 1 and 200 lines.' USING ERRCODE = '22023';
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
      RAISE EXCEPTION 'Order line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;

    IF v_description IS NULL OR v_description = '' OR length(v_description) > 500 THEN
      RAISE EXCEPTION 'Order line % needs a description of up to 500 characters.', v_position
        USING ERRCODE = '22023';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000000000
       OR v_quantity <> round(v_quantity, 3) THEN
      RAISE EXCEPTION 'Order line % quantity must be above zero with at most three decimals.', v_position
        USING ERRCODE = '22023';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Order line % unit price must be zero or more, in whole cents.', v_position
        USING ERRCODE = '22023';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 OR v_tax_rate <> round(v_tax_rate, 2) THEN
      RAISE EXCEPTION 'Order line % VAT rate must be between 0 and 100 with at most two decimals.', v_position
        USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type = 'INCOME' AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order line % must use an active income account in this organization.', v_position
        USING ERRCODE = '23503';
    END IF;

    IF v_item_id IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_items AS item
      WHERE item.org_id = p_org_id AND item.id = v_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Order line % uses a stock item from another organization or one that does not exist.', v_position
          USING ERRCODE = '23503';
      END IF;
      -- Stock is counted in whole units.
      IF v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION 'Order line % is a stock item, so its quantity must be a whole number.', v_position
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_quantity * v_unit_price > 900000000000000 THEN
      RAISE EXCEPTION 'Order line % is too large to record.', v_position USING ERRCODE = '22023';
    END IF;
    v_amount := round(v_quantity * v_unit_price)::BIGINT;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Order line % comes to nothing; give it a price.', v_position USING ERRCODE = '22023';
    END IF;
    v_tax := round(v_amount * v_tax_rate / 100)::BIGINT;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;
    v_prepared := v_prepared || jsonb_build_array(jsonb_build_object(
      'position', v_position, 'description', v_description, 'accountId', v_account_id,
      'itemId', v_item_id, 'quantity', v_quantity, 'unitPrice', v_unit_price,
      'taxRate', v_tax_rate, 'amount', v_amount, 'tax', v_tax
    ));
  END LOOP;

  v_order_id := gen_random_uuid();
  v_order_number := 'SO-' || to_char(p_order_date, 'YYYY') || '-' ||
    lpad(private.next_document_number(p_org_id, 'SALES_ORDER')::TEXT, 5, '0');

  INSERT INTO public.sales_orders (
    id, org_id, order_number, customer_id, order_date, promised_date, status, currency,
    subtotal_cents, tax_cents, total_cents, notes, created_by, idempotency_key
  ) VALUES (
    v_order_id, p_org_id, v_order_number, p_customer_id, p_order_date, p_promised_date, 'OPEN', v_currency,
    v_subtotal, v_tax_total, v_subtotal + v_tax_total, NULLIF(btrim(p_notes), ''), p_created_by, p_idempotency_key
  );

  INSERT INTO public.sales_order_lines (
    org_id, order_id, line_position, description, inventory_item_id, account_id,
    quantity, unit_price_cents, tax_rate, amount_cents, tax_cents
  )
  SELECT p_org_id, v_order_id, (line->>'position')::INTEGER, line->>'description',
         NULLIF(line->>'itemId', '')::UUID, (line->>'accountId')::UUID,
         (line->>'quantity')::NUMERIC, (line->>'unitPrice')::BIGINT, (line->>'taxRate')::NUMERIC,
         (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared) AS prepared(line);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'CREATE', 'SALES_ORDER', v_order_id,
    jsonb_build_object('orderNumber', v_order_number, 'totalCents', v_subtotal + v_tax_total,
      'lines', jsonb_array_length(v_prepared))
  );

  RETURN jsonb_build_object(
    'id', v_order_id, 'orderNumber', v_order_number, 'totalCents', v_subtotal + v_tax_total
  );
END;
$function$;

-- 5. Move an order through its statuses, keeping stock counts in step.
CREATE OR REPLACE FUNCTION public.set_sales_order_status(
  p_org_id UUID,
  p_order_id UUID,
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
  v_order RECORD;
  v_target TEXT := upper(btrim(COALESCE(p_status, '')));
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_invoice RECORD;
  v_direction INTEGER := 0;
  v_stock JSONB := '[]'::JSONB;
  v_line RECORD;
  v_on_hand INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);

  SELECT sales_order.id, sales_order.order_number, sales_order.status, sales_order.invoice_id
  INTO v_order
  FROM public.sales_orders AS sales_order
  WHERE sales_order.org_id = p_org_id AND sales_order.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found in this organization.' USING ERRCODE = '23503';
  END IF;

  IF v_target NOT IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'An order can be moved to in progress, completed or cancelled.' USING ERRCODE = '22023';
  END IF;

  -- Asking again for the status it already has changes nothing, so a double
  -- click never counts stock out twice.
  IF v_order.status = v_target THEN
    RETURN jsonb_build_object('orderNumber', v_order.order_number, 'status', v_order.status,
      'stockChanges', '[]'::JSONB);
  END IF;

  IF NOT (
    (v_order.status = 'OPEN' AND v_target IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
    OR (v_order.status = 'IN_PROGRESS' AND v_target IN ('COMPLETED', 'CANCELLED'))
    OR (v_order.status = 'COMPLETED' AND v_target = 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'Order % is % and cannot become %.', v_order.order_number,
      replace(lower(v_order.status), '_', ' '), replace(lower(v_target), '_', ' ')
      USING ERRCODE = '23514';
  END IF;

  IF v_target = 'CANCELLED' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Give a reason for cancelling order %.', v_order.order_number USING ERRCODE = '22023';
    END IF;
    IF length(v_reason) > 500 THEN
      RAISE EXCEPTION 'The cancellation reason must be 500 characters or fewer.' USING ERRCODE = '22023';
    END IF;
    IF v_order.invoice_id IS NOT NULL THEN
      SELECT invoice.invoice_number, invoice.status INTO v_invoice
      FROM public.invoices AS invoice
      WHERE invoice.org_id = p_org_id AND invoice.id = v_order.invoice_id;
      IF v_invoice.status IS DISTINCT FROM 'VOID' THEN
        RAISE EXCEPTION 'Order % has invoice %; void the invoice first, then cancel the order.',
          v_order.order_number, v_invoice.invoice_number USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Completing counts stock out; reopening a completed order counts it back.
  IF v_target = 'COMPLETED' THEN
    v_direction := -1;
  ELSIF v_order.status = 'COMPLETED' THEN
    v_direction := 1;
  END IF;

  IF v_direction <> 0 THEN
    FOR v_line IN
      SELECT line.inventory_item_id AS item_id, item.name, sum(line.quantity)::INTEGER AS quantity
      FROM public.sales_order_lines AS line
      JOIN public.inventory_items AS item
        ON item.org_id = line.org_id AND item.id = line.inventory_item_id
      WHERE line.org_id = p_org_id AND line.order_id = p_order_id
        AND COALESCE(item.type, '') NOT ILIKE '%service%'
      GROUP BY line.inventory_item_id, item.name
      ORDER BY item.name
    LOOP
      UPDATE public.inventory_items AS item
      SET quantity_on_hand = COALESCE(item.quantity_on_hand, 0) + v_direction * v_line.quantity
      WHERE item.org_id = p_org_id AND item.id = v_line.item_id
      RETURNING item.quantity_on_hand INTO v_on_hand;

      v_stock := v_stock || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.item_id, 'name', v_line.name,
        'quantity', v_direction * v_line.quantity, 'quantityOnHand', v_on_hand
      ));
    END LOOP;
  END IF;

  UPDATE public.sales_orders AS sales_order
  SET status = v_target,
      completed_at = CASE WHEN v_target = 'COMPLETED' THEN now() ELSE NULL END,
      completed_by = CASE WHEN v_target = 'COMPLETED' THEN p_actor ELSE NULL END,
      cancelled_at = CASE WHEN v_target = 'CANCELLED' THEN now() ELSE NULL END,
      cancelled_by = CASE WHEN v_target = 'CANCELLED' THEN p_actor ELSE NULL END,
      cancel_reason = CASE WHEN v_target = 'CANCELLED' THEN v_reason ELSE NULL END,
      updated_at = now()
  WHERE sales_order.org_id = p_org_id AND sales_order.id = p_order_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_actor, 'UPDATE', 'SALES_ORDER', p_order_id,
    jsonb_build_object('orderNumber', v_order.order_number, 'from', v_order.status, 'to', v_target,
      'reason', v_reason, 'stockChanges', v_stock)
  );

  RETURN jsonb_build_object('orderNumber', v_order.order_number, 'status', v_target, 'stockChanges', v_stock);
END;
$function$;

-- 6. Raise the invoice for an order. The invoice posts to the ledger; the
-- order's status and stock are unchanged.
CREATE OR REPLACE FUNCTION public.invoice_sales_order(
  p_org_id UUID,
  p_order_id UUID,
  p_issue_date DATE,
  p_due_date DATE,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order RECORD;
  v_base_currency TEXT;
  v_lines JSONB;
  v_invoice_id UUID;
  v_invoice_number TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);

  SELECT sales_order.id, sales_order.order_number, sales_order.status, sales_order.invoice_id,
         sales_order.customer_id, sales_order.currency, sales_order.notes
  INTO v_order
  FROM public.sales_orders AS sales_order
  WHERE sales_order.org_id = p_org_id AND sales_order.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found in this organization.' USING ERRCODE = '23503';
  END IF;

  -- Already invoiced: return that invoice rather than raising a second one.
  IF v_order.invoice_id IS NOT NULL THEN
    SELECT invoice.invoice_number INTO v_invoice_number
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = v_order.invoice_id;
    RETURN jsonb_build_object('invoiceId', v_order.invoice_id, 'invoiceNumber', v_invoice_number);
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Order % is cancelled and cannot be invoiced.', v_order.order_number
      USING ERRCODE = '23514';
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_order.currency IS DISTINCT FROM v_base_currency THEN
    RAISE EXCEPTION 'Order % is in %, but the books are kept in %; it cannot be invoiced as it stands.',
      v_order.order_number, v_order.currency, v_base_currency USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'description', line.description || ' (' || trim_scale(line.quantity)::TEXT || ' x '
      || to_char(line.unit_price_cents / 100.0, 'FM999,999,999,990.00') || ')',
    'accountId', line.account_id,
    'amountCents', line.amount_cents,
    'taxCents', line.tax_cents
  ) ORDER BY line.line_position)
  INTO v_lines
  FROM public.sales_order_lines AS line
  WHERE line.org_id = p_org_id AND line.order_id = p_order_id;

  v_invoice_id := public.create_invoice_with_journal(
    p_org_id, v_order.customer_id, p_issue_date, p_due_date, v_order.currency, 1,
    'Order ' || v_order.order_number || COALESCE(E'\n' || v_order.notes, ''),
    p_created_by, v_lines, 'sales-order:' || p_order_id::TEXT
  );

  UPDATE public.sales_orders AS sales_order
  SET invoice_id = v_invoice_id, updated_at = now()
  WHERE sales_order.org_id = p_org_id AND sales_order.id = p_order_id;

  SELECT invoice.invoice_number INTO v_invoice_number
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = v_invoice_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'UPDATE', 'SALES_ORDER', p_order_id,
    jsonb_build_object('orderNumber', v_order.order_number, 'invoiceId', v_invoice_id,
      'invoiceNumber', v_invoice_number)
  );

  RETURN jsonb_build_object('invoiceId', v_invoice_id, 'invoiceNumber', v_invoice_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_sales_order(UUID, UUID, DATE, DATE, TEXT, UUID, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_sales_order_status(UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_sales_order(UUID, UUID, DATE, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_order(UUID, UUID, DATE, DATE, TEXT, UUID, JSONB, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_sales_order_status(UUID, UUID, TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.invoice_sales_order(UUID, UUID, DATE, DATE, UUID)
  TO service_role;

-- Rollback, in dependency order:
-- DROP FUNCTION public.invoice_sales_order(UUID, UUID, DATE, DATE, UUID);
-- DROP FUNCTION public.set_sales_order_status(UUID, UUID, TEXT, TEXT, UUID);
-- DROP FUNCTION public.create_sales_order(UUID, UUID, DATE, DATE, TEXT, UUID, JSONB, TEXT);
-- DROP TABLE public.sales_order_lines;
-- DROP TABLE public.sales_orders;
-- DELETE FROM public.document_counters WHERE doc_type = 'SALES_ORDER';
-- Then re-run private.next_document_number from
-- 20260917172909_add_atomic_financial_workflows.sql (INVOICE and BILL only).
