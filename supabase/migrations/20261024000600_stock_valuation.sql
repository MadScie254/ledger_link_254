-- Stock value in the books: weighted average cost, perpetual.
--
-- Until now stock was counted but not valued: a bill line for a stock item
-- posted to whatever account the person chose (usually cost of sales), and
-- selling stock posted no cost of goods sold, so gross profit was overstated
-- for any business that sells goods and the Inventory Asset account never
-- moved.
--
-- An owner or admin now turns on stock valuation from a date
-- (public.start_stock_valuation). The stock on hand that day is valued at
-- each item's cost and posted Dr Inventory, Cr Opening Balance Equity (3050).
-- From then on every stock movement carries a value, and one journal entry
-- per movement keeps the books in step, through a trigger on
-- inventory_movements, so the document functions are not changed:
--   * bought in (BILL, EXPENSE): valued at the line's net cost in the base
--     currency; the line's account is moved to Inventory (Dr Inventory,
--     Cr the line's account; nothing to post when the line already used it);
--   * sold or written down (SALES_ORDER, SALES_RECEIPT, ADJUSTMENT out):
--     valued at the item's average cost, Dr Cost of Goods Sold, Cr Inventory;
--   * returned by a customer (CREDIT_NOTE) or counted up (ADJUSTMENT in):
--     at average cost, Dr Inventory, Cr Cost of Goods Sold;
--   * sent back to the supplier (SUPPLIER_CREDIT): at the line's cost,
--     Dr the line's account, Cr Inventory;
--   * a new item's opening quantity (OPENING): at its cost price,
--     Dr Inventory, Cr Opening Balance Equity;
--   * a void or reopening that undoes what a document moved: the exact value
--     the document moved, reversed.
-- Organizations that have not turned it on keep the old behaviour.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN stock_valuation_from DATE,
  ADD COLUMN stock_valuation_entry_id UUID;

ALTER TABLE public.inventory_items
  ADD COLUMN stock_value_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.inventory_movements
  ADD COLUMN value_cents BIGINT,
  ADD COLUMN value_after_cents BIGINT,
  ADD COLUMN valued_on DATE,
  ADD COLUMN inventory_account_id UUID,
  ADD COLUMN offset_account_id UUID,
  ADD COLUMN journal_entry_id UUID;

INSERT INTO public.accounts (org_id, code, name, type, currency)
SELECT id, '3050', 'Opening Balance Equity', 'EQUITY', upper(base_currency)
FROM public.organizations
ON CONFLICT (org_id, code) DO NOTHING;

