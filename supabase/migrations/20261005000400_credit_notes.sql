-- Credit notes, supplier credits and refunds.
--
--   Credit note      what is owed back to a customer: goods returned, a price
--                    agreed down after invoicing, a mistake. Income and output
--                    VAT are debited and receivables credited; stock items on
--                    it come back into stock.
--   Supplier credit  what a supplier owes back. Payables are debited, the
--                    expense, stock or asset account and recoverable VAT
--                    credited; stock items sent back are counted out.
--
-- A credit is used by applying it to an open invoice or bill of the same
-- customer or supplier, which lowers what is due without moving money, or by
-- a refund, which moves money and is posted. Until it is used, a credit
-- counts against the party's balance, so receivables and payables in the
-- ledger still agree with the documents behind them.
--
-- Credits are in the organization's base currency and apply to invoices and
-- bills in that currency.

CREATE TABLE public.credit_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  number                TEXT NOT NULL,
  credit_date           DATE NOT NULL,
  customer_id           UUID,
  vendor_id             UUID,
  invoice_id            UUID,
  bill_id               UUID,
  reference             TEXT,
  memo                  TEXT,
  currency              TEXT NOT NULL,
  subtotal_cents        BIGINT NOT NULL,
  tax_cents             BIGINT NOT NULL DEFAULT 0,
  total_cents           BIGINT NOT NULL,
  remaining_cents       BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'OPEN',
  journal_entry_id      UUID NOT NULL,
  void_journal_entry_id UUID,
  voided_at             TIMESTAMPTZ,
  voided_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason           TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key       TEXT NOT NULL,
  CONSTRAINT credit_notes_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT credit_notes_org_number_key UNIQUE (org_id, number),
  CONSTRAINT credit_notes_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT credit_notes_kind_check CHECK (kind IN ('CUSTOMER', 'SUPPLIER')),
  CONSTRAINT credit_notes_party_check CHECK (
    (kind = 'CUSTOMER' AND customer_id IS NOT NULL AND vendor_id IS NULL AND bill_id IS NULL)
    OR (kind = 'SUPPLIER' AND vendor_id IS NOT NULL AND customer_id IS NULL AND invoice_id IS NULL)
  ),
  CONSTRAINT credit_notes_status_check CHECK (status IN ('OPEN', 'CLOSED', 'VOID')),
  CONSTRAINT credit_notes_void_check CHECK ((status = 'VOID') = (voided_at IS NOT NULL)),
  CONSTRAINT credit_notes_amounts_check CHECK (
    subtotal_cents > 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents
    AND remaining_cents >= 0 AND remaining_cents <= total_cents
  ),
  CONSTRAINT credit_notes_remaining_check CHECK ((status = 'OPEN') = (remaining_cents > 0)),
  CONSTRAINT credit_notes_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT credit_notes_text_check CHECK (
    (reference IS NULL OR length(reference) <= 100) AND (memo IS NULL OR length(memo) <= 4000)
    AND (void_reason IS NULL OR length(void_reason) <= 500)
  ),
  CONSTRAINT credit_notes_org_customer_fkey FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_org_vendor_fkey FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.vendors(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_org_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_org_bill_fkey FOREIGN KEY (org_id, bill_id)
    REFERENCES public.bills(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.credit_note_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  credit_note_id    UUID NOT NULL,
  line_position     INTEGER NOT NULL,
  description       TEXT NOT NULL,
  account_id        UUID NOT NULL,
  inventory_item_id UUID,
  quantity          NUMERIC(16, 3),
  unit_price_cents  BIGINT,
  tax_rate          NUMERIC(5, 2),
  amount_cents      BIGINT NOT NULL,
  tax_cents         BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT credit_note_lines_position_key UNIQUE (credit_note_id, line_position),
  CONSTRAINT credit_note_lines_parent_fkey FOREIGN KEY (org_id, credit_note_id)
    REFERENCES public.credit_notes(org_id, id) ON DELETE CASCADE,
  CONSTRAINT credit_note_lines_account_fkey FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_note_lines_item_fkey FOREIGN KEY (org_id, inventory_item_id)
    REFERENCES public.inventory_items(org_id, id) ON DELETE SET NULL (inventory_item_id),
  CONSTRAINT credit_note_lines_amounts_check CHECK (amount_cents > 0 AND tax_cents >= 0),
  CONSTRAINT credit_note_lines_quantity_check CHECK (quantity IS NULL OR quantity > 0)
);

-- Each use of a credit: applied to an invoice or bill, or refunded.
CREATE TABLE public.credit_applications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL,
  credit_note_id            UUID NOT NULL,
  kind                      TEXT NOT NULL,
  number                    TEXT,
  invoice_id                UUID,
  bill_id                   UUID,
  money_account_id          UUID,
  amount_cents              BIGINT NOT NULL,
  applied_date              DATE NOT NULL,
  reference                 TEXT,
  journal_entry_id          UUID,
  reversed_at               TIMESTAMPTZ,
  reversed_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_journal_entry_id UUID,
  reversal_reason           TEXT,
  created_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key           TEXT NOT NULL,
  CONSTRAINT credit_applications_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT credit_applications_kind_check CHECK (
    (kind = 'APPLY' AND (invoice_id IS NULL) <> (bill_id IS NULL)
      AND money_account_id IS NULL AND journal_entry_id IS NULL AND number IS NULL)
    OR (kind = 'REFUND' AND invoice_id IS NULL AND bill_id IS NULL
      AND money_account_id IS NOT NULL AND journal_entry_id IS NOT NULL AND number IS NOT NULL)
  ),
  CONSTRAINT credit_applications_amount_check CHECK (amount_cents > 0),
  CONSTRAINT credit_applications_reversal_check CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL)),
  CONSTRAINT credit_applications_text_check CHECK (
    (reference IS NULL OR length(reference) <= 100) AND (reversal_reason IS NULL OR length(reversal_reason) <= 500)
  ),
  CONSTRAINT credit_applications_credit_fkey FOREIGN KEY (org_id, credit_note_id)
    REFERENCES public.credit_notes(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_applications_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_applications_bill_fkey FOREIGN KEY (org_id, bill_id)
    REFERENCES public.bills(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_applications_money_account_fkey FOREIGN KEY (org_id, money_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_applications_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_credit_notes_org_kind_date ON public.credit_notes(org_id, kind, credit_date DESC);
CREATE INDEX idx_credit_notes_open ON public.credit_notes(org_id, kind) WHERE status = 'OPEN';
CREATE INDEX idx_credit_note_lines_parent ON public.credit_note_lines(credit_note_id);
CREATE INDEX idx_credit_applications_credit ON public.credit_applications(credit_note_id);
CREATE INDEX idx_credit_applications_invoice ON public.credit_applications(org_id, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_credit_applications_bill ON public.credit_applications(org_id, bill_id) WHERE bill_id IS NOT NULL;

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_notes_select_policy ON public.credit_notes
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY credit_note_lines_select_policy ON public.credit_note_lines
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY credit_applications_select_policy ON public.credit_applications
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.credit_notes, public.credit_note_lines, public.credit_applications
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.credit_notes, public.credit_note_lines, public.credit_applications
  TO service_role;

-- A use of a credit is undone by marking it reversed, never by editing or
-- deleting it; only the functions below change these rows.
DROP TRIGGER IF EXISTS credit_applications_permanent ON public.credit_applications;
CREATE TRIGGER credit_applications_permanent
  BEFORE UPDATE OR DELETE ON public.credit_applications
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Purchase lines as an expense carries them, checked once for every
-- document that uses them (supplier credits, purchase orders): a
-- description, an active expense, cost of sales or asset account that is
-- not a control or money account, an amount and VAT in cents, and for a
-- stock item the quantity, whole for counted stock.
CREATE OR REPLACE FUNCTION private.prepare_purchase_lines(
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
  v_amount BIGINT;
  v_tax BIGINT;
  v_item_id UUID;
  v_item_type TEXT;
  v_quantity NUMERIC;
  v_unit_price BIGINT;
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
      v_amount := (v_line->>'amountCents')::BIGINT;
      v_tax := COALESCE(NULLIF(v_line->>'taxCents', '')::BIGINT, 0);
      v_item_id := NULLIF(v_line->>'inventoryItemId', '')::UUID;
      v_quantity := NULLIF(v_line->>'quantity', '')::NUMERIC;
      v_unit_price := NULLIF(v_line->>'unitPriceCents', '')::BIGINT;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;
    IF v_description IS NULL OR v_description = '' OR length(v_description) > 500 THEN
      RAISE EXCEPTION 'Line % needs a description of up to 500 characters.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 OR v_tax < 0 OR v_amount > 900000000000000 OR v_tax > 900000000000000 THEN
      RAISE EXCEPTION 'Line % needs an amount above zero.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_unit_price IS NOT NULL AND v_unit_price < 0 THEN
      RAISE EXCEPTION 'Line % unit price must be zero or more, in whole cents.', v_position USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type IN ('ASSET', 'COGS', 'EXPENSE') AND account.is_active
      AND NOT account.is_bank_account AND account.code NOT IN ('1100', '1150');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line % must use an active expense, cost of sales or asset account. Receivables, recoverable VAT and bank accounts are not purchase lines.', v_position
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
        RAISE EXCEPTION 'Line %: enter the quantity.', v_position USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_item_type, '') NOT ILIKE '%service%' AND v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION 'Line %: stock is counted in whole units.', v_position USING ERRCODE = '22023';
      END IF;
    ELSIF v_quantity IS NOT NULL AND (v_quantity <= 0 OR v_quantity > 1000000000) THEN
      RAISE EXCEPTION 'Line % quantity must be above zero.', v_position USING ERRCODE = '22023';
    END IF;

    v_subtotal := v_subtotal + v_amount;
    v_tax_total := v_tax_total + v_tax;
    v_prepared := v_prepared || jsonb_build_array(jsonb_build_object(
      'position', v_position, 'description', v_description, 'accountId', v_account_id,
      'itemId', v_item_id, 'quantity', v_quantity, 'unitPrice', v_unit_price, 'amount', v_amount, 'tax', v_tax,
      'stocked', v_item_id IS NOT NULL AND COALESCE(v_item_type, '') NOT ILIKE '%service%'));
  END LOOP;

  RETURN jsonb_build_object('lines', v_prepared, 'subtotal', v_subtotal, 'tax', v_tax_total);
END;
$function$;

REVOKE ALL ON FUNCTION private.prepare_purchase_lines(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- The active control account with this code, or an error naming it.
CREATE OR REPLACE FUNCTION private.control_account(p_org_id UUID, p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id UUID;
BEGIN
  SELECT account.id INTO v_id FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = p_code AND account.is_active
    AND account.type::TEXT = CASE WHEN p_code IN ('1100', '1150') THEN 'ASSET' ELSE 'LIABILITY' END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active % account % is required.',
      CASE p_code WHEN '1100' THEN 'Accounts Receivable' WHEN '1150' THEN 'Recoverable VAT'
        WHEN '2000' THEN 'Accounts Payable' ELSE 'Output VAT' END, p_code
      USING ERRCODE = '23503';
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.control_account(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- A retry with the same key returns the credit posted the first time.
CREATE OR REPLACE FUNCTION private.existing_credit_note(p_org_id UUID, p_idempotency_key TEXT)
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
    pg_catalog.hashtextextended(p_org_id::TEXT || ':credit:' || p_idempotency_key, 0)
  );
  SELECT credit.id, credit.number, credit.total_cents, credit.remaining_cents, credit.journal_entry_id INTO v_row
  FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('id', v_row.id, 'number', v_row.number, 'totalCents', v_row.total_cents,
    'appliedCents', v_row.total_cents - v_row.remaining_cents, 'journalEntryId', v_row.journal_entry_id);
END;
$function$;

REVOKE ALL ON FUNCTION private.existing_credit_note(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Credits applied to an invoice or bill being voided go back to their
-- credit notes, unused. The caller settles the document itself.
CREATE OR REPLACE FUNCTION private.release_credit_applications(
  p_org_id UUID,
  p_document_type TEXT,
  p_document_id UUID,
  p_reason TEXT,
  p_actor UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_application RECORD;
  v_released BIGINT := 0;
BEGIN
  FOR v_application IN
    SELECT application.id, application.credit_note_id, application.amount_cents
    FROM public.credit_applications AS application
    WHERE application.org_id = p_org_id AND application.kind = 'APPLY' AND application.reversed_at IS NULL
      AND CASE p_document_type WHEN 'INVOICE' THEN application.invoice_id ELSE application.bill_id END = p_document_id
    ORDER BY application.credit_note_id, application.id
    FOR UPDATE
  LOOP
    UPDATE public.credit_applications
    SET reversed_at = now(), reversed_by = p_actor, reversal_reason = p_reason
    WHERE org_id = p_org_id AND id = v_application.id;
    UPDATE public.credit_notes
    SET remaining_cents = remaining_cents + v_application.amount_cents, status = 'OPEN'
    WHERE org_id = p_org_id AND id = v_application.credit_note_id;
    v_released := v_released + v_application.amount_cents;
  END LOOP;
  RETURN v_released;
END;
$function$;

REVOKE ALL ON FUNCTION private.release_credit_applications(UUID, TEXT, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Apply a credit to an open invoice (customer) or bill (supplier).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_credit(
  p_org_id UUID,
  p_credit_note_id UUID,
  p_document_id UUID,
  p_amount_cents BIGINT,
  p_applied_date DATE,
  p_actor UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_kind TEXT;
  v_existing RECORD;
  v_credit RECORD;
  v_document RECORD;
  v_base_currency TEXT;
  v_application_id UUID := gen_random_uuid();
  v_new_due BIGINT;
  v_status TEXT;
  v_remaining BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':credit-use:' || p_idempotency_key, 0)
  );
  SELECT application.id, application.credit_note_id, application.invoice_id, application.bill_id, application.amount_cents
  INTO v_existing
  FROM public.credit_applications AS application
  WHERE application.org_id = p_org_id AND application.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.credit_note_id IS DISTINCT FROM p_credit_note_id
       OR COALESCE(v_existing.invoice_id, v_existing.bill_id) IS DISTINCT FROM p_document_id
       OR v_existing.amount_cents IS DISTINCT FROM p_amount_cents THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different credit.' USING ERRCODE = '23505';
    END IF;
    SELECT credit.remaining_cents INTO v_remaining FROM public.credit_notes AS credit
    WHERE credit.org_id = p_org_id AND credit.id = p_credit_note_id;
    RETURN jsonb_build_object('applicationId', v_existing.id, 'remainingCents', v_remaining);
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Apply an amount above zero.' USING ERRCODE = '22023';
  END IF;
  IF p_applied_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;

  -- The document is locked before the credit, the order a void takes.
  SELECT credit.kind INTO v_kind FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.id = p_credit_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_kind = 'CUSTOMER' THEN
    SELECT invoice.id, invoice.invoice_number AS number, invoice.customer_id AS party_id, invoice.status,
           invoice.total_cents, invoice.amount_due_cents, upper(invoice.currency) AS currency
    INTO v_document
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = p_document_id
    FOR UPDATE;
  ELSE
    SELECT bill.id, bill.bill_number AS number, bill.vendor_id AS party_id, bill.status,
           bill.total_cents, bill.amount_due_cents, upper(bill.currency) AS currency
    INTO v_document
    FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.id = p_document_id
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% not found in this organization.', CASE v_kind WHEN 'CUSTOMER' THEN 'Invoice' ELSE 'Bill' END
      USING ERRCODE = '23503';
  END IF;

  SELECT credit.* INTO v_credit FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.id = p_credit_note_id
  FOR UPDATE;
  IF v_credit.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Credit % has nothing left to use.', v_credit.number USING ERRCODE = '23514';
  END IF;
  IF p_amount_cents > v_credit.remaining_cents THEN
    RAISE EXCEPTION 'Credit % has % cents left; apply no more than that.', v_credit.number, v_credit.remaining_cents
      USING ERRCODE = '23514';
  END IF;
  IF p_applied_date < v_credit.credit_date THEN
    RAISE EXCEPTION 'A credit is applied on or after its own date.' USING ERRCODE = '22023';
  END IF;
  IF v_document.party_id IS DISTINCT FROM COALESCE(v_credit.customer_id, v_credit.vendor_id) THEN
    RAISE EXCEPTION 'Credit % belongs to a different %.', v_credit.number,
      CASE v_kind WHEN 'CUSTOMER' THEN 'customer' ELSE 'supplier' END USING ERRCODE = '23514';
  END IF;
  IF v_document.status IN ('PAID', 'VOID') OR v_document.amount_due_cents <= 0 THEN
    RAISE EXCEPTION '% has nothing due.', v_document.number USING ERRCODE = '23514';
  END IF;
  IF p_amount_cents > v_document.amount_due_cents THEN
    RAISE EXCEPTION 'Apply no more than the % cents due on %.', v_document.amount_due_cents, v_document.number
      USING ERRCODE = '23514';
  END IF;
  SELECT upper(org.base_currency) INTO v_base_currency FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_document.currency IS DISTINCT FROM v_base_currency THEN
    RAISE EXCEPTION 'Credits apply to documents in %; % is in %.', v_base_currency, v_document.number, v_document.currency
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.credit_applications (
    id, org_id, credit_note_id, kind, invoice_id, bill_id, amount_cents, applied_date, created_by, idempotency_key
  ) VALUES (
    v_application_id, p_org_id, p_credit_note_id, 'APPLY',
    CASE WHEN v_kind = 'CUSTOMER' THEN p_document_id END, CASE WHEN v_kind = 'SUPPLIER' THEN p_document_id END,
    p_amount_cents, p_applied_date, p_actor, p_idempotency_key
  );

  v_remaining := v_credit.remaining_cents - p_amount_cents;
  UPDATE public.credit_notes
  SET remaining_cents = v_remaining, status = CASE WHEN v_remaining = 0 THEN 'CLOSED' ELSE 'OPEN' END
  WHERE org_id = p_org_id AND id = p_credit_note_id;

  v_new_due := v_document.amount_due_cents - p_amount_cents;
  v_status := CASE WHEN v_new_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  IF v_kind = 'CUSTOMER' THEN
    UPDATE public.invoices SET amount_due_cents = v_new_due, status = v_status
    WHERE org_id = p_org_id AND id = p_document_id;
    UPDATE public.customers SET balance = greatest(COALESCE(balance, 0) - p_amount_cents, 0)
    WHERE org_id = p_org_id AND id = v_document.party_id;
  ELSE
    UPDATE public.bills SET amount_due_cents = v_new_due, status = v_status
    WHERE org_id = p_org_id AND id = p_document_id;
    UPDATE public.vendors SET balance = greatest(COALESCE(balance, 0) - p_amount_cents, 0)
    WHERE org_id = p_org_id AND id = v_document.party_id;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'APPLY', 'CREDIT_NOTE', p_credit_note_id,
    jsonb_build_object('number', v_credit.number, 'applicationId', v_application_id, 'documentId', p_document_id,
      'documentNumber', v_document.number, 'amountCents', p_amount_cents, 'amountDueCents', v_new_due));

  RETURN jsonb_build_object('applicationId', v_application_id, 'remainingCents', v_remaining,
    'documentNumber', v_document.number, 'amountDueCents', v_new_due, 'status', v_status);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A credit note to a customer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_credit_note(
  p_org_id UUID,
  p_customer_id UUID,
  p_invoice_id UUID,
  p_credit_date DATE,
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
  v_party TEXT;
  v_invoice RECORD;
  v_prepared JSONB;
  v_line JSONB;
  v_subtotal BIGINT;
  v_tax BIGINT;
  v_receivable UUID;
  v_output_vat UUID;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
  v_journal JSONB := '[]'::JSONB;
  v_entry_id UUID;
  v_applied BIGINT := 0;
  v_against TEXT;
  v_open_due BIGINT := 0;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_existing := private.existing_credit_note(p_org_id, p_idempotency_key);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF p_credit_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;
  SELECT customer.display_name INTO v_party FROM public.customers AS customer
  WHERE customer.org_id = p_org_id AND customer.id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer does not belong to this organization.' USING ERRCODE = '23503';
  END IF;
  IF p_invoice_id IS NOT NULL THEN
    SELECT invoice.id, invoice.invoice_number, invoice.customer_id, invoice.status, invoice.amount_due_cents,
           upper(invoice.currency) AS currency
    INTO v_invoice
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id
    FOR UPDATE;
    IF NOT FOUND OR v_invoice.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'The invoice is not one of this customer''s.' USING ERRCODE = '23503';
    END IF;
    IF v_invoice.status = 'VOID' THEN
      RAISE EXCEPTION 'Invoice % is void; nothing is owed on it to credit.', v_invoice.invoice_number USING ERRCODE = '23514';
    END IF;
    v_against := v_invoice.invoice_number;
    IF v_invoice.status <> 'PAID' AND v_invoice.currency = (
      SELECT upper(org.base_currency) FROM public.organizations AS org WHERE org.id = p_org_id
    ) THEN
      v_open_due := greatest(v_invoice.amount_due_cents, 0);
    END IF;
  END IF;

  v_prepared := private.prepare_sales_lines(p_org_id, p_lines, 'credit note');
  v_subtotal := (v_prepared->>'subtotal')::BIGINT;
  v_tax := (v_prepared->>'tax')::BIGINT;
  v_receivable := private.control_account(p_org_id, '1100');
  IF v_tax > 0 THEN
    v_output_vat := private.control_account(p_org_id, '2100');
  END IF;

  v_number := 'CN-' || to_char(p_credit_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'CREDIT_NOTE')::TEXT, 5, '0');
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_prepared->'lines')
  LOOP
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_line->>'accountId', 'debit', (v_line->>'amount')::BIGINT, 'credit', 0,
      'description', v_line->>'description', 'entityType', 'CUSTOMER', 'entityId', p_customer_id));
  END LOOP;
  IF v_tax > 0 THEN
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_output_vat, 'debit', v_tax, 'credit', 0, 'description', 'Output VAT — ' || v_number));
  END IF;
  v_journal := v_journal || jsonb_build_array(jsonb_build_object(
    'accountId', v_receivable, 'debit', 0, 'credit', v_subtotal + v_tax,
    'description', 'Credit note ' || v_number || ' — ' || v_party, 'entityType', 'CUSTOMER', 'entityId', p_customer_id));

  v_entry_id := private.insert_journal_entry(
    p_org_id, p_credit_date, 'Credit note ' || v_number || ' — ' || v_party
      || COALESCE(' (invoice ' || v_against || ')', ''),
    'CREDIT_NOTE', v_id, v_number, p_actor, v_journal, 'credit-note:' || p_idempotency_key);

  INSERT INTO public.credit_notes (
    id, org_id, kind, number, credit_date, customer_id, invoice_id, memo, currency,
    subtotal_cents, tax_cents, total_cents, remaining_cents, journal_entry_id, created_by, idempotency_key
  )
  SELECT v_id, p_org_id, 'CUSTOMER', v_number, p_credit_date, p_customer_id, p_invoice_id,
         NULLIF(btrim(COALESCE(p_memo, '')), ''), upper(org.base_currency),
         v_subtotal, v_tax, v_subtotal + v_tax, v_subtotal + v_tax, v_entry_id, p_actor, p_idempotency_key
  FROM public.organizations AS org WHERE org.id = p_org_id;

  INSERT INTO public.credit_note_lines (
    org_id, credit_note_id, line_position, description, account_id, inventory_item_id,
    quantity, unit_price_cents, tax_rate, amount_cents, tax_cents
  )
  SELECT p_org_id, v_id, (line->>'position')::INTEGER, line->>'description', (line->>'accountId')::UUID,
         NULLIF(line->>'itemId', '')::UUID, (line->>'quantity')::NUMERIC, (line->>'unitPrice')::BIGINT,
         (line->>'taxRate')::NUMERIC, (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line);

  -- Goods the customer returned come back into stock.
  FOR v_line IN
    SELECT jsonb_build_object('itemId', line->>'itemId', 'quantity', sum((line->>'quantity')::NUMERIC)::INTEGER)
    FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line)
    WHERE (line->>'stocked')::BOOLEAN
    GROUP BY line->>'itemId'
  LOOP
    PERFORM private.move_stock(p_org_id, (v_line->>'itemId')::UUID, (v_line->>'quantity')::INTEGER,
      'CREDIT_NOTE', v_id, 'Returned on ' || v_number, p_actor);
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'CREDIT_NOTE', v_id,
    jsonb_build_object('number', v_number, 'totalCents', v_subtotal + v_tax, 'invoiceId', p_invoice_id));

  -- Raised against an invoice with something still due: applied to it at once.
  IF v_open_due > 0 THEN
    v_applied := least(v_subtotal + v_tax, v_open_due);
    PERFORM public.apply_credit(p_org_id, v_id, p_invoice_id, v_applied, p_credit_date, p_actor,
      'credit-note:' || p_idempotency_key || ':apply');
  END IF;

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', v_subtotal + v_tax,
    'appliedCents', v_applied, 'journalEntryId', v_entry_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. A credit from a supplier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_credit(
  p_org_id UUID,
  p_vendor_id UUID,
  p_bill_id UUID,
  p_credit_date DATE,
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
  v_party TEXT;
  v_bill RECORD;
  v_prepared JSONB;
  v_line JSONB;
  v_subtotal BIGINT;
  v_tax BIGINT;
  v_payable UUID;
  v_input_vat UUID;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
  v_journal JSONB;
  v_entry_id UUID;
  v_applied BIGINT := 0;
  v_against TEXT;
  v_open_due BIGINT := 0;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_existing := private.existing_credit_note(p_org_id, p_idempotency_key);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF p_credit_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;
  SELECT vendor.display_name INTO v_party FROM public.vendors AS vendor
  WHERE vendor.org_id = p_org_id AND vendor.id = p_vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor does not belong to this organization.' USING ERRCODE = '23503';
  END IF;
  IF p_bill_id IS NOT NULL THEN
    SELECT bill.id, bill.bill_number, bill.vendor_id, bill.status, bill.amount_due_cents, upper(bill.currency) AS currency
    INTO v_bill
    FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.id = p_bill_id
    FOR UPDATE;
    IF NOT FOUND OR v_bill.vendor_id IS DISTINCT FROM p_vendor_id THEN
      RAISE EXCEPTION 'The bill is not one of this supplier''s.' USING ERRCODE = '23503';
    END IF;
    IF v_bill.status = 'VOID' THEN
      RAISE EXCEPTION 'Bill % is void; nothing is owed on it to credit.', v_bill.bill_number USING ERRCODE = '23514';
    END IF;
    v_against := v_bill.bill_number;
    IF v_bill.status <> 'PAID' AND v_bill.currency = (
      SELECT upper(org.base_currency) FROM public.organizations AS org WHERE org.id = p_org_id
    ) THEN
      v_open_due := greatest(v_bill.amount_due_cents, 0);
    END IF;
  END IF;

  v_prepared := private.prepare_purchase_lines(p_org_id, p_lines, 'supplier credit');
  v_subtotal := (v_prepared->>'subtotal')::BIGINT;
  v_tax := (v_prepared->>'tax')::BIGINT;
  v_payable := private.control_account(p_org_id, '2000');
  IF v_tax > 0 THEN
    v_input_vat := private.control_account(p_org_id, '1150');
  END IF;

  v_number := 'SC-' || to_char(p_credit_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'SUPPLIER_CREDIT')::TEXT, 5, '0');
  v_journal := jsonb_build_array(jsonb_build_object(
    'accountId', v_payable, 'debit', v_subtotal + v_tax, 'credit', 0,
    'description', 'Supplier credit ' || v_number || ' — ' || v_party, 'entityType', 'VENDOR', 'entityId', p_vendor_id));
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_prepared->'lines')
  LOOP
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_line->>'accountId', 'debit', 0, 'credit', (v_line->>'amount')::BIGINT,
      'description', v_line->>'description', 'entityType', 'VENDOR', 'entityId', p_vendor_id));
  END LOOP;
  IF v_tax > 0 THEN
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_input_vat, 'debit', 0, 'credit', v_tax, 'description', 'Recoverable VAT — ' || v_number));
  END IF;

  v_entry_id := private.insert_journal_entry(
    p_org_id, p_credit_date, 'Supplier credit ' || v_number || ' — ' || v_party
      || COALESCE(' (bill ' || v_against || ')', ''),
    'SUPPLIER_CREDIT', v_id, COALESCE(NULLIF(btrim(COALESCE(p_reference, '')), ''), v_number), p_actor, v_journal,
    'supplier-credit:' || p_idempotency_key);

  INSERT INTO public.credit_notes (
    id, org_id, kind, number, credit_date, vendor_id, bill_id, reference, memo, currency,
    subtotal_cents, tax_cents, total_cents, remaining_cents, journal_entry_id, created_by, idempotency_key
  )
  SELECT v_id, p_org_id, 'SUPPLIER', v_number, p_credit_date, p_vendor_id, p_bill_id,
         NULLIF(btrim(COALESCE(p_reference, '')), ''), NULLIF(btrim(COALESCE(p_memo, '')), ''), upper(org.base_currency),
         v_subtotal, v_tax, v_subtotal + v_tax, v_subtotal + v_tax, v_entry_id, p_actor, p_idempotency_key
  FROM public.organizations AS org WHERE org.id = p_org_id;

  INSERT INTO public.credit_note_lines (
    org_id, credit_note_id, line_position, description, account_id, inventory_item_id,
    quantity, unit_price_cents, amount_cents, tax_cents
  )
  SELECT p_org_id, v_id, (line->>'position')::INTEGER, line->>'description', (line->>'accountId')::UUID,
         NULLIF(line->>'itemId', '')::UUID, NULLIF(line->>'quantity', '')::NUMERIC, NULLIF(line->>'unitPrice', '')::BIGINT,
         (line->>'amount')::BIGINT, (line->>'tax')::BIGINT
  FROM jsonb_array_elements(v_prepared->'lines') AS prepared(line);

  -- Goods sent back to the supplier leave stock.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_prepared->'lines') WHERE (value->>'stocked')::BOOLEAN
  LOOP
    PERFORM private.move_stock(p_org_id, (v_line->>'itemId')::UUID, -((v_line->>'quantity')::NUMERIC::INTEGER),
      'SUPPLIER_CREDIT', v_id, 'Returned on ' || v_number, p_actor,
      'supplier-credit:' || v_id::TEXT || ':' || (v_line->>'position'));
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'SUPPLIER_CREDIT', v_id,
    jsonb_build_object('number', v_number, 'totalCents', v_subtotal + v_tax, 'billId', p_bill_id));

  IF v_open_due > 0 THEN
    v_applied := least(v_subtotal + v_tax, v_open_due);
    PERFORM public.apply_credit(p_org_id, v_id, p_bill_id, v_applied, p_credit_date, p_actor,
      'supplier-credit:' || p_idempotency_key || ':apply');
  END IF;

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', v_subtotal + v_tax,
    'appliedCents', v_applied, 'journalEntryId', v_entry_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Refund what is left of a credit: money paid back to the customer, or
