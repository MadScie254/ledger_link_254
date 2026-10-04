-- Purchase orders: what was ordered from a supplier, before the bill comes.
--
-- An order does not post to the books. When the goods and the supplier's
-- bill arrive, the order becomes a bill for everything still outstanding or
-- for the quantities received so far; the bill posts as any bill does and
-- counts stock items in. An order is billed in full, or closed with what is
-- left unbilled, or cancelled before anything was billed. Voiding a bill made
-- from an order puts its quantities back on the order.

CREATE TABLE public.purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number          TEXT NOT NULL,
  vendor_id       UUID NOT NULL,
  order_date      DATE NOT NULL,
  expected_date   DATE,
  memo            TEXT,
  currency        TEXT NOT NULL,
  subtotal_cents  BIGINT NOT NULL,
  tax_cents       BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN',
  closed_at       TIMESTAMPTZ,
  closed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  close_reason    TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  CONSTRAINT purchase_orders_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT purchase_orders_org_number_key UNIQUE (org_id, number),
  CONSTRAINT purchase_orders_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT purchase_orders_status_check CHECK (status IN ('OPEN', 'BILLED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT purchase_orders_amounts_check
    CHECK (subtotal_cents > 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents),
  CONSTRAINT purchase_orders_dates_check CHECK (expected_date IS NULL OR expected_date >= order_date),
  CONSTRAINT purchase_orders_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT purchase_orders_text_check CHECK (
    (memo IS NULL OR length(memo) <= 4000) AND (close_reason IS NULL OR length(close_reason) <= 500)
  ),
  CONSTRAINT purchase_orders_org_vendor_fkey FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.vendors(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.purchase_order_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  purchase_order_id UUID NOT NULL,
  line_position     INTEGER NOT NULL,
  description       TEXT NOT NULL,
  account_id        UUID NOT NULL,
  inventory_item_id UUID,
  quantity          NUMERIC(16, 3) NOT NULL,
  unit_cost_cents   BIGINT NOT NULL,
  tax_rate          NUMERIC(5, 2) NOT NULL DEFAULT 0,
  amount_cents      BIGINT NOT NULL,
  tax_cents         BIGINT NOT NULL DEFAULT 0,
  quantity_billed   NUMERIC(16, 3) NOT NULL DEFAULT 0,
  CONSTRAINT purchase_order_lines_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT purchase_order_lines_position_key UNIQUE (purchase_order_id, line_position),
  CONSTRAINT purchase_order_lines_parent_fkey FOREIGN KEY (org_id, purchase_order_id)
    REFERENCES public.purchase_orders(org_id, id) ON DELETE CASCADE,
  CONSTRAINT purchase_order_lines_account_fkey FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_order_lines_item_fkey FOREIGN KEY (org_id, inventory_item_id)
    REFERENCES public.inventory_items(org_id, id) ON DELETE SET NULL (inventory_item_id),
  CONSTRAINT purchase_order_lines_amounts_check CHECK (
    quantity > 0 AND unit_cost_cents >= 0 AND amount_cents > 0 AND tax_cents >= 0
    AND tax_rate >= 0 AND tax_rate <= 100
  ),
  CONSTRAINT purchase_order_lines_billed_check CHECK (quantity_billed >= 0 AND quantity_billed <= quantity)
);

CREATE INDEX idx_purchase_orders_org_date ON public.purchase_orders(org_id, order_date DESC);
CREATE INDEX idx_purchase_orders_vendor ON public.purchase_orders(org_id, vendor_id);
CREATE INDEX idx_purchase_order_lines_parent ON public.purchase_order_lines(purchase_order_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_select_policy ON public.purchase_orders
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY purchase_order_lines_select_policy ON public.purchase_order_lines
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.purchase_orders, public.purchase_order_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_orders, public.purchase_order_lines TO service_role;

-- Which order a bill, and each of its lines, came from.
ALTER TABLE public.bills ADD COLUMN purchase_order_id UUID;
ALTER TABLE public.bills ADD CONSTRAINT bills_org_purchase_order_fkey
  FOREIGN KEY (org_id, purchase_order_id) REFERENCES public.purchase_orders(org_id, id) ON DELETE RESTRICT;
ALTER TABLE public.bill_lines ADD COLUMN purchase_order_line_id UUID;
ALTER TABLE public.bill_lines ADD CONSTRAINT bill_lines_org_purchase_order_line_fkey
  FOREIGN KEY (org_id, purchase_order_line_id) REFERENCES public.purchase_order_lines(org_id, id) ON DELETE RESTRICT;
CREATE INDEX idx_bills_purchase_order ON public.bills(org_id, purchase_order_id) WHERE purchase_order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Write or rewrite an order. Lines carry a quantity, a unit cost and a
-- VAT rate; amounts are worked out here. Only an order nothing has been
-- billed from can be rewritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_purchase_order(
  p_org_id UUID,
  p_purchase_order_id UUID,
  p_vendor_id UUID,
  p_order_date DATE,
  p_expected_date DATE,
  p_memo TEXT,
  p_lines JSONB,
  p_actor UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing RECORD;
  v_line JSONB;
  v_position INTEGER := 0;
  v_quantity NUMERIC;
  v_unit_cost BIGINT;
  v_tax_rate NUMERIC;
  v_amount BIGINT;
  v_costed JSONB := '[]'::JSONB;
  v_prepared JSONB;
  v_id UUID;
  v_number TEXT;
  v_subtotal BIGINT;
  v_tax BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_order_date IS NULL THEN
    RAISE EXCEPTION 'The order date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_date IS NOT NULL AND p_expected_date < p_order_date THEN
    RAISE EXCEPTION 'The expected date cannot be before the order date.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.vendors AS vendor WHERE vendor.org_id = p_org_id AND vendor.id = p_vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor does not belong to this organization.' USING ERRCODE = '23503';
  END IF;

  IF p_purchase_order_id IS NULL THEN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
      RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_org_id::TEXT || ':purchase-order:' || p_idempotency_key, 0)
    );
    SELECT po.id, po.number, po.total_cents INTO v_existing
    FROM public.purchase_orders AS po
    WHERE po.org_id = p_org_id AND po.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'totalCents', v_existing.total_cents);
    END IF;
  ELSE
    SELECT po.* INTO v_existing FROM public.purchase_orders AS po
    WHERE po.org_id = p_org_id AND po.id = p_purchase_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase order not found in this organization.' USING ERRCODE = '23503';
    END IF;
    IF v_existing.status <> 'OPEN' OR EXISTS (
      SELECT 1 FROM public.purchase_order_lines AS line
      WHERE line.purchase_order_id = p_purchase_order_id AND line.quantity_billed > 0
    ) THEN
      RAISE EXCEPTION 'Purchase order % has been billed or closed, so it can no longer be changed.', v_existing.number
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'A purchase order needs between 1 and 200 lines.' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;
    BEGIN
      v_quantity := (v_line->>'quantity')::NUMERIC;
      v_unit_cost := (v_line->>'unitCostCents')::BIGINT;
      v_tax_rate := COALESCE(NULLIF(v_line->>'taxRate', '')::NUMERIC, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000000000 OR v_quantity <> round(v_quantity, 3) THEN
      RAISE EXCEPTION 'Line % quantity must be above zero with at most three decimals.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Line % unit cost must be zero or more, in whole cents.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 OR v_tax_rate <> round(v_tax_rate, 2) THEN
      RAISE EXCEPTION 'Line % VAT rate must be between 0 and 100 with at most two decimals.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_quantity * v_unit_cost > 900000000000000 THEN
      RAISE EXCEPTION 'Line % is too large to record.', v_position USING ERRCODE = '22023';
    END IF;
    v_amount := round(v_quantity * v_unit_cost)::BIGINT;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Line % comes to nothing; give it a cost.', v_position USING ERRCODE = '22023';
    END IF;
    v_costed := v_costed || jsonb_build_array(v_line || jsonb_build_object(
      'amountCents', v_amount, 'taxCents', round(v_amount * v_tax_rate / 100)::BIGINT,
      'quantity', v_quantity, 'unitPriceCents', v_unit_cost, 'taxRate', v_tax_rate));
  END LOOP;
  -- Accounts, stock items and whole units are checked as for any purchase.
  v_prepared := private.prepare_purchase_lines(p_org_id, v_costed, 'purchase order');
  v_subtotal := (v_prepared->>'subtotal')::BIGINT;
  v_tax := (v_prepared->>'tax')::BIGINT;

  IF p_purchase_order_id IS NULL THEN
    v_id := gen_random_uuid();
    v_number := 'PO-' || to_char(p_order_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'PURCHASE_ORDER')::TEXT, 5, '0');
    INSERT INTO public.purchase_orders (
      id, org_id, number, vendor_id, order_date, expected_date, memo, currency,
      subtotal_cents, tax_cents, total_cents, created_by, idempotency_key
    )
    SELECT v_id, p_org_id, v_number, p_vendor_id, p_order_date, p_expected_date,
           NULLIF(btrim(COALESCE(p_memo, '')), ''), upper(org.base_currency),
           v_subtotal, v_tax, v_subtotal + v_tax, p_actor, p_idempotency_key
    FROM public.organizations AS org WHERE org.id = p_org_id;
  ELSE
    v_id := p_purchase_order_id;
    v_number := v_existing.number;
    UPDATE public.purchase_orders
    SET vendor_id = p_vendor_id, order_date = p_order_date, expected_date = p_expected_date,
        memo = NULLIF(btrim(COALESCE(p_memo, '')), ''), subtotal_cents = v_subtotal, tax_cents = v_tax,
        total_cents = v_subtotal + v_tax, updated_at = now()
    WHERE org_id = p_org_id AND id = v_id;
    DELETE FROM public.purchase_order_lines WHERE org_id = p_org_id AND purchase_order_id = v_id;
  END IF;

  INSERT INTO public.purchase_order_lines (
    org_id, purchase_order_id, line_position, description, account_id, inventory_item_id,
    quantity, unit_cost_cents, tax_rate, amount_cents, tax_cents
  )
  SELECT p_org_id, v_id, (line->>'position')::INTEGER, line->>'description', (line->>'accountId')::UUID,
         NULLIF(line->>'itemId', '')::UUID, (line->>'quantity')::NUMERIC, (line->>'unitPrice')::BIGINT,
         (costed.value->>'taxRate')::NUMERIC, (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line)
  JOIN jsonb_array_elements(v_costed) WITH ORDINALITY AS costed(value, ordinal)
    ON costed.ordinal = (line->>'position')::INTEGER;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, CASE WHEN p_purchase_order_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END, 'PURCHASE_ORDER', v_id,
    jsonb_build_object('number', v_number, 'totalCents', v_subtotal + v_tax));

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', v_subtotal + v_tax);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Close an order with what is left unbilled (cancelled, if nothing was),
-- or reopen a closed one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_purchase_order_status(
  p_org_id UUID,
  p_purchase_order_id UUID,
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
  v_po RECORD;
  v_billed BOOLEAN;
  v_outstanding BOOLEAN;
  v_status TEXT;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_status NOT IN ('OPEN', 'CLOSED') THEN
    RAISE EXCEPTION 'A purchase order is closed or reopened.' USING ERRCODE = '22023';
  END IF;
  SELECT po.* INTO v_po FROM public.purchase_orders AS po
  WHERE po.org_id = p_org_id AND po.id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found in this organization.' USING ERRCODE = '23503';
  END IF;
  SELECT bool_or(line.quantity_billed > 0), bool_or(line.quantity_billed < line.quantity)
  INTO v_billed, v_outstanding
  FROM public.purchase_order_lines AS line WHERE line.purchase_order_id = p_purchase_order_id;

  IF p_status = 'CLOSED' THEN
    IF v_po.status <> 'OPEN' THEN
      RETURN jsonb_build_object('number', v_po.number, 'status', v_po.status);
    END IF;
    IF v_reason IS NULL OR length(v_reason) > 500 THEN
      RAISE EXCEPTION 'Give a reason for closing the order, in 500 characters or fewer.' USING ERRCODE = '22023';
    END IF;
    v_status := CASE WHEN COALESCE(v_billed, false) THEN 'CLOSED' ELSE 'CANCELLED' END;
    UPDATE public.purchase_orders
    SET status = v_status, closed_at = now(), closed_by = p_actor, close_reason = v_reason, updated_at = now()
    WHERE org_id = p_org_id AND id = p_purchase_order_id;
  ELSE
    IF v_po.status = 'OPEN' THEN
      RETURN jsonb_build_object('number', v_po.number, 'status', 'OPEN');
    END IF;
    IF NOT COALESCE(v_outstanding, false) THEN
      RAISE EXCEPTION 'Everything on % has been billed.', v_po.number USING ERRCODE = '23514';
    END IF;
    v_status := 'OPEN';
    UPDATE public.purchase_orders
    SET status = 'OPEN', closed_at = NULL, closed_by = NULL, close_reason = NULL, updated_at = now()
    WHERE org_id = p_org_id AND id = p_purchase_order_id;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'STATUS', 'PURCHASE_ORDER', p_purchase_order_id,
    jsonb_build_object('number', v_po.number, 'from', v_po.status, 'to', v_status, 'reason', v_reason));

  RETURN jsonb_build_object('number', v_po.number, 'status', v_status);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Bill an order: everything still outstanding, or the quantities given
