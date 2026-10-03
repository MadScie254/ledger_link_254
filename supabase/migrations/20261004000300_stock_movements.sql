-- Stock movements.
--
-- quantity_on_hand was a single number that anyone with a write role could
-- overwrite (PATCH /api/inventory/:id) with no record of who, when or why,
-- and reopening a sales order put stock back according to the item's type at
-- that moment rather than what the order had actually counted out. Every
-- change to a stock count is now a row in inventory_movements, and the count
-- itself can change only through private.move_stock:
--   * OPENING     the quantity an item is created with (and, for existing
--                 items, the quantity on hand when this migration ran);
--   * ADJUSTMENT  a stock count or correction, with a reason
--                 (public.adjust_stock);
--   * SALES_ORDER an order completed (out) or reopened (back in).
-- Stock movements do not post to the ledger: inventory value is not yet kept
-- in the books (see PRODUCT.md).

CREATE TABLE public.inventory_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL,
  quantity        INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL,
  source_type     TEXT NOT NULL,
  source_id       UUID,
  note            TEXT,
  idempotency_key TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_org_item_fkey FOREIGN KEY (org_id, item_id)
    REFERENCES public.inventory_items(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_quantity_check CHECK (quantity <> 0),
  CONSTRAINT inventory_movements_source_type_check CHECK (source_type ~ '^[A-Z_]{3,40}$'),
  CONSTRAINT inventory_movements_note_length_check CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX idx_inventory_movements_org_item ON public.inventory_movements(org_id, item_id, created_at);
CREATE INDEX idx_inventory_movements_source ON public.inventory_movements(org_id, source_type, source_id);
CREATE UNIQUE INDEX inventory_movements_org_idempotency_key
  ON public.inventory_movements(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_movements_select_policy ON public.inventory_movements
  FOR SELECT TO authenticated USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.inventory_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.inventory_movements TO service_role;

DROP TRIGGER IF EXISTS inventory_movements_permanent ON public.inventory_movements;
CREATE TRIGGER inventory_movements_permanent
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

-- What is on hand today, recorded as the opening movement.
INSERT INTO public.inventory_movements (org_id, item_id, quantity, quantity_after, source_type, note)
SELECT item.org_id, item.id, item.quantity_on_hand, item.quantity_on_hand, 'OPENING', 'Quantity on hand when movements began'
FROM public.inventory_items AS item
WHERE COALESCE(item.quantity_on_hand, 0) <> 0;

UPDATE public.inventory_items SET quantity_on_hand = 0 WHERE quantity_on_hand IS NULL;
ALTER TABLE public.inventory_items
  ALTER COLUMN quantity_on_hand SET DEFAULT 0,
  ALTER COLUMN quantity_on_hand SET NOT NULL;

-- The one way a stock count changes.
CREATE OR REPLACE FUNCTION private.move_stock(
  p_org_id UUID,
  p_item_id UUID,
  p_quantity INTEGER,
  p_source_type TEXT,
  p_source_id UUID,
  p_note TEXT,
  p_actor UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_after INTEGER;
BEGIN
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'A stock movement needs a quantity other than zero.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('ledger.stock_movement', 'on', true);
  UPDATE public.inventory_items AS item
  SET quantity_on_hand = item.quantity_on_hand + p_quantity
  WHERE item.org_id = p_org_id AND item.id = p_item_id
  RETURNING item.quantity_on_hand INTO v_after;
  PERFORM set_config('ledger.stock_movement', '', true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found in this organization.' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.inventory_movements (
    org_id, item_id, quantity, quantity_after, source_type, source_id, note, idempotency_key, created_by
  ) VALUES (
    p_org_id, p_item_id, p_quantity, v_after, p_source_type, p_source_id,
    NULLIF(btrim(COALESCE(p_note, '')), ''), p_idempotency_key, p_actor
  );
  RETURN v_after;
END;
$function$;

REVOKE ALL ON FUNCTION private.move_stock(UUID, UUID, INTEGER, TEXT, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- A stock count can be set only by private.move_stock.
CREATE OR REPLACE FUNCTION private.guard_stock_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand
     AND current_setting('ledger.stock_movement', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Stock counts change only through a stock adjustment or an order, so every change is recorded.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_stock_count() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS inventory_items_guard_stock_count ON public.inventory_items;
CREATE TRIGGER inventory_items_guard_stock_count
  BEFORE UPDATE OF quantity_on_hand ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_stock_count();

-- A new item's starting quantity is its opening movement.
CREATE OR REPLACE FUNCTION private.record_opening_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(NEW.quantity_on_hand, 0) <> 0 THEN
    INSERT INTO public.inventory_movements (org_id, item_id, quantity, quantity_after, source_type, note, created_by)
    VALUES (NEW.org_id, NEW.id, NEW.quantity_on_hand, NEW.quantity_on_hand, 'OPENING', 'Quantity the item was created with',
      private.request_actor());
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_opening_stock() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS inventory_items_opening_stock ON public.inventory_items;
CREATE TRIGGER inventory_items_opening_stock
  AFTER INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION private.record_opening_stock();

-- A stock count or correction: the counted quantity and why. A retry with
-- the same key returns the first adjustment.
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id UUID,
  p_item_id UUID,
  p_counted_quantity INTEGER,
  p_reason TEXT,
  p_actor UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item RECORD;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_existing RECORD;
  v_after INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':stock:' || p_idempotency_key, 0)
  );
  SELECT movement.quantity, movement.quantity_after INTO v_existing
  FROM public.inventory_movements AS movement
  WHERE movement.org_id = p_org_id AND movement.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('quantity', v_existing.quantity, 'quantityOnHand', v_existing.quantity_after);
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for the adjustment, such as a stock count or damaged goods.' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'The reason must be 500 characters or fewer.' USING ERRCODE = '22023';
  END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 OR p_counted_quantity > 1000000000 THEN
    RAISE EXCEPTION 'The counted quantity must be a whole number from 0 up.' USING ERRCODE = '22023';
  END IF;

  SELECT item.id, item.name, item.quantity_on_hand INTO v_item
  FROM public.inventory_items AS item
  WHERE item.org_id = p_org_id AND item.id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock item not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF p_counted_quantity = v_item.quantity_on_hand THEN
    RETURN jsonb_build_object('quantity', 0, 'quantityOnHand', v_item.quantity_on_hand);
  END IF;

  v_after := private.move_stock(p_org_id, p_item_id, p_counted_quantity - v_item.quantity_on_hand,
    'ADJUSTMENT', NULL, v_reason, p_actor, p_idempotency_key);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'ADJUST', 'INVENTORY_ITEM', p_item_id,
    jsonb_build_object('name', v_item.name, 'from', v_item.quantity_on_hand, 'to', v_after, 'reason', v_reason));

  RETURN jsonb_build_object('quantity', p_counted_quantity - v_item.quantity_on_hand, 'quantityOnHand', v_after);
END;
$function$;

REVOKE ALL ON FUNCTION public.adjust_stock(UUID, UUID, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, UUID, INTEGER, TEXT, UUID, TEXT) TO service_role;

-- Sales orders: status changes move stock through private.move_stock, and an
-- order whose invoice was voided can be invoiced again.
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

  -- Completing counts each stocked line out, recorded as a movement against
  -- the order. Reopening reverses exactly what this order moved, whatever the
  -- items' types are now, so changing an item never creates or loses stock.
  IF v_target = 'COMPLETED' THEN
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
      v_on_hand := private.move_stock(p_org_id, v_line.item_id, -v_line.quantity,
        'SALES_ORDER', p_order_id, 'Order ' || v_order.order_number || ' completed', p_actor);
      v_stock := v_stock || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.item_id, 'name', v_line.name,
        'quantity', -v_line.quantity, 'quantityOnHand', v_on_hand
      ));
    END LOOP;
  ELSIF v_order.status = 'COMPLETED' THEN
    FOR v_line IN
      SELECT movement.item_id, item.name, sum(movement.quantity)::INTEGER AS quantity
      FROM public.inventory_movements AS movement
      JOIN public.inventory_items AS item
        ON item.org_id = movement.org_id AND item.id = movement.item_id
      WHERE movement.org_id = p_org_id AND movement.source_type = 'SALES_ORDER'
        AND movement.source_id = p_order_id
      GROUP BY movement.item_id, item.name
      HAVING sum(movement.quantity) <> 0
      ORDER BY item.name
    LOOP
      v_on_hand := private.move_stock(p_org_id, v_line.item_id, -v_line.quantity,
        'SALES_ORDER', p_order_id, 'Order ' || v_order.order_number || ' reopened', p_actor);
      v_stock := v_stock || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.item_id, 'name', v_line.name,
        'quantity', -v_line.quantity, 'quantityOnHand', v_on_hand
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
  v_previous_status TEXT;
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

  -- Already invoiced: return that invoice rather than raising a second one,
  -- unless it was voided, in which case the order is invoiced afresh.
  IF v_order.invoice_id IS NOT NULL THEN
    SELECT invoice.invoice_number, invoice.status INTO v_invoice_number, v_previous_status
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = v_order.invoice_id;
    IF v_previous_status IS DISTINCT FROM 'VOID' THEN
      RETURN jsonb_build_object('invoiceId', v_order.invoice_id, 'invoiceNumber', v_invoice_number);
    END IF;
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
    p_created_by, v_lines,
    'sales-order:' || p_order_id::TEXT || COALESCE(':after:' || v_order.invoice_id::TEXT, '')
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

-- Rollback: re-run set_sales_order_status and invoice_sales_order from
-- 20261003000000_add_sales_orders.sql, drop public.adjust_stock, the two
-- inventory_items triggers, the private functions above, and
-- public.inventory_movements.