-- received back from the supplier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_credit(
  p_org_id UUID,
  p_credit_note_id UUID,
  p_amount_cents BIGINT,
  p_refund_date DATE,
  p_money_account_id UUID,
  p_reference TEXT,
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
  v_credit RECORD;
  v_party TEXT;
  v_base_currency TEXT;
  v_account_currency TEXT;
  v_application_id UUID := gen_random_uuid();
  v_number TEXT;
  v_control UUID;
  v_entry_id UUID;
  v_remaining BIGINT;
  v_entity TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':credit-use:' || p_idempotency_key, 0)
  );
  SELECT application.id, application.number, application.credit_note_id, application.amount_cents, application.journal_entry_id
  INTO v_existing
  FROM public.credit_applications AS application
  WHERE application.org_id = p_org_id AND application.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.credit_note_id IS DISTINCT FROM p_credit_note_id OR v_existing.amount_cents IS DISTINCT FROM p_amount_cents THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different credit.' USING ERRCODE = '23505';
    END IF;
    SELECT credit.remaining_cents INTO v_remaining FROM public.credit_notes AS credit
    WHERE credit.org_id = p_org_id AND credit.id = p_credit_note_id;
    RETURN jsonb_build_object('applicationId', v_existing.id, 'number', v_existing.number,
      'journalEntryId', v_existing.journal_entry_id, 'remainingCents', v_remaining);
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Refund an amount above zero.' USING ERRCODE = '22023';
  END IF;
  IF p_refund_date IS NULL THEN
    RAISE EXCEPTION 'The date is required.' USING ERRCODE = '22023';
  END IF;
  SELECT credit.* INTO v_credit FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.id = p_credit_note_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_credit.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Credit % has nothing left to refund.', v_credit.number USING ERRCODE = '23514';
  END IF;
  IF p_amount_cents > v_credit.remaining_cents THEN
    RAISE EXCEPTION 'Credit % has % cents left; refund no more than that.', v_credit.number, v_credit.remaining_cents
      USING ERRCODE = '23514';
  END IF;
  IF p_refund_date < v_credit.credit_date THEN
    RAISE EXCEPTION 'A refund is dated on or after the credit it pays out.' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_money_account_id,
    CASE v_credit.kind WHEN 'CUSTOMER' THEN 'The account the refund was paid from' ELSE 'The account the refund went into' END);
  SELECT upper(org.base_currency) INTO v_base_currency FROM public.organizations AS org WHERE org.id = p_org_id;
  SELECT upper(account.currency) INTO v_account_currency FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_money_account_id;
  IF v_account_currency IS NOT NULL AND v_account_currency <> v_base_currency THEN
    RAISE EXCEPTION 'Refunds move money through an account in %.', v_base_currency USING ERRCODE = '22023';
  END IF;

  IF v_credit.kind = 'CUSTOMER' THEN
    SELECT customer.display_name INTO v_party FROM public.customers AS customer
    WHERE customer.org_id = p_org_id AND customer.id = v_credit.customer_id;
    v_control := private.control_account(p_org_id, '1100');
    v_entity := 'CUSTOMER';
  ELSE
    SELECT vendor.display_name INTO v_party FROM public.vendors AS vendor
    WHERE vendor.org_id = p_org_id AND vendor.id = v_credit.vendor_id;
    v_control := private.control_account(p_org_id, '2000');
    v_entity := 'VENDOR';
  END IF;

  v_number := 'RF-' || to_char(p_refund_date, 'YYYY') || '-' || lpad(private.next_document_number(p_org_id, 'REFUND')::TEXT, 5, '0');
  v_entry_id := private.insert_journal_entry(
    p_org_id, p_refund_date, 'Refund ' || v_number || ' of ' || v_credit.number || ' — ' || v_party,
    'CREDIT_REFUND', v_application_id, v_number, p_actor,
    CASE v_credit.kind
      WHEN 'CUSTOMER' THEN jsonb_build_array(
        jsonb_build_object('accountId', v_control, 'debit', p_amount_cents, 'credit', 0,
          'description', 'Refund of ' || v_credit.number, 'entityType', v_entity, 'entityId', v_credit.customer_id),
        jsonb_build_object('accountId', p_money_account_id, 'debit', 0, 'credit', p_amount_cents,
          'description', 'Refund ' || v_number || ' — ' || v_party))
      ELSE jsonb_build_array(
        jsonb_build_object('accountId', p_money_account_id, 'debit', p_amount_cents, 'credit', 0,
          'description', 'Refund ' || v_number || ' — ' || v_party),
        jsonb_build_object('accountId', v_control, 'debit', 0, 'credit', p_amount_cents,
          'description', 'Refund of ' || v_credit.number, 'entityType', v_entity, 'entityId', v_credit.vendor_id))
    END,
    'credit-refund:' || p_idempotency_key);

  INSERT INTO public.credit_applications (
    id, org_id, credit_note_id, kind, number, money_account_id, amount_cents, applied_date, reference,
    journal_entry_id, created_by, idempotency_key
  ) VALUES (
    v_application_id, p_org_id, p_credit_note_id, 'REFUND', v_number, p_money_account_id, p_amount_cents, p_refund_date,
    NULLIF(btrim(COALESCE(p_reference, '')), ''), v_entry_id, p_actor, p_idempotency_key
  );

  v_remaining := v_credit.remaining_cents - p_amount_cents;
  UPDATE public.credit_notes
  SET remaining_cents = v_remaining, status = CASE WHEN v_remaining = 0 THEN 'CLOSED' ELSE 'OPEN' END
  WHERE org_id = p_org_id AND id = p_credit_note_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'REFUND', 'CREDIT_NOTE', p_credit_note_id,
    jsonb_build_object('number', v_credit.number, 'refundNumber', v_number, 'applicationId', v_application_id,
      'amountCents', p_amount_cents, 'journalEntryId', v_entry_id));

  RETURN jsonb_build_object('applicationId', v_application_id, 'number', v_number,
    'journalEntryId', v_entry_id, 'remainingCents', v_remaining);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Undo one use of a credit. An application puts the amount back on the