-- per line ([{"position": 1, "quantity": 4}, ...]). The bill posts and
-- counts stock in as any bill does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bill_purchase_order(
  p_org_id UUID,
  p_purchase_order_id UUID,
  p_bill_date DATE,
  p_due_date DATE,
  p_supplier_reference TEXT,
  p_quantities JSONB,
  p_actor UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_po RECORD;
  v_line RECORD;
  v_existing UUID;
  v_quantity NUMERIC;
  v_amount BIGINT;
  v_lines JSONB := '[]'::JSONB;
  v_line_ids UUID[] := ARRAY[]::UUID[];
  v_quantities NUMERIC[] := ARRAY[]::NUMERIC[];
  v_bill_id UUID;
  v_bill_number TEXT;
  v_status TEXT;
  v_index INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  SELECT po.* INTO v_po FROM public.purchase_orders AS po
  WHERE po.org_id = p_org_id AND po.id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found in this organization.' USING ERRCODE = '23503';
  END IF;

  -- A retry returns the bill made the first time.
  SELECT bill.id, bill.bill_number INTO v_existing, v_bill_number
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id AND bill.idempotency_key = 'po:' || p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('billId', v_existing, 'billNumber', v_bill_number, 'status', v_po.status);
  END IF;

  IF v_po.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Purchase order % is %; reopen it to bill it.', v_po.number, lower(v_po.status) USING ERRCODE = '23514';
  END IF;
  IF p_quantities IS NOT NULL AND jsonb_typeof(p_quantities) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Quantities are a list of lines and quantities.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT line.*, item.type AS item_type
    FROM public.purchase_order_lines AS line
    LEFT JOIN public.inventory_items AS item ON item.org_id = line.org_id AND item.id = line.inventory_item_id
    WHERE line.purchase_order_id = p_purchase_order_id
    ORDER BY line.line_position
    FOR UPDATE OF line
  LOOP
    IF p_quantities IS NULL THEN
      v_quantity := v_line.quantity - v_line.quantity_billed;
    ELSE
      BEGIN
        SELECT COALESCE(sum((entry->>'quantity')::NUMERIC), 0) INTO v_quantity
        FROM jsonb_array_elements(p_quantities) AS given(entry)
        WHERE (entry->>'position')::INTEGER = v_line.line_position;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Line % has an invalid quantity.', v_line.line_position USING ERRCODE = '22023';
      END;
    END IF;
    CONTINUE WHEN v_quantity = 0;
    IF v_quantity < 0 OR v_quantity <> round(v_quantity, 3) THEN
      RAISE EXCEPTION 'Line % quantity must be above zero with at most three decimals.', v_line.line_position USING ERRCODE = '22023';
    END IF;
    IF v_quantity > v_line.quantity - v_line.quantity_billed THEN
      RAISE EXCEPTION 'Line % has % left to bill.', v_line.line_position, trim_scale(v_line.quantity - v_line.quantity_billed)
        USING ERRCODE = '23514';
    END IF;
    IF v_line.inventory_item_id IS NOT NULL AND COALESCE(v_line.item_type, '') NOT ILIKE '%service%'
       AND v_quantity <> trunc(v_quantity) THEN
      RAISE EXCEPTION 'Line %: stock is counted in whole units.', v_line.line_position USING ERRCODE = '22023';
    END IF;
    -- The last of a line takes what is left of its amount, so the bills add up to the order.
    v_amount := CASE WHEN v_quantity = v_line.quantity - v_line.quantity_billed
      THEN v_line.amount_cents - round(v_line.quantity_billed * v_line.unit_cost_cents)::BIGINT
      ELSE round(v_quantity * v_line.unit_cost_cents)::BIGINT END;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Line % comes to nothing at that quantity.', v_line.line_position USING ERRCODE = '22023';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_line.description, 'accountId', v_line.account_id,
      'amountCents', v_amount, 'taxCents', round(v_amount * v_line.tax_rate / 100)::BIGINT,
      'inventoryItemId', v_line.inventory_item_id, 'quantity', v_quantity));
    v_line_ids := v_line_ids || v_line.id;
    v_quantities := v_quantities || v_quantity;
  END LOOP;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Enter a quantity to bill on at least one line.' USING ERRCODE = '22023';
  END IF;

  v_bill_id := public.create_bill_with_journal(
    p_org_id, v_po.vendor_id, p_bill_date, p_due_date, v_po.currency, 1,
    'Purchase order ' || v_po.number || COALESCE(E'\n' || v_po.memo, ''),
    p_actor, v_lines, 'po:' || p_idempotency_key, p_supplier_reference
  );

  UPDATE public.bills SET purchase_order_id = p_purchase_order_id WHERE org_id = p_org_id AND id = v_bill_id;
  FOR v_index IN 1 .. array_length(v_line_ids, 1)
  LOOP
    UPDATE public.bill_lines SET purchase_order_line_id = v_line_ids[v_index]
    WHERE org_id = p_org_id AND bill_id = v_bill_id AND line_position = v_index;
    UPDATE public.purchase_order_lines SET quantity_billed = quantity_billed + v_quantities[v_index]
    WHERE org_id = p_org_id AND id = v_line_ids[v_index];
  END LOOP;

  v_status := CASE WHEN EXISTS (
    SELECT 1 FROM public.purchase_order_lines AS line
    WHERE line.purchase_order_id = p_purchase_order_id AND line.quantity_billed < line.quantity
  ) THEN 'OPEN' ELSE 'BILLED' END;
  UPDATE public.purchase_orders SET status = v_status, updated_at = now()
  WHERE org_id = p_org_id AND id = p_purchase_order_id;

  SELECT bill.bill_number INTO v_bill_number FROM public.bills AS bill WHERE bill.org_id = p_org_id AND bill.id = v_bill_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'BILL', 'PURCHASE_ORDER', p_purchase_order_id,
    jsonb_build_object('number', v_po.number, 'billId', v_bill_id, 'billNumber', v_bill_number, 'status', v_status));

  RETURN jsonb_build_object('billId', v_bill_id, 'billNumber', v_bill_number, 'status', v_status);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Voiding a bill made from an order puts its quantities back on the
