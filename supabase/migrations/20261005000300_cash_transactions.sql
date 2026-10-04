-- Money that moves at once, without an invoice or a bill in between:
--
--   Sales receipt  a sale paid on the spot. Income and output VAT are
--                  credited, the bank, cash or M-Pesa account debited, and
--                  stock items counted out.
--   Expense        a purchase paid on the spot. The expense lines and
--                  recoverable VAT are debited and the money account
--                  credited; stock items on it are counted in.
--   Transfer       money moved between two money accounts.
--
-- Each is posted in one transaction with its journal entry, audit row and
-- stock movements, and is voided with a dated reversing entry, never deleted.

CREATE TABLE public.cash_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  number                TEXT NOT NULL,
  txn_date              DATE NOT NULL,
  customer_id           UUID,
  vendor_id             UUID,
  payee_name            TEXT,
  money_account_id      UUID NOT NULL,
  to_account_id         UUID,
  reference             TEXT,
  memo                  TEXT,
  subtotal_cents        BIGINT NOT NULL,
  tax_cents             BIGINT NOT NULL DEFAULT 0,
  total_cents           BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'POSTED',
  journal_entry_id      UUID NOT NULL,
  void_journal_entry_id UUID,
  voided_at             TIMESTAMPTZ,
  voided_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason           TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key       TEXT NOT NULL,
  CONSTRAINT cash_transactions_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT cash_transactions_org_number_key UNIQUE (org_id, number),
  CONSTRAINT cash_transactions_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT cash_transactions_kind_check CHECK (kind IN ('SALES_RECEIPT', 'EXPENSE', 'TRANSFER')),
  CONSTRAINT cash_transactions_status_check CHECK (status IN ('POSTED', 'VOID')),
  CONSTRAINT cash_transactions_void_check CHECK ((status = 'VOID') = (voided_at IS NOT NULL)),
  CONSTRAINT cash_transactions_amounts_check
    CHECK (subtotal_cents > 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents),
  CONSTRAINT cash_transactions_transfer_check
    CHECK ((kind = 'TRANSFER') = (to_account_id IS NOT NULL) AND (to_account_id IS NULL OR to_account_id <> money_account_id)),
  CONSTRAINT cash_transactions_party_check
    CHECK ((kind = 'SALES_RECEIPT' OR customer_id IS NULL) AND (kind = 'EXPENSE' OR vendor_id IS NULL)),
  CONSTRAINT cash_transactions_text_check CHECK (
    (payee_name IS NULL OR length(payee_name) <= 200) AND (reference IS NULL OR length(reference) <= 100)
    AND (memo IS NULL OR length(memo) <= 4000) AND (void_reason IS NULL OR length(void_reason) <= 500)
  ),
  CONSTRAINT cash_transactions_org_customer_fkey FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transactions_org_vendor_fkey FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.vendors(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transactions_org_money_account_fkey FOREIGN KEY (org_id, money_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transactions_org_to_account_fkey FOREIGN KEY (org_id, to_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transactions_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.cash_transaction_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  cash_transaction_id UUID NOT NULL,
  line_position       INTEGER NOT NULL,
  description         TEXT NOT NULL,
  account_id          UUID NOT NULL,
  inventory_item_id   UUID,
  quantity            NUMERIC(16, 3),
  unit_price_cents    BIGINT,
  tax_rate            NUMERIC(5, 2),
  amount_cents        BIGINT NOT NULL,
  tax_cents           BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT cash_transaction_lines_position_key UNIQUE (cash_transaction_id, line_position),
  CONSTRAINT cash_transaction_lines_parent_fkey FOREIGN KEY (org_id, cash_transaction_id)
    REFERENCES public.cash_transactions(org_id, id) ON DELETE CASCADE,
  CONSTRAINT cash_transaction_lines_account_fkey FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transaction_lines_item_fkey FOREIGN KEY (org_id, inventory_item_id)
    REFERENCES public.inventory_items(org_id, id) ON DELETE SET NULL (inventory_item_id),
  CONSTRAINT cash_transaction_lines_amounts_check CHECK (amount_cents > 0 AND tax_cents >= 0),
  CONSTRAINT cash_transaction_lines_quantity_check CHECK (quantity IS NULL OR quantity > 0)
);

CREATE INDEX idx_cash_transactions_org_kind_date ON public.cash_transactions(org_id, kind, txn_date DESC);
CREATE INDEX idx_cash_transaction_lines_parent ON public.cash_transaction_lines(cash_transaction_id);

ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transaction_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_transactions_select_policy ON public.cash_transactions
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY cash_transaction_lines_select_policy ON public.cash_transaction_lines
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.cash_transactions, public.cash_transaction_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cash_transactions, public.cash_transaction_lines TO service_role;

-- An active bank, cash or M-Pesa account of this organization, or an error.
CREATE OR REPLACE FUNCTION private.require_money_account(p_org_id UUID, p_account_id UUID, p_what TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM 1 FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_account_id
    AND account.is_active AND account.is_bank_account AND account.type = 'ASSET';
  IF NOT FOUND THEN
    RAISE EXCEPTION '% must be an active bank, cash or M-Pesa account in this organization.', p_what USING ERRCODE = '23503';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.require_money_account(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- A retry with the same key returns what was posted the first time.
CREATE OR REPLACE FUNCTION private.existing_cash_transaction(p_org_id UUID, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':cash:' || p_idempotency_key, 0)
  );
  SELECT txn.id, txn.number, txn.total_cents, txn.journal_entry_id INTO v_row
  FROM public.cash_transactions AS txn
  WHERE txn.org_id = p_org_id AND txn.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('id', v_row.id, 'number', v_row.number, 'totalCents', v_row.total_cents,
    'journalEntryId', v_row.journal_entry_id);
END;
$function$;

REVOKE ALL ON FUNCTION private.existing_cash_transaction(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- 1. A sale paid on the spot.
CREATE OR REPLACE FUNCTION public.record_sales_receipt(
  p_org_id UUID,
  p_customer_id UUID,
  p_payee_name TEXT,
  p_txn_date DATE,
  p_deposit_account_id UUID,
  p_reference TEXT,
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
  v_existing JSONB;
  v_prepared JSONB;
  v_line JSONB;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
  v_subtotal BIGINT;
  v_tax BIGINT;
  v_output_vat UUID;
  v_journal JSONB := '[]'::JSONB;
  v_entry_id UUID;
  v_party TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_existing := private.existing_cash_transaction(p_org_id, p_idempotency_key);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF p_txn_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_deposit_account_id, 'The account the money went into');
  IF p_customer_id IS NOT NULL THEN
    SELECT customer.display_name INTO v_party FROM public.customers AS customer
    WHERE customer.org_id = p_org_id AND customer.id = p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer does not belong to this organization.' USING ERRCODE = '23503';
    END IF;
  END IF;
  v_party := COALESCE(v_party, NULLIF(btrim(COALESCE(p_payee_name, '')), ''), 'Cash sale');

  v_prepared := private.prepare_sales_lines(p_org_id, p_lines, 'sales receipt');
  v_subtotal := (v_prepared->>'subtotal')::BIGINT;
  v_tax := (v_prepared->>'tax')::BIGINT;
  IF v_tax > 0 THEN
    SELECT account.id INTO v_output_vat FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.code = '2100' AND account.type = 'LIABILITY' AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active Output VAT account 2100 is required.' USING ERRCODE = '23503';
    END IF;
  END IF;

  v_number := 'SR-' || to_char(p_txn_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'SALES_RECEIPT')::TEXT, 5, '0');

  v_journal := jsonb_build_array(jsonb_build_object(
    'accountId', p_deposit_account_id, 'debit', v_subtotal + v_tax, 'credit', 0,
    'description', 'Sales receipt ' || v_number || ' — ' || v_party));
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_prepared->'lines')
  LOOP
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_line->>'accountId', 'debit', 0, 'credit', (v_line->>'amount')::BIGINT,
      'description', v_line->>'description',
      'entityType', CASE WHEN p_customer_id IS NULL THEN NULL ELSE 'CUSTOMER' END, 'entityId', p_customer_id));
  END LOOP;
  IF v_tax > 0 THEN
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_output_vat, 'debit', 0, 'credit', v_tax, 'description', 'Output VAT — ' || v_number));
  END IF;

  v_entry_id := private.insert_journal_entry(
    p_org_id, p_txn_date, 'Sales receipt ' || v_number || ' — ' || v_party, 'SALES_RECEIPT', v_id,
    v_number, p_actor, v_journal, 'sales-receipt:' || p_idempotency_key);

  INSERT INTO public.cash_transactions (
    id, org_id, kind, number, txn_date, customer_id, payee_name, money_account_id, reference, memo,
    subtotal_cents, tax_cents, total_cents, journal_entry_id, created_by, idempotency_key
  ) VALUES (
    v_id, p_org_id, 'SALES_RECEIPT', v_number, p_txn_date, p_customer_id,
    CASE WHEN p_customer_id IS NULL THEN NULLIF(btrim(COALESCE(p_payee_name, '')), '') END,
    p_deposit_account_id, NULLIF(btrim(COALESCE(p_reference, '')), ''), NULLIF(btrim(COALESCE(p_memo, '')), ''),
    v_subtotal, v_tax, v_subtotal + v_tax, v_entry_id, p_actor, p_idempotency_key
  );

  INSERT INTO public.cash_transaction_lines (
    org_id, cash_transaction_id, line_position, description, account_id, inventory_item_id,
    quantity, unit_price_cents, tax_rate, amount_cents, tax_cents
  )
  SELECT p_org_id, v_id, (line->>'position')::INTEGER, line->>'description', (line->>'accountId')::UUID,
         NULLIF(line->>'itemId', '')::UUID, (line->>'quantity')::NUMERIC, (line->>'unitPrice')::BIGINT,
         (line->>'taxRate')::NUMERIC, (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line);

  -- Stock sold here is counted out, as an order's is on completion.
  FOR v_line IN
    SELECT jsonb_build_object('itemId', line->>'itemId', 'quantity', sum((line->>'quantity')::NUMERIC)::INTEGER)
    FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line)
    WHERE (line->>'stocked')::BOOLEAN
    GROUP BY line->>'itemId'
  LOOP
    PERFORM private.move_stock(p_org_id, (v_line->>'itemId')::UUID, -(v_line->>'quantity')::INTEGER,
      'SALES_RECEIPT', v_id, 'Sold on ' || v_number, p_actor);
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'SALES_RECEIPT', v_id,
    jsonb_build_object('number', v_number, 'totalCents', v_subtotal + v_tax));

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', v_subtotal + v_tax, 'journalEntryId', v_entry_id);
END;
$function$;