-- A stock value changes only with a movement, as a count does.
CREATE OR REPLACE FUNCTION private.guard_stock_value()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.stock_value_cents IS DISTINCT FROM OLD.stock_value_cents
     AND current_setting('ledger.stock_value', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Stock value changes only through a stock movement, so every change is posted.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_stock_value() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER inventory_items_guard_stock_value
  BEFORE UPDATE OF stock_value_cents ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_stock_value();

-- ---------------------------------------------------------------------------
-- 2. Accounts
-- ---------------------------------------------------------------------------

-- The organization's account with this code, created as a system account
-- when the chart lacks it.
CREATE OR REPLACE FUNCTION private.stock_account(p_org_id UUID, p_code TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_id UUID;
  v_currency TEXT;
BEGIN
  SELECT account.id INTO v_id FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = p_code AND account.is_active;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND code = p_code) THEN
    RAISE EXCEPTION 'Account % is inactive. Reactivate it before valuing stock.', p_code USING ERRCODE = '23514';
  END IF;
  SELECT upper(base_currency) INTO v_currency FROM public.organizations WHERE id = p_org_id;
  INSERT INTO public.accounts (org_id, code, name, type, currency)
  VALUES (p_org_id, p_code,
    CASE p_code WHEN '1200' THEN 'Inventory Asset' WHEN '5000' THEN 'Cost of Goods Sold (COGS)' ELSE 'Opening Balance Equity' END,
    (CASE p_code WHEN '1200' THEN 'ASSET' WHEN '5000' THEN 'COGS' ELSE 'EQUITY' END)::public.account_type, v_currency)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.stock_account(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- An item's inventory and cost-of-sales accounts: its own when they are
-- active accounts of the right type in this organization, else 1200 and 5000.
CREATE OR REPLACE FUNCTION private.item_stock_accounts(p_org_id UUID, p_item_id UUID,
  OUT inventory_account_id UUID, OUT cogs_account_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  SELECT account.id INTO inventory_account_id
  FROM public.inventory_items AS item
  JOIN public.accounts AS account ON account.org_id = item.org_id AND account.id = item.asset_account_id
  WHERE item.org_id = p_org_id AND item.id = p_item_id AND account.type = 'ASSET' AND account.is_active
    AND NOT account.is_bank_account;
  SELECT account.id INTO cogs_account_id
  FROM public.inventory_items AS item
  JOIN public.accounts AS account ON account.org_id = item.org_id AND account.id = item.cogs_account_id
  WHERE item.org_id = p_org_id AND item.id = p_item_id AND account.type IN ('COGS', 'EXPENSE') AND account.is_active;
  inventory_account_id := COALESCE(inventory_account_id, private.stock_account(p_org_id, '1200'));
  cogs_account_id := COALESCE(cogs_account_id, private.stock_account(p_org_id, '5000'));
END;
$function$;
REVOKE ALL ON FUNCTION private.item_stock_accounts(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Valuing each movement
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.value_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_from DATE;
  v_time_zone TEXT;
  v_today DATE;
  v_item RECORD;
  v_accounts RECORD;
  v_before_qty INTEGER;
  v_before_value BIGINT;
  v_earlier RECORD;
  v_position INTEGER;
  v_line_amount BIGINT;
  v_line_account UUID;
  v_line_date DATE;
  v_unit NUMERIC;
  v_lines JSONB := '[]'::JSONB;
  v_offset RECORD;
  v_memo TEXT;
BEGIN
  SELECT org.stock_valuation_from, COALESCE(org.time_zone, 'Africa/Nairobi') INTO v_from, v_time_zone
  FROM public.organizations AS org WHERE org.id = NEW.org_id;
  IF v_from IS NULL THEN
    RETURN NEW;
  END IF;
  v_today := (now() AT TIME ZONE v_time_zone)::DATE;

  SELECT item.name, item.quantity_on_hand, item.stock_value_cents, COALESCE(item.cost_price_cents, 0) AS cost_price_cents
  INTO v_item
  FROM public.inventory_items AS item
  WHERE item.org_id = NEW.org_id AND item.id = NEW.item_id
  FOR UPDATE;
  -- The count has already moved (private.move_stock, or the item's insert).
  v_before_qty := NEW.quantity_after - NEW.quantity;
  v_before_value := v_item.stock_value_cents;
  SELECT * INTO v_accounts FROM private.item_stock_accounts(NEW.org_id, NEW.item_id);
  NEW.inventory_account_id := v_accounts.inventory_account_id;

  -- What this document has already moved for this item.
  SELECT COALESCE(sum(movement.quantity), 0)::INTEGER AS quantity,
         sum(movement.value_cents)::BIGINT AS value_cents,
         count(movement.value_cents) AS valued
  INTO v_earlier
  FROM public.inventory_movements AS movement
  WHERE movement.org_id = NEW.org_id AND movement.item_id = NEW.item_id
    AND movement.source_type = NEW.source_type AND movement.source_id IS NOT DISTINCT FROM NEW.source_id
    AND NEW.source_id IS NOT NULL;

  IF NEW.source_id IS NOT NULL AND v_earlier.valued > 0 AND v_earlier.quantity <> 0
     AND NEW.quantity = -v_earlier.quantity THEN
    -- A void or reopening: undo exactly the value the document moved, with
    -- the accounts it used.
    NEW.value_cents := -v_earlier.value_cents;
    NEW.valued_on := v_today;
    FOR v_offset IN
      SELECT movement.inventory_account_id AS inventory_account_id, movement.offset_account_id AS offset_account_id,
             sum(movement.value_cents)::BIGINT AS value_cents
      FROM public.inventory_movements AS movement
      WHERE movement.org_id = NEW.org_id AND movement.item_id = NEW.item_id
        AND movement.source_type = NEW.source_type AND movement.source_id = NEW.source_id
        AND movement.value_cents IS NOT NULL
      GROUP BY movement.inventory_account_id, movement.offset_account_id
      HAVING sum(movement.value_cents) <> 0
    LOOP
      IF v_offset.inventory_account_id IS DISTINCT FROM v_offset.offset_account_id THEN
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('accountId', v_offset.offset_account_id,
            'debit', GREATEST(v_offset.value_cents, 0), 'credit', GREATEST(-v_offset.value_cents, 0),
            'description', 'Stock value reversed: ' || v_item.name),
          jsonb_build_object('accountId', v_offset.inventory_account_id,
            'debit', GREATEST(-v_offset.value_cents, 0), 'credit', GREATEST(v_offset.value_cents, 0),
            'description', 'Stock value reversed: ' || v_item.name));
      END IF;
      NEW.offset_account_id := v_offset.offset_account_id;
    END LOOP;
    v_memo := 'Stock value reversed: ' || v_item.name;
  ELSE
    -- Purchases and supplier returns name the document line they came from.
    v_position := NULLIF(substring(COALESCE(NEW.idempotency_key, '') FROM ':([0-9]+)$'), '')::INTEGER;
    IF NEW.source_type = 'BILL' AND NEW.quantity > 0 THEN
      SELECT line.amount_cents, line.account_id, bill.date INTO v_line_amount, v_line_account, v_line_date
      FROM public.bill_lines AS line JOIN public.bills AS bill ON bill.org_id = line.org_id AND bill.id = line.bill_id
      WHERE line.org_id = NEW.org_id AND line.bill_id = NEW.source_id AND line.inventory_item_id = NEW.item_id
      ORDER BY (line.line_position = v_position) DESC, line.line_position LIMIT 1;
    ELSIF NEW.source_type = 'EXPENSE' AND NEW.quantity > 0 THEN
      SELECT line.amount_cents, line.account_id, txn.txn_date INTO v_line_amount, v_line_account, v_line_date
      FROM public.cash_transaction_lines AS line
      JOIN public.cash_transactions AS txn ON txn.org_id = line.org_id AND txn.id = line.cash_transaction_id
      WHERE line.org_id = NEW.org_id AND line.cash_transaction_id = NEW.source_id AND line.inventory_item_id = NEW.item_id
      ORDER BY (line.line_position = v_position) DESC, line.line_position LIMIT 1;
    ELSIF NEW.source_type = 'SUPPLIER_CREDIT' AND NEW.quantity < 0 THEN
      SELECT line.amount_cents, line.account_id, credit.credit_date INTO v_line_amount, v_line_account, v_line_date
      FROM public.credit_note_lines AS line
      JOIN public.credit_notes AS credit ON credit.org_id = line.org_id AND credit.id = line.credit_note_id
      WHERE line.org_id = NEW.org_id AND line.credit_note_id = NEW.source_id AND line.inventory_item_id = NEW.item_id
      ORDER BY (line.line_position = v_position) DESC, line.line_position LIMIT 1;
    END IF;

    v_unit := CASE WHEN v_before_qty > 0 AND v_before_value > 0 THEN v_before_value::NUMERIC / v_before_qty
                   ELSE v_item.cost_price_cents END;

    IF v_line_amount IS NOT NULL AND NEW.quantity > 0 THEN
      -- Bought in at the line's cost; the line's account moves to Inventory.
      NEW.value_cents := v_line_amount;
      NEW.offset_account_id := v_line_account;
      NEW.valued_on := v_line_date;
      v_memo := 'Stock received at cost: ' || v_item.name;
    ELSIF v_line_amount IS NOT NULL THEN
      -- Sent back to the supplier at the line's cost, never more than is held.
      NEW.value_cents := -LEAST(v_line_amount, GREATEST(v_before_value, 0));
      IF NEW.quantity_after <= 0 THEN NEW.value_cents := -GREATEST(v_before_value, 0); END IF;
      NEW.offset_account_id := v_line_account;
      NEW.valued_on := v_line_date;
      v_memo := 'Stock returned to supplier: ' || v_item.name;
    ELSIF NEW.source_type = 'OPENING' THEN
      NEW.value_cents := NEW.quantity * v_item.cost_price_cents;
      NEW.offset_account_id := private.stock_account(NEW.org_id, '3050');
      NEW.valued_on := v_today;
      v_memo := 'Opening stock: ' || v_item.name;
    ELSIF NEW.quantity > 0 THEN
      -- Returned by a customer or counted up: at average cost.
      NEW.value_cents := round(NEW.quantity * v_unit)::BIGINT;
      NEW.offset_account_id := v_accounts.cogs_account_id;
      NEW.valued_on := COALESCE((SELECT credit.credit_date FROM public.credit_notes AS credit
        WHERE NEW.source_type = 'CREDIT_NOTE' AND credit.org_id = NEW.org_id AND credit.id = NEW.source_id), v_today);
      v_memo := 'Stock back in at average cost: ' || v_item.name;
    ELSE
      -- Sold or written down: at average cost; the last unit takes what is left.
      NEW.value_cents := -round(-NEW.quantity * v_unit)::BIGINT;
      IF NEW.quantity_after = 0 OR (NEW.quantity_after < 0 AND v_before_qty > 0 AND v_before_value > 0) THEN
        NEW.value_cents := -GREATEST(v_before_value, 0) + LEAST(NEW.quantity_after, 0) * round(v_unit)::BIGINT;
      END IF;
      NEW.offset_account_id := v_accounts.cogs_account_id;
      NEW.valued_on := COALESCE((SELECT txn.txn_date FROM public.cash_transactions AS txn
        WHERE NEW.source_type = 'SALES_RECEIPT' AND txn.org_id = NEW.org_id AND txn.id = NEW.source_id), v_today);
      v_memo := 'Cost of goods sold: ' || v_item.name;
    END IF;

    IF NEW.value_cents <> 0 AND NEW.inventory_account_id IS DISTINCT FROM NEW.offset_account_id THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('accountId', NEW.inventory_account_id,
          'debit', GREATEST(NEW.value_cents, 0), 'credit', GREATEST(-NEW.value_cents, 0), 'description', v_memo),
        jsonb_build_object('accountId', NEW.offset_account_id,
          'debit', GREATEST(-NEW.value_cents, 0), 'credit', GREATEST(NEW.value_cents, 0), 'description', v_memo));
    END IF;
  END IF;

  -- A document dated before stock valuation began is valued on its first day.
  NEW.valued_on := GREATEST(COALESCE(NEW.valued_on, v_today), v_from);
  NEW.value_after_cents := v_before_value + NEW.value_cents;

  IF jsonb_array_length(v_lines) > 0 THEN
    NEW.journal_entry_id := private.insert_journal_entry(NEW.org_id, NEW.valued_on, v_memo, 'STOCK_VALUE', NEW.id,
      left(NEW.source_type || COALESCE('-' || NEW.source_id::TEXT, ''), 100), NEW.created_by, v_lines,
      'stock-value:' || NEW.id::TEXT);
  END IF;

  PERFORM set_config('ledger.stock_value', 'on', true);
  UPDATE public.inventory_items SET stock_value_cents = NEW.value_after_cents
  WHERE org_id = NEW.org_id AND id = NEW.item_id;
  PERFORM set_config('ledger.stock_value', '', true);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.value_stock_movement() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER inventory_movements_value BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.value_stock_movement();

-- ---------------------------------------------------------------------------
-- 4. Turning it on
-- ---------------------------------------------------------------------------

-- p_costs: [{"itemId", "unitCostCents"}] for items whose cost price should
-- not be used. Items with nothing on hand start at nothing.
CREATE OR REPLACE FUNCTION public.start_stock_valuation(p_org_id UUID, p_start_date DATE, p_costs JSONB, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org RECORD;
  v_item RECORD;
  v_unit BIGINT;
  v_value BIGINT;
  v_total BIGINT := 0;
  v_items INTEGER := 0;
  v_lines JSONB := '[]'::JSONB;
  v_by_account JSONB := '{}'::JSONB;
  v_account TEXT;
  v_equity UUID;
  v_entry UUID;
  v_today DATE;
BEGIN
  PERFORM 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_actor AND role::TEXT IN ('owner', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an owner or admin can turn on stock valuation.' USING ERRCODE = '42501'; END IF;
  SELECT id, stock_valuation_from, books_closed_through, COALESCE(time_zone, 'Africa/Nairobi') AS time_zone INTO v_org
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF v_org.stock_valuation_from IS NOT NULL THEN
    RETURN jsonb_build_object('startDate', v_org.stock_valuation_from, 'alreadyOn', true);
  END IF;
  v_today := (now() AT TIME ZONE v_org.time_zone)::DATE;
  IF p_start_date IS NULL OR p_start_date > v_today THEN
    RAISE EXCEPTION 'Start stock valuation on a date up to today.' USING ERRCODE = '22023';
  END IF;
  IF v_org.books_closed_through IS NOT NULL AND p_start_date <= v_org.books_closed_through THEN
    RAISE EXCEPTION 'The books are closed through %. Start stock valuation after the closing date.',
      pg_catalog.to_char(v_org.books_closed_through, 'DD/MM/YYYY') USING ERRCODE = '23514';
  END IF;
  IF p_costs IS NOT NULL AND jsonb_typeof(p_costs) <> 'array' THEN
    RAISE EXCEPTION 'Item costs are a list.' USING ERRCODE = '22023';
  END IF;
  v_equity := private.stock_account(p_org_id, '3050');

  FOR v_item IN
    SELECT item.id, item.name, item.quantity_on_hand, COALESCE(item.cost_price_cents, 0) AS cost_price_cents
    FROM public.inventory_items AS item
    WHERE item.org_id = p_org_id AND item.quantity_on_hand > 0
    ORDER BY item.name, item.id
    FOR UPDATE
  LOOP
    SELECT (cost->>'unitCostCents')::BIGINT INTO v_unit
    FROM jsonb_array_elements(COALESCE(p_costs, '[]'::JSONB)) AS cost
    WHERE cost->>'itemId' = v_item.id::TEXT LIMIT 1;
    v_unit := COALESCE(v_unit, v_item.cost_price_cents);
    IF v_unit < 0 THEN RAISE EXCEPTION 'The cost of % cannot be below nothing.', v_item.name USING ERRCODE = '22023'; END IF;
    v_value := v_item.quantity_on_hand * v_unit;
    IF v_value > 0 THEN
      v_account := (SELECT accounts.inventory_account_id::TEXT FROM private.item_stock_accounts(p_org_id, v_item.id) AS accounts);
      v_by_account := jsonb_set(v_by_account, ARRAY[v_account],
        to_jsonb(COALESCE((v_by_account->>v_account)::BIGINT, 0) + v_value));
      v_total := v_total + v_value;
    END IF;
    v_items := v_items + 1;
    PERFORM set_config('ledger.stock_value', 'on', true);
    UPDATE public.inventory_items SET stock_value_cents = v_value WHERE org_id = p_org_id AND id = v_item.id;
    PERFORM set_config('ledger.stock_value', '', true);
  END LOOP;

  IF v_total > 0 THEN
    FOR v_account IN SELECT key FROM jsonb_each(v_by_account) ORDER BY key LOOP
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', v_account,
        'debit', (v_by_account->>v_account)::BIGINT, 'credit', 0, 'description', 'Stock on hand when valuation began'));
    END LOOP;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', v_equity, 'debit', 0, 'credit', v_total,
      'description', 'Stock on hand when valuation began'));
    v_entry := private.insert_journal_entry(p_org_id, p_start_date, 'Stock on hand when valuation began',
      'STOCK_VALUE', p_org_id, 'STOCK-OPENING', p_actor, v_lines, 'stock-valuation-start:' || p_org_id::TEXT);
  END IF;

  UPDATE public.organizations SET stock_valuation_from = p_start_date, stock_valuation_entry_id = v_entry
  WHERE id = p_org_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'STOCK_VALUATION', p_org_id,
    jsonb_build_object('startDate', p_start_date, 'items', v_items, 'valueCents', v_total, 'journalEntryId', v_entry));
  RETURN jsonb_build_object('startDate', p_start_date, 'items', v_items, 'valueCents', v_total,
    'journalEntryId', v_entry, 'alreadyOn', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.start_stock_valuation(UUID, DATE, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_stock_valuation(UUID, DATE, JSONB, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The valuation report
-- ---------------------------------------------------------------------------

-- Each item's quantity, value and average cost, and the Inventory accounts'
-- balances, which agree with the items' values while every stock posting
-- goes through movements.
CREATE OR REPLACE FUNCTION public.stock_valuation(p_org_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT jsonb_build_object(
    'startDate', org.stock_valuation_from,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'itemId', item.id, 'name', item.name, 'sku', item.sku, 'quantity', item.quantity_on_hand,
        'valueCents', item.stock_value_cents,
        'averageCostCents', CASE WHEN item.quantity_on_hand > 0 THEN round(item.stock_value_cents::NUMERIC / item.quantity_on_hand) END,
        'lastCostCents', item.cost_price_cents) ORDER BY item.name, item.id)
      FROM public.inventory_items AS item
      WHERE item.org_id = p_org_id AND (item.quantity_on_hand <> 0 OR item.stock_value_cents <> 0)), '[]'::JSONB),
    'itemsValueCents', COALESCE((SELECT sum(item.stock_value_cents) FROM public.inventory_items AS item WHERE item.org_id = p_org_id), 0)::BIGINT,
    'ledgerValueCents', COALESCE((SELECT sum(line.debit - line.credit)
      FROM public.journal_lines AS line
      WHERE line.org_id = p_org_id AND line.account_id IN (
        SELECT DISTINCT movement.inventory_account_id FROM public.inventory_movements AS movement
        WHERE movement.org_id = p_org_id AND movement.inventory_account_id IS NOT NULL
        UNION SELECT account.id FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.code = '1200')), 0)::BIGINT)
  FROM public.organizations AS org WHERE org.id = p_org_id;
$function$;
REVOKE ALL ON FUNCTION public.stock_valuation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_valuation(UUID) TO service_role;

-- Rollback: DROP TRIGGER inventory_movements_value ON public.inventory_movements;
-- DROP TRIGGER inventory_items_guard_stock_value ON public.inventory_items;
-- DROP FUNCTION public.stock_valuation(UUID), public.start_stock_valuation(UUID, DATE, JSONB, UUID),
-- private.value_stock_movement(), private.item_stock_accounts(UUID, UUID), private.stock_account(UUID, TEXT),
-- private.guard_stock_value(); drop the added columns. Posted STOCK_VALUE entries stay and are reversed by hand.