-- invoice or bill; a refund is reversed with a dated entry. Either way the
-- amount is back on the credit, to use again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_credit_application(
  p_org_id UUID,
  p_application_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_peek RECORD;
  v_application RECORD;
  v_credit RECORD;
  v_document RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
  v_new_due BIGINT;
  v_status TEXT;
  v_document_number TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT application.invoice_id, application.bill_id INTO v_peek
  FROM public.credit_applications AS application
  WHERE application.org_id = p_org_id AND application.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found in this organization.' USING ERRCODE = '23503';
  END IF;

  -- Document, then the use, then the credit: the order a void takes.
  IF v_peek.invoice_id IS NOT NULL THEN
    SELECT invoice.id, invoice.invoice_number AS number, invoice.customer_id AS party_id, invoice.status,
           invoice.total_cents, invoice.amount_due_cents
    INTO v_document
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = v_peek.invoice_id
    FOR UPDATE;
  ELSIF v_peek.bill_id IS NOT NULL THEN
    SELECT bill.id, bill.bill_number AS number, bill.vendor_id AS party_id, bill.status,
           bill.total_cents, bill.amount_due_cents
    INTO v_document
    FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.id = v_peek.bill_id
    FOR UPDATE;
  END IF;
  IF v_peek.invoice_id IS NOT NULL OR v_peek.bill_id IS NOT NULL THEN
    v_document_number := v_document.number;
  END IF;

  SELECT application.* INTO v_application
  FROM public.credit_applications AS application
  WHERE application.org_id = p_org_id AND application.id = p_application_id
  FOR UPDATE;
  SELECT credit.* INTO v_credit FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.id = v_application.credit_note_id
  FOR UPDATE;

  IF v_application.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object('applicationId', p_application_id, 'remainingCents', v_credit.remaining_cents,
      'reversalJournalEntryId', v_application.reversal_journal_entry_id);
  END IF;
  v_reason := private.require_reason(p_reason, CASE v_application.kind WHEN 'REFUND' THEN 'this refund' ELSE 'this applied credit' END);
  IF v_credit.status = 'VOID' THEN
    RAISE EXCEPTION 'Credit % is void.', v_credit.number USING ERRCODE = '23514';
  END IF;

  IF v_application.kind = 'REFUND' THEN
    IF p_reversal_date IS NULL OR p_reversal_date < v_application.applied_date THEN
      RAISE EXCEPTION 'A reversal is dated on or after the refund it reverses.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.bank_transactions AS line
      WHERE line.org_id = p_org_id AND line.matched_journal_entry_id = v_application.journal_entry_id
    ) THEN
      RAISE EXCEPTION 'A bank statement line is matched to refund %. Undo that match first.', v_application.number
        USING ERRCODE = '23514';
    END IF;
    v_reversal_id := private.insert_journal_entry(
      p_org_id, p_reversal_date, 'Reverse refund ' || v_application.number || ': ' || v_reason, 'ADJUSTMENT',
      p_application_id, 'REV-' || v_application.number, p_actor,
      private.reversal_lines(p_org_id, v_application.journal_entry_id, v_application.number),
      'credit-refund-reversal:' || p_application_id::TEXT);
  ELSE
    IF v_document.status = 'VOID' THEN
      RAISE EXCEPTION '% is void.', v_document.number USING ERRCODE = '23514';
    END IF;
    v_new_due := v_document.amount_due_cents + v_application.amount_cents;
    IF v_application.invoice_id IS NOT NULL THEN
      v_status := CASE WHEN v_new_due >= v_document.total_cents THEN 'SENT' ELSE 'PARTIALLY_PAID' END;
      UPDATE public.invoices SET amount_due_cents = v_new_due, status = v_status
      WHERE org_id = p_org_id AND id = v_document.id;
      UPDATE public.customers SET balance = COALESCE(balance, 0) + v_application.amount_cents
      WHERE org_id = p_org_id AND id = v_document.party_id;
    ELSE
      v_status := CASE WHEN v_new_due >= v_document.total_cents THEN 'OPEN' ELSE 'PARTIALLY_PAID' END;
      UPDATE public.bills SET amount_due_cents = v_new_due, status = v_status
      WHERE org_id = p_org_id AND id = v_document.id;
      UPDATE public.vendors SET balance = COALESCE(balance, 0) + v_application.amount_cents
      WHERE org_id = p_org_id AND id = v_document.party_id;
    END IF;
  END IF;

  UPDATE public.credit_applications
  SET reversed_at = now(), reversed_by = p_actor, reversal_reason = v_reason, reversal_journal_entry_id = v_reversal_id
  WHERE org_id = p_org_id AND id = p_application_id;
  UPDATE public.credit_notes
  SET remaining_cents = remaining_cents + v_application.amount_cents, status = 'OPEN'
  WHERE org_id = p_org_id AND id = v_credit.id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'REVERSE', 'CREDIT_NOTE', v_credit.id,
    jsonb_build_object('number', v_credit.number, 'applicationId', p_application_id, 'kind', v_application.kind,
      'amountCents', v_application.amount_cents, 'reason', v_reason, 'documentNumber', v_document_number,
      'reversalJournalEntryId', v_reversal_id));

  RETURN jsonb_build_object('applicationId', p_application_id,
    'remainingCents', v_credit.remaining_cents + v_application.amount_cents,
    'reversalJournalEntryId', v_reversal_id, 'documentNumber', v_document_number, 'amountDueCents', v_new_due);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Void a credit nothing has used yet, with a dated reversing entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_credit_note(
  p_org_id UUID,
  p_credit_note_id UUID,
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
  v_credit RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT credit.* INTO v_credit FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.id = p_credit_note_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_credit.status = 'VOID' THEN
    RETURN jsonb_build_object('number', v_credit.number, 'reversalJournalEntryId', v_credit.void_journal_entry_id);
  END IF;
  v_reason := private.require_reason(p_reason, 'this credit');
  IF p_void_date IS NULL OR p_void_date < v_credit.credit_date THEN
    RAISE EXCEPTION 'A void is dated on or after the credit it reverses.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.credit_applications AS application
    WHERE application.org_id = p_org_id AND application.credit_note_id = p_credit_note_id
      AND application.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Credit % has been applied or refunded. Undo those first.', v_credit.number USING ERRCODE = '23514';
  END IF;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_void_date, 'Void ' || v_credit.number || ': ' || v_reason, 'ADJUSTMENT', p_credit_note_id,
    'VOID-' || v_credit.number, p_actor, private.reversal_lines(p_org_id, v_credit.journal_entry_id, v_credit.number),
    'void:credit:' || p_credit_note_id::TEXT);

  UPDATE public.credit_notes
  SET status = 'VOID', remaining_cents = 0, void_journal_entry_id = v_reversal_id,
      voided_at = now(), voided_by = p_actor, void_reason = v_reason
  WHERE org_id = p_org_id AND id = p_credit_note_id;

  PERFORM private.reverse_stock_for(p_org_id, CASE v_credit.kind WHEN 'CUSTOMER' THEN 'CREDIT_NOTE' ELSE 'SUPPLIER_CREDIT' END,
    p_credit_note_id, v_credit.number || ' voided', p_actor);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'VOID', CASE v_credit.kind WHEN 'CUSTOMER' THEN 'CREDIT_NOTE' ELSE 'SUPPLIER_CREDIT' END,
    p_credit_note_id, jsonb_build_object('number', v_credit.number, 'reason', v_reason, 'reversalJournalEntryId', v_reversal_id));

  RETURN jsonb_build_object('number', v_credit.number, 'reversalJournalEntryId', v_reversal_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Balances and the control-account check count unused credits against
-- what is owed, so a credit not yet used still agrees with the ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.control_account_check(p_org_id UUID)
RETURNS TABLE (ar_ledger_cents NUMERIC, open_invoice_cents NUMERIC, ap_ledger_cents NUMERIC, open_bill_cents NUMERIC)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT
    (SELECT COALESCE(sum(line.debit - line.credit), 0)
       FROM public.journal_lines AS line
       JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
      WHERE line.org_id = p_org_id AND account.code = '1100'),
    (SELECT COALESCE(sum(invoice.amount_due_cents), 0)
       FROM public.invoices AS invoice
      WHERE invoice.org_id = p_org_id AND invoice.status NOT IN ('PAID', 'VOID'))
    - (SELECT COALESCE(sum(credit.remaining_cents), 0)
       FROM public.credit_notes AS credit
      WHERE credit.org_id = p_org_id AND credit.kind = 'CUSTOMER' AND credit.status = 'OPEN'),
    (SELECT COALESCE(sum(line.credit - line.debit), 0)
       FROM public.journal_lines AS line
       JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
      WHERE line.org_id = p_org_id AND account.code = '2000'),
    (SELECT COALESCE(sum(bill.amount_due_cents), 0)
       FROM public.bills AS bill
      WHERE bill.org_id = p_org_id AND bill.status NOT IN ('PAID', 'VOID'))
    - (SELECT COALESCE(sum(credit.remaining_cents), 0)
       FROM public.credit_notes AS credit
      WHERE credit.org_id = p_org_id AND credit.kind = 'SUPPLIER' AND credit.status = 'OPEN');
$function$;

CREATE OR REPLACE FUNCTION public.party_balances(p_org_id UUID)
RETURNS TABLE (party_type TEXT, party_id UUID, open_cents BIGINT, overdue_cents BIGINT, open_documents INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT documents.party_type, documents.party_id, sum(documents.open_cents)::BIGINT,
         -- An unused credit is set against the oldest debts first.
         least(sum(documents.overdue_cents), greatest(sum(documents.open_cents), 0))::BIGINT,
         sum(documents.open_documents)::INTEGER
  FROM (
    SELECT 'CUSTOMER' AS party_type, invoice.customer_id AS party_id, invoice.amount_due_cents AS open_cents,
           CASE WHEN invoice.due_date < CURRENT_DATE THEN invoice.amount_due_cents ELSE 0 END AS overdue_cents,
           1 AS open_documents
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.status NOT IN ('PAID', 'VOID') AND invoice.customer_id IS NOT NULL
    UNION ALL
    SELECT 'VENDOR', bill.vendor_id, bill.amount_due_cents,
           CASE WHEN bill.due_date < CURRENT_DATE THEN bill.amount_due_cents ELSE 0 END, 1
    FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.status NOT IN ('PAID', 'VOID') AND bill.vendor_id IS NOT NULL
    UNION ALL
    SELECT CASE credit.kind WHEN 'CUSTOMER' THEN 'CUSTOMER' ELSE 'VENDOR' END,
           COALESCE(credit.customer_id, credit.vendor_id), -credit.remaining_cents, 0, 0
    FROM public.credit_notes AS credit
    WHERE credit.org_id = p_org_id AND credit.status = 'OPEN'
  ) AS documents
  GROUP BY documents.party_type, documents.party_id;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Payments count credits already applied, and voiding an invoice or bill
-- releases the credits applied to it. Otherwise as in 20261004000100 and
-- 20261005000100.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_invoice_payment(
  p_org_id UUID,
  p_invoice_id UUID,
  p_amount_cents BIGINT,
  p_payment_date DATE,
  p_deposit_account_id UUID,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_invoice RECORD;
  v_ar_account_id UUID;
  v_cash_currency TEXT;
  v_base_currency TEXT;
  v_foreign_amount BIGINT;
  v_foreign_paid BIGINT;
  v_new_due BIGINT;
  v_status TEXT;
  v_existing RECORD;
  v_cash_foreign BIGINT;
  v_cash_rate NUMERIC;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':invoice-payment:' || p_idempotency_key, 0)
  );

  SELECT payment.id, payment.journal_entry_id, payment.invoice_id,
         payment.amount_cents, payment.payment_date, payment.account_id,
         invoice.amount_due_cents, invoice.status
  INTO v_existing
  FROM public.invoice_payments AS payment
  JOIN public.invoices AS invoice
    ON invoice.org_id = payment.org_id AND invoice.id = payment.invoice_id
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id IS DISTINCT FROM p_invoice_id
       OR v_existing.amount_cents IS DISTINCT FROM p_amount_cents
       OR v_existing.payment_date IS DISTINCT FROM p_payment_date
       OR v_existing.account_id IS DISTINCT FROM p_deposit_account_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different invoice payment.'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'paymentId', v_existing.id,
      'journalEntryId', v_existing.journal_entry_id,
      'amountDueCents', v_existing.amount_due_cents,
      'status', v_existing.status
    );
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment amount and date are invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT invoice.id, invoice.customer_id, invoice.invoice_number, invoice.status,
         invoice.total_cents, invoice.amount_due_cents, invoice.currency,
         invoice.exchange_rate, invoice.foreign_amount_cents
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_invoice.status IN ('PAID', 'VOID') OR v_invoice.amount_due_cents <= 0 THEN
    RAISE EXCEPTION 'This invoice cannot receive a payment.' USING ERRCODE = '23514';
  END IF;
  IF p_amount_cents > v_invoice.amount_due_cents THEN
    RAISE EXCEPTION 'Payment cannot exceed the invoice amount due.' USING ERRCODE = '23514';
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  SELECT account.currency INTO v_cash_currency
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_deposit_account_id
    AND account.type = 'ASSET' AND account.is_active AND account.is_bank_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payments are deposited to an active bank, cash or M-Pesa account in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_cash_currency NOT IN (v_base_currency, v_invoice.currency) THEN
    RAISE EXCEPTION 'Deposit account currency must match the organization or invoice currency.' USING ERRCODE = '22023';
  END IF;

  SELECT account.id INTO v_ar_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '1100'
    AND account.type = 'ASSET' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Accounts Receivable account 1100 is required.' USING ERRCODE = '23503';
  END IF;

  -- Credits applied count as paid; they apply only to base-currency
  -- invoices, where the foreign amount is the base amount.
  SELECT COALESCE(sum(payment.foreign_amount_cents), 0)::BIGINT
         + COALESCE((SELECT sum(application.amount_cents) FROM public.credit_applications AS application
                     WHERE application.org_id = p_org_id AND application.invoice_id = p_invoice_id
                       AND application.reversed_at IS NULL), 0)::BIGINT
  INTO v_foreign_paid
  FROM public.invoice_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.invoice_id = p_invoice_id
    AND payment.reversed_at IS NULL;

  v_foreign_amount := CASE
    WHEN p_amount_cents = v_invoice.amount_due_cents
      THEN v_invoice.foreign_amount_cents - v_foreign_paid
    ELSE round(p_amount_cents * v_invoice.exchange_rate)::BIGINT
  END;
  IF v_foreign_amount <= 0 THEN
    RAISE EXCEPTION 'Derived foreign payment amount is invalid.' USING ERRCODE = '23514';
  END IF;

  IF v_cash_currency = v_base_currency THEN
    v_cash_foreign := p_amount_cents;
    v_cash_rate := 1;
  ELSE
    v_cash_foreign := v_foreign_amount;
    v_cash_rate := v_invoice.exchange_rate;
  END IF;

  v_journal_id := private.insert_journal_entry(
    p_org_id,
    p_payment_date,
    'Payment received for ' || v_invoice.invoice_number,
    'PAYMENT',
    p_invoice_id,
    v_invoice.invoice_number,
    p_created_by,
    jsonb_build_array(
      jsonb_build_object(
        'accountId', p_deposit_account_id, 'debit', p_amount_cents, 'credit', 0,
        'description', 'Customer payment', 'entityType', 'CUSTOMER',
        'entityId', v_invoice.customer_id, 'currency', v_cash_currency,
        'foreignDebit', v_cash_foreign, 'foreignCredit', 0, 'exchangeRate', v_cash_rate
      ),
      jsonb_build_object(
        'accountId', v_ar_account_id, 'debit', 0, 'credit', p_amount_cents,
        'description', 'Reduce accounts receivable', 'entityType', 'CUSTOMER',
        'entityId', v_invoice.customer_id, 'currency', v_invoice.currency,
        'foreignDebit', 0, 'foreignCredit', v_foreign_amount,
        'exchangeRate', v_invoice.exchange_rate
      )
    ),
    'invoice-payment-post:' || p_idempotency_key
  );

  v_payment_id := gen_random_uuid();
  INSERT INTO public.invoice_payments (
    id, org_id, invoice_id, amount_cents, currency, foreign_amount_cents,
    exchange_rate, payment_date, account_id, journal_entry_id,
    idempotency_key, created_by
  ) VALUES (
    v_payment_id, p_org_id, p_invoice_id, p_amount_cents, v_invoice.currency,
    v_foreign_amount, v_invoice.exchange_rate, p_payment_date, p_deposit_account_id,
    v_journal_id, p_idempotency_key, p_created_by
  );

  v_new_due := v_invoice.amount_due_cents - p_amount_cents;
  v_status := CASE WHEN v_new_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.invoices
  SET amount_due_cents = v_new_due, status = v_status
  WHERE org_id = p_org_id AND id = p_invoice_id;

  UPDATE public.customers
  SET balance = greatest(COALESCE(balance, 0) - p_amount_cents, 0)
  WHERE org_id = p_org_id AND id = v_invoice.customer_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'PAYMENT', 'INVOICE', p_invoice_id,
    jsonb_build_object('paymentId', v_payment_id, 'amountCents', p_amount_cents,
      'amountDueCents', v_new_due, 'status', v_status)
  );

  RETURN jsonb_build_object(
    'paymentId', v_payment_id, 'journalEntryId', v_journal_id,
    'amountDueCents', v_new_due, 'status', v_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_bill(
  p_org_id UUID,
  p_bill_id UUID,
  p_amount_cents BIGINT,
  p_payment_date DATE,
  p_source_account_id UUID,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_bill RECORD;
  v_ap_account_id UUID;
  v_cash_currency TEXT;
  v_base_currency TEXT;
  v_foreign_amount BIGINT;
  v_foreign_paid BIGINT;
  v_new_due BIGINT;
  v_status TEXT;
  v_existing RECORD;
  v_cash_foreign BIGINT;
  v_cash_rate NUMERIC;
  v_threshold BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':bill-payment:' || p_idempotency_key, 0)
  );

  SELECT payment.id, payment.journal_entry_id, payment.bill_id,
         payment.amount_cents, payment.payment_date, payment.account_id,
         bill.amount_due_cents, bill.status
  INTO v_existing
  FROM public.bill_payments AS payment
  JOIN public.bills AS bill
    ON bill.org_id = payment.org_id AND bill.id = payment.bill_id
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.bill_id IS DISTINCT FROM p_bill_id
       OR v_existing.amount_cents IS DISTINCT FROM p_amount_cents
       OR v_existing.payment_date IS DISTINCT FROM p_payment_date
       OR v_existing.account_id IS DISTINCT FROM p_source_account_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different bill payment.'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'paymentId', v_existing.id,
      'journalEntryId', v_existing.journal_entry_id,
      'amountDueCents', v_existing.amount_due_cents,
      'status', v_existing.status
    );
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment amount and date are invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT bill.id, bill.vendor_id, bill.bill_number, bill.status,
         bill.total_cents, bill.amount_due_cents, bill.currency,
         bill.exchange_rate, bill.foreign_amount_cents, bill.approved_at
  INTO v_bill
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id AND bill.id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_bill.status IN ('PAID', 'VOID') OR v_bill.amount_due_cents <= 0 THEN
    RAISE EXCEPTION 'This bill cannot receive a payment.' USING ERRCODE = '23514';
  END IF;
  IF p_amount_cents > v_bill.amount_due_cents THEN
    RAISE EXCEPTION 'Payment cannot exceed the bill amount due.' USING ERRCODE = '23514';
  END IF;
  -- Bills at or above the organization's approval threshold are paid only
  -- after someone other than the person who entered them approves them.
  SELECT org.approval_threshold_cents INTO v_threshold
  FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_threshold IS NOT NULL AND v_bill.total_cents >= v_threshold AND v_bill.approved_at IS NULL THEN
    RAISE EXCEPTION 'Bill % needs approval before it is paid.', v_bill.bill_number USING ERRCODE = '42501';
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  SELECT account.currency INTO v_cash_currency
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_source_account_id
    AND account.type = 'ASSET' AND account.is_active AND account.is_bank_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bills are paid from an active bank, cash or M-Pesa account in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_cash_currency NOT IN (v_base_currency, v_bill.currency) THEN
    RAISE EXCEPTION 'Payment account currency must match the organization or bill currency.' USING ERRCODE = '22023';
  END IF;

  SELECT account.id INTO v_ap_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '2000'
    AND account.type = 'LIABILITY' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Accounts Payable account 2000 is required.' USING ERRCODE = '23503';
  END IF;

  -- Credits applied count as paid; they apply only to base-currency
  -- bills, where the foreign amount is the base amount.
  SELECT COALESCE(sum(payment.foreign_amount_cents), 0)::BIGINT
         + COALESCE((SELECT sum(application.amount_cents) FROM public.credit_applications AS application
                     WHERE application.org_id = p_org_id AND application.bill_id = p_bill_id
                       AND application.reversed_at IS NULL), 0)::BIGINT
  INTO v_foreign_paid
  FROM public.bill_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.bill_id = p_bill_id
    AND payment.reversed_at IS NULL;
  v_foreign_amount := CASE
    WHEN p_amount_cents = v_bill.amount_due_cents
      THEN v_bill.foreign_amount_cents - v_foreign_paid
    ELSE round(p_amount_cents * v_bill.exchange_rate)::BIGINT
  END;
  IF v_foreign_amount <= 0 THEN
    RAISE EXCEPTION 'Derived foreign payment amount is invalid.' USING ERRCODE = '23514';
  END IF;

  IF v_cash_currency = v_base_currency THEN
    v_cash_foreign := p_amount_cents;
    v_cash_rate := 1;
  ELSE
    v_cash_foreign := v_foreign_amount;
    v_cash_rate := v_bill.exchange_rate;
  END IF;

  v_journal_id := private.insert_journal_entry(
    p_org_id,
    p_payment_date,
    'Payment for ' || v_bill.bill_number,
    'PAYMENT',
    p_bill_id,
    v_bill.bill_number,
    p_created_by,
    jsonb_build_array(
      jsonb_build_object(
        'accountId', v_ap_account_id, 'debit', p_amount_cents, 'credit', 0,
        'description', 'Reduce accounts payable', 'entityType', 'VENDOR',
        'entityId', v_bill.vendor_id, 'currency', v_bill.currency,
        'foreignDebit', v_foreign_amount, 'foreignCredit', 0,
        'exchangeRate', v_bill.exchange_rate
      ),
      jsonb_build_object(
        'accountId', p_source_account_id, 'debit', 0, 'credit', p_amount_cents,
        'description', 'Vendor payment', 'entityType', 'VENDOR',
        'entityId', v_bill.vendor_id, 'currency', v_cash_currency,
        'foreignDebit', 0, 'foreignCredit', v_cash_foreign, 'exchangeRate', v_cash_rate
      )
    ),
    'bill-payment-post:' || p_idempotency_key
  );

  v_payment_id := gen_random_uuid();
  INSERT INTO public.bill_payments (
    id, org_id, bill_id, amount_cents, currency, foreign_amount_cents,
    exchange_rate, payment_date, account_id, journal_entry_id,
    idempotency_key, created_by
  ) VALUES (
    v_payment_id, p_org_id, p_bill_id, p_amount_cents, v_bill.currency,
    v_foreign_amount, v_bill.exchange_rate, p_payment_date, p_source_account_id,
    v_journal_id, p_idempotency_key, p_created_by
  );

  v_new_due := v_bill.amount_due_cents - p_amount_cents;
  v_status := CASE WHEN v_new_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.bills
  SET amount_due_cents = v_new_due, status = v_status
  WHERE org_id = p_org_id AND id = p_bill_id;

  UPDATE public.vendors
  SET balance = greatest(COALESCE(balance, 0) - p_amount_cents, 0)
  WHERE org_id = p_org_id AND id = v_bill.vendor_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'PAYMENT', 'BILL', p_bill_id,
    jsonb_build_object('paymentId', v_payment_id, 'amountCents', p_amount_cents,
      'amountDueCents', v_new_due, 'status', v_status)
  );

  RETURN jsonb_build_object(
    'paymentId', v_payment_id, 'journalEntryId', v_journal_id,
    'amountDueCents', v_new_due, 'status', v_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_invoice_with_reversal(
  p_org_id UUID,
  p_invoice_id UUID,
  p_void_date DATE,
  p_created_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invoice RECORD;
  v_original_journal_id UUID;
  v_reversal_lines JSONB;
  v_reversal_id UUID;
  v_released BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_void_date IS NULL THEN
    RAISE EXCEPTION 'Void date is required.' USING ERRCODE = '22023';
  END IF;

  SELECT invoice.customer_id, invoice.invoice_number, invoice.status,
         invoice.amount_due_cents
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_invoice.status = 'VOID' THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_payments AS payment
    WHERE payment.org_id = p_org_id AND payment.invoice_id = p_invoice_id
      AND payment.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A paid or partially paid invoice cannot be voided; reverse its payments first.'
      USING ERRCODE = '23514';
  END IF;

  -- Credits applied to it go back to their credit notes, unused.
  v_released := private.release_credit_applications(p_org_id, 'INVOICE', p_invoice_id,
    'Invoice ' || v_invoice.invoice_number || ' voided', p_created_by);

  SELECT entry.id INTO v_original_journal_id
  FROM public.journal_entries AS entry
  WHERE entry.org_id = p_org_id AND entry.source_type = 'INVOICE'
    AND entry.source_id = p_invoice_id
  ORDER BY entry.posted_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invoice posting journal was not found.' USING ERRCODE = '23503';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'accountId', line.account_id,
    'debit', line.credit,
    'credit', line.debit,
    'description', 'Reversal: ' || COALESCE(line.description, v_invoice.invoice_number),
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
    p_org_id, p_void_date, 'Void invoice ' || v_invoice.invoice_number,
    'ADJUSTMENT', p_invoice_id, 'VOID-' || v_invoice.invoice_number,
    p_created_by, v_reversal_lines, 'void:invoice:' || p_invoice_id::TEXT
  );

  UPDATE public.invoices
  SET status = 'VOID', amount_due_cents = 0
  WHERE org_id = p_org_id AND id = p_invoice_id;
  UPDATE public.customers
  SET balance = greatest(COALESCE(balance, 0) - v_invoice.amount_due_cents, 0)
  WHERE org_id = p_org_id AND id = v_invoice.customer_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'VOID', 'INVOICE', p_invoice_id,
    jsonb_build_object('reversalJournalEntryId', v_reversal_id, 'releasedCreditCents', v_released)
  );
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

REVOKE ALL ON FUNCTION public.apply_credit(UUID, UUID, UUID, BIGINT, DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_credit_note(UUID, UUID, UUID, DATE, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_supplier_credit(UUID, UUID, UUID, DATE, TEXT, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_credit(UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_credit_application(UUID, UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_credit_note(UUID, UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.control_account_check(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.party_balances(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit(UUID, UUID, UUID, BIGINT, DATE, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_credit_note(UUID, UUID, UUID, DATE, TEXT, JSONB, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_credit(UUID, UUID, UUID, DATE, TEXT, TEXT, JSONB, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credit(UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_credit_application(UUID, UUID, DATE, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_credit_note(UUID, UUID, DATE, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.control_account_check(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.party_balances(UUID) TO service_role;

-- Rollback: restore receive_invoice_payment, pay_bill, void_invoice_with_reversal,
-- control_account_check from 20261004000100, void_bill_with_reversal from
-- 20261005000100 and party_balances from 20261004000600; drop the six public
-- functions and four private helpers above, then public.credit_applications,
-- public.credit_note_lines and public.credit_notes.