-- 2. A purchase paid on the spot.
CREATE OR REPLACE FUNCTION public.record_expense(
  p_org_id UUID,
  p_vendor_id UUID,
  p_payee_name TEXT,
  p_txn_date DATE,
  p_paid_from_account_id UUID,
  p_reference TEXT,
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
  v_existing JSONB;
  v_line JSONB;
  v_position INTEGER := 0;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
  v_account_id UUID;
  v_amount BIGINT;
  v_tax BIGINT;
  v_item_id UUID;
  v_item_type TEXT;
  v_quantity NUMERIC;
  v_subtotal BIGINT := 0;
  v_tax_total BIGINT := 0;
  v_input_vat UUID;
  v_journal JSONB := '[]'::JSONB;
  v_prepared JSONB := '[]'::JSONB;
  v_entry_id UUID;
  v_party TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_existing := private.existing_cash_transaction(p_org_id, p_idempotency_key);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF p_txn_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_paid_from_account_id, 'The account it was paid from');
  IF p_vendor_id IS NOT NULL THEN
    SELECT vendor.display_name INTO v_party FROM public.vendors AS vendor
    WHERE vendor.org_id = p_org_id AND vendor.id = p_vendor_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vendor does not belong to this organization.' USING ERRCODE = '23503';
    END IF;
  END IF;
  v_party := COALESCE(v_party, NULLIF(btrim(COALESCE(p_payee_name, '')), ''), 'Expense');
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'An expense needs between 1 and 200 lines.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;
    BEGIN
      v_account_id := (v_line->>'accountId')::UUID;
      v_amount := (v_line->>'amountCents')::BIGINT;
      v_tax := COALESCE((v_line->>'taxCents')::BIGINT, 0);
      v_item_id := NULLIF(v_line->>'inventoryItemId', '')::UUID;
      v_quantity := NULLIF(v_line->>'quantity', '')::NUMERIC;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;
    IF NULLIF(btrim(v_line->>'description'), '') IS NULL OR length(v_line->>'description') > 500
       OR v_amount IS NULL OR v_amount <= 0 OR v_tax < 0 THEN
      RAISE EXCEPTION 'Line % needs a description and an amount above zero.', v_position USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type IN ('ASSET', 'COGS', 'EXPENSE') AND account.is_active
      AND NOT account.is_bank_account AND account.code NOT IN ('1100', '1150');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line % must use an active expense, cost of sales or asset account. Receivables, recoverable VAT and bank accounts are not expense lines.', v_position
        USING ERRCODE = '23503';
    END IF;
    v_item_type := NULL;
    IF v_item_id IS NOT NULL THEN
      SELECT item.type INTO v_item_type FROM public.inventory_items AS item
      WHERE item.org_id = p_org_id AND item.id = v_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line %: the stock item is not in this organization.', v_position USING ERRCODE = '23503';
      END IF;
      IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000000000 THEN
        RAISE EXCEPTION 'Line %: enter the quantity bought.', v_position USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_item_type, '') NOT ILIKE '%service%' AND v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION 'Line %: stock is counted in whole units.', v_position USING ERRCODE = '22023';
      END IF;
    END IF;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;
    v_prepared := v_prepared || jsonb_build_array(jsonb_build_object(
      'position', v_position, 'description', btrim(v_line->>'description'), 'accountId', v_account_id,
      'itemId', v_item_id, 'quantity', v_quantity, 'amount', v_amount, 'tax', v_tax,
      'stocked', v_item_id IS NOT NULL AND COALESCE(v_item_type, '') NOT ILIKE '%service%'));
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_account_id, 'debit', v_amount, 'credit', 0, 'description', btrim(v_line->>'description'),
      'entityType', CASE WHEN p_vendor_id IS NULL THEN NULL ELSE 'VENDOR' END, 'entityId', p_vendor_id));
  END LOOP;

  IF v_tax_total > 0 THEN
    SELECT account.id INTO v_input_vat FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.code = '1150' AND account.type = 'ASSET' AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active Recoverable VAT account 1150 is required.' USING ERRCODE = '23503';
    END IF;
  END IF;

  v_number := 'EXP-' || to_char(p_txn_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'EXPENSE')::TEXT, 5, '0');
  IF v_tax_total > 0 THEN
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_input_vat, 'debit', v_tax_total, 'credit', 0, 'description', 'Recoverable VAT — ' || v_number));
  END IF;
  v_journal := v_journal || jsonb_build_array(jsonb_build_object(
    'accountId', p_paid_from_account_id, 'debit', 0, 'credit', v_subtotal + v_tax_total,
    'description', 'Expense ' || v_number || ' — ' || v_party));

  v_entry_id := private.insert_journal_entry(
    p_org_id, p_txn_date, 'Expense ' || v_number || ' — ' || v_party, 'EXPENSE', v_id,
    v_number, p_actor, v_journal, 'expense:' || p_idempotency_key);

  INSERT INTO public.cash_transactions (
    id, org_id, kind, number, txn_date, vendor_id, payee_name, money_account_id, reference, memo,
    subtotal_cents, tax_cents, total_cents, journal_entry_id, created_by, idempotency_key
  ) VALUES (
    v_id, p_org_id, 'EXPENSE', v_number, p_txn_date, p_vendor_id,
    CASE WHEN p_vendor_id IS NULL THEN NULLIF(btrim(COALESCE(p_payee_name, '')), '') END,
    p_paid_from_account_id, NULLIF(btrim(COALESCE(p_reference, '')), ''), NULLIF(btrim(COALESCE(p_memo, '')), ''),
    v_subtotal, v_tax_total, v_subtotal + v_tax_total, v_entry_id, p_actor, p_idempotency_key
  );

  INSERT INTO public.cash_transaction_lines (
    org_id, cash_transaction_id, line_position, description, account_id, inventory_item_id, quantity, amount_cents, tax_cents
  )
  SELECT p_org_id, v_id, (line->>'position')::INTEGER, line->>'description', (line->>'accountId')::UUID,
         NULLIF(line->>'itemId', '')::UUID, NULLIF(line->>'quantity', '')::NUMERIC, (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared) AS prepared(line);

  -- Stock bought here is counted in, at this cost.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_prepared) WHERE (value->>'stocked')::BOOLEAN
  LOOP
    PERFORM private.move_stock(p_org_id, (v_line->>'itemId')::UUID, (v_line->>'quantity')::NUMERIC::INTEGER,
      'EXPENSE', v_id, 'Bought on ' || v_number, p_actor, 'expense:' || v_id::TEXT || ':' || (v_line->>'position'));
    UPDATE public.inventory_items
    SET cost_price_cents = round((v_line->>'amount')::NUMERIC / (v_line->>'quantity')::NUMERIC)::BIGINT
    WHERE org_id = p_org_id AND id = (v_line->>'itemId')::UUID;
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'EXPENSE', v_id,
    jsonb_build_object('number', v_number, 'totalCents', v_subtotal + v_tax_total));

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', v_subtotal + v_tax_total, 'journalEntryId', v_entry_id);
END;
$function$;