-- order, which is open again if it had been billed in full. Otherwise as in
-- 20261005000400.
-- ---------------------------------------------------------------------------
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
  v_released BIGINT;
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

  -- Credits applied to it go back to their credit notes, unused.
  v_released := private.release_credit_applications(p_org_id, 'BILL', p_bill_id,
    'Bill ' || v_bill.bill_number || ' voided', p_created_by);

  -- What this bill took off a purchase order is due on that order again.
  UPDATE public.purchase_order_lines AS po_line
  SET quantity_billed = po_line.quantity_billed - line.quantity
  FROM public.bill_lines AS line
  WHERE line.org_id = p_org_id AND line.bill_id = p_bill_id
    AND po_line.org_id = p_org_id AND po_line.id = line.purchase_order_line_id;
  UPDATE public.purchase_orders AS po
  SET status = 'OPEN', updated_at = now()
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id AND bill.id = p_bill_id
    AND po.org_id = p_org_id AND po.id = bill.purchase_order_id AND po.status = 'BILLED';

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
    jsonb_build_object('reversalJournalEntryId', v_reversal_id, 'releasedCreditCents', v_released)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_purchase_order(UUID, UUID, UUID, DATE, DATE, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_purchase_order_status(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bill_purchase_order(UUID, UUID, DATE, DATE, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_purchase_order(UUID, UUID, UUID, DATE, DATE, TEXT, JSONB, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_purchase_order_status(UUID, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.bill_purchase_order(UUID, UUID, DATE, DATE, TEXT, JSONB, UUID, TEXT) TO service_role;

-- Rollback: restore void_bill_with_reversal from 20261005000400; drop the
-- three public functions above, the added columns and constraints on bills
-- and bill_lines, then public.purchase_order_lines and public.purchase_orders.