-- 3. Money moved between two money accounts.
CREATE OR REPLACE FUNCTION public.record_transfer(
  p_org_id UUID,
  p_txn_date DATE,
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount_cents BIGINT,
  p_memo TEXT,
  p_actor UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing JSONB;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
  v_entry_id UUID;
  v_memo TEXT := NULLIF(btrim(COALESCE(p_memo, '')), '');
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_existing := private.existing_cash_transaction(p_org_id, p_idempotency_key);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF p_txn_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'A transfer needs an amount above zero.' USING ERRCODE = '22023';
  END IF;
  IF p_from_account_id IS NOT DISTINCT FROM p_to_account_id THEN
    RAISE EXCEPTION 'Choose two different accounts to transfer between.' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_from_account_id, 'The account the money left');
  PERFORM private.require_money_account(p_org_id, p_to_account_id, 'The account the money went to');

  v_number := 'TRF-' || to_char(p_txn_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'TRANSFER')::TEXT, 5, '0');
  v_entry_id := private.insert_journal_entry(
    p_org_id, p_txn_date, COALESCE(v_memo, 'Transfer ' || v_number), 'TRANSFER', v_id, v_number, p_actor,
    jsonb_build_array(
      jsonb_build_object('accountId', p_to_account_id, 'debit', p_amount_cents, 'credit', 0, 'description', 'Transfer in — ' || v_number),
      jsonb_build_object('accountId', p_from_account_id, 'debit', 0, 'credit', p_amount_cents, 'description', 'Transfer out — ' || v_number)
    ),
    'transfer:' || p_idempotency_key);

  INSERT INTO public.cash_transactions (
    id, org_id, kind, number, txn_date, money_account_id, to_account_id, memo,
    subtotal_cents, tax_cents, total_cents, journal_entry_id, created_by, idempotency_key
  ) VALUES (
    v_id, p_org_id, 'TRANSFER', v_number, p_txn_date, p_from_account_id, p_to_account_id, v_memo,
    p_amount_cents, 0, p_amount_cents, v_entry_id, p_actor, p_idempotency_key
  );

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'TRANSFER', v_id, jsonb_build_object('number', v_number, 'amountCents', p_amount_cents));

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', p_amount_cents, 'journalEntryId', v_entry_id);
END;
$function$;

-- 4. Void any of the three with a dated reversing entry; stock moved by it
-- is moved back. The original stays on record.
CREATE OR REPLACE FUNCTION public.void_cash_transaction(
  p_org_id UUID,
  p_id UUID,
  p_void_date DATE,
  p_reason TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_txn RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
  v_label TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT txn.* INTO v_txn FROM public.cash_transactions AS txn
  WHERE txn.org_id = p_org_id AND txn.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_txn.status = 'VOID' THEN
    RETURN jsonb_build_object('number', v_txn.number, 'reversalJournalEntryId', v_txn.void_journal_entry_id);
  END IF;
  v_label := CASE v_txn.kind WHEN 'SALES_RECEIPT' THEN 'sales receipt' WHEN 'EXPENSE' THEN 'expense' ELSE 'transfer' END;
  v_reason := private.require_reason(p_reason, 'this ' || v_label);
  IF p_void_date IS NULL OR p_void_date < v_txn.txn_date THEN
    RAISE EXCEPTION 'A void is dated on or after the % it reverses.', v_label USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bank_transactions AS line
    WHERE line.org_id = p_org_id AND line.matched_journal_entry_id = v_txn.journal_entry_id
  ) THEN
    RAISE EXCEPTION 'A bank statement line is matched to this %. Undo that match first.', v_label USING ERRCODE = '23514';
  END IF;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_void_date, 'Void ' || v_txn.number || ': ' || v_reason, 'ADJUSTMENT', p_id,
    'VOID-' || v_txn.number, p_actor, private.reversal_lines(p_org_id, v_txn.journal_entry_id, v_txn.number),
    'void:cash:' || p_id::TEXT);

  UPDATE public.cash_transactions
  SET status = 'VOID', void_journal_entry_id = v_reversal_id, voided_at = now(), voided_by = p_actor, void_reason = v_reason
  WHERE org_id = p_org_id AND id = p_id;

  PERFORM private.reverse_stock_for(p_org_id, v_txn.kind, p_id, v_txn.number || ' voided', p_actor);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'VOID', v_txn.kind, p_id,
    jsonb_build_object('number', v_txn.number, 'reason', v_reason, 'reversalJournalEntryId', v_reversal_id));

  RETURN jsonb_build_object('number', v_txn.number, 'reversalJournalEntryId', v_reversal_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_sales_receipt(UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_expense(UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_transfer(UUID, DATE, UUID, UUID, BIGINT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_cash_transaction(UUID, UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sales_receipt(UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, JSONB, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expense(UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, JSONB, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_transfer(UUID, DATE, UUID, UUID, BIGINT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_cash_transaction(UUID, UUID, DATE, TEXT, UUID) TO service_role;

-- Rollback: drop the four public functions, the three private helpers,
-- public.cash_transaction_lines and public.cash_transactions.
