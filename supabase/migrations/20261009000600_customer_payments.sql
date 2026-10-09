-- One payment from a customer settling several of their invoices at once:
-- the money is banked once, posted as one entry (so it matches the single
-- deposit on the bank statement), and shared across the invoices it pays,
-- oldest due first unless the person says otherwise. Whatever is left over
-- stays with the customer as a credit, applied to a later invoice or
-- refunded like any other credit.
--
--   Dr  bank, cash or M-Pesa         the amount received
--   Cr  accounts receivable          each invoice's share
--   Cr  accounts receivable          the remainder, kept as credit
--
-- Each invoice's share is an invoice payment like any other, so balances,
-- statements, aging and the control-account check read it as before. The
-- remainder is a customer credit (credit_notes with customer_payment_id set)
-- that carries no lines: it is money received, not a sale taken back, so it
-- never counts against sales or VAT.
--
-- A payment is reversed whole, with a dated entry; its invoices are owed
-- again and its unused credit is withdrawn. Payments are in the base
-- currency; a foreign-currency invoice is paid on its own. In a law firm a
-- fee note is settled from its matter, never by a payment across invoices.

CREATE TABLE public.customer_payments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number                    TEXT NOT NULL,
  customer_id               UUID NOT NULL,
  payment_date              DATE NOT NULL,
  deposit_account_id        UUID NOT NULL,
  amount_cents              BIGINT NOT NULL,
  applied_cents             BIGINT NOT NULL,
  reference                 TEXT,
  memo                      TEXT,
  status                    TEXT NOT NULL DEFAULT 'POSTED',
  journal_entry_id          UUID NOT NULL,
  reversal_journal_entry_id UUID,
  reversed_at               TIMESTAMPTZ,
  reversed_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason           TEXT,
  created_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key           TEXT NOT NULL,
  CONSTRAINT customer_payments_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT customer_payments_org_number_key UNIQUE (org_id, number),
  CONSTRAINT customer_payments_org_idempotency_key UNIQUE (org_id, idempotency_key),
  CONSTRAINT customer_payments_amounts_check CHECK (
    amount_cents > 0 AND applied_cents >= 0 AND applied_cents <= amount_cents
  ),
  CONSTRAINT customer_payments_status_check CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT customer_payments_reversal_check CHECK (
    (status = 'REVERSED') = (reversed_at IS NOT NULL)
    AND (reversed_at IS NULL) = (reversal_journal_entry_id IS NULL)
    AND (reversed_at IS NULL) = (reversal_reason IS NULL)
  ),
  CONSTRAINT customer_payments_text_check CHECK (
    (reference IS NULL OR length(reference) <= 100) AND (memo IS NULL OR length(memo) <= 2000)
    AND (reversal_reason IS NULL OR length(reversal_reason) <= 500)
  ),
  CONSTRAINT customer_payments_org_customer_fkey FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_org_account_fkey FOREIGN KEY (org_id, deposit_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_org_reversal_journal_fkey FOREIGN KEY (org_id, reversal_journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_customer_payments_org_date ON public.customer_payments(org_id, payment_date DESC);
CREATE INDEX idx_customer_payments_customer ON public.customer_payments(org_id, customer_id);

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS customer_payment_id UUID;
ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_customer_payment_fkey FOREIGN KEY (org_id, customer_payment_id)
    REFERENCES public.customer_payments(org_id, id) ON DELETE RESTRICT;
CREATE INDEX idx_invoice_payments_customer_payment ON public.invoice_payments(org_id, customer_payment_id)
  WHERE customer_payment_id IS NOT NULL;

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS customer_payment_id UUID;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_customer_payment_fkey FOREIGN KEY (org_id, customer_payment_id)
    REFERENCES public.customer_payments(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT credit_notes_customer_payment_kind_check CHECK (customer_payment_id IS NULL OR kind = 'CUSTOMER');
CREATE UNIQUE INDEX credit_notes_customer_payment_key ON public.credit_notes(org_id, customer_payment_id)
  WHERE customer_payment_id IS NOT NULL;

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_payments_select_policy ON public.customer_payments
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.customer_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_payments TO service_role;

-- A payment is reversed by marking it, never by editing or deleting it.
DROP TRIGGER IF EXISTS customer_payments_permanent ON public.customer_payments;
CREATE TRIGGER customer_payments_permanent
  BEFORE UPDATE OR DELETE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

-- ---------------------------------------------------------------------------
-- 1. Receive a payment across a customer's invoices.
--
-- p_allocations is [{ "invoiceId": ..., "amountCents": ... }]; NULL shares
-- the amount across the customer's open invoices, oldest due first, and an
-- empty array keeps all of it as credit (money paid in advance).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_customer_payment(
  p_org_id UUID,
  p_customer_id UUID,
  p_payment_date DATE,
  p_deposit_account_id UUID,
  p_amount_cents BIGINT,
  p_allocations JSONB,
  p_reference TEXT,
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
  v_existing RECORD;
  v_customer_name TEXT;
  v_base_currency TEXT;
  v_account_currency TEXT;
  v_receivable UUID;
  v_reference TEXT := NULLIF(btrim(COALESCE(p_reference, '')), '');
  v_memo TEXT := NULLIF(btrim(COALESCE(p_memo, '')), '');
  v_requested JSONB := '[]'::JSONB;
  v_item JSONB;
  v_invoice_id UUID;
  v_amount BIGINT;
  v_invoice RECORD;
  v_shares JSONB := '[]'::JSONB;
  v_share JSONB;
  v_left BIGINT;
  v_applied BIGINT := 0;
  v_credit BIGINT;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
  v_journal JSONB;
  v_entry_id UUID;
  v_credit_id UUID;
  v_new_due BIGINT;
  v_paid JSONB := '[]'::JSONB;
  v_law BOOLEAN;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':customer-payment:' || p_idempotency_key, 0)
  );
  -- A retry with the same key returns the payment posted the first time.
  SELECT payment.id, payment.number, payment.amount_cents, payment.applied_cents, payment.journal_entry_id
  INTO v_existing
  FROM public.customer_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'number', v_existing.number,
      'amountCents', v_existing.amount_cents, 'appliedCents', v_existing.applied_cents,
      'creditCents', v_existing.amount_cents - v_existing.applied_cents,
      'creditNoteId', (SELECT credit.id FROM public.credit_notes AS credit
                       WHERE credit.org_id = p_org_id AND credit.customer_payment_id = v_existing.id),
      'journalEntryId', v_existing.journal_entry_id);
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'The payment date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 900000000000000 THEN
    RAISE EXCEPTION 'Enter the amount received, above zero.' USING ERRCODE = '22023';
  END IF;
  IF v_reference IS NOT NULL AND length(v_reference) > 100 THEN
    RAISE EXCEPTION 'The reference is up to 100 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_memo IS NOT NULL AND length(v_memo) > 2000 THEN
    RAISE EXCEPTION 'The note is up to 2,000 characters.' USING ERRCODE = '22023';
  END IF;

  -- The customer is locked first, so two payments from them post one after the other.
  SELECT customer.display_name INTO v_customer_name
  FROM public.customers AS customer
  WHERE customer.org_id = p_org_id AND customer.id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer does not belong to this organization.' USING ERRCODE = '23503';
  END IF;

  PERFORM private.require_money_account(p_org_id, p_deposit_account_id, 'The deposit account');
  SELECT upper(org.base_currency), org.edition = 'law' INTO v_base_currency, v_law FROM public.organizations AS org WHERE org.id = p_org_id;
  SELECT upper(account.currency) INTO v_account_currency
  FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.id = p_deposit_account_id;
  IF v_account_currency IS NOT NULL AND v_account_currency <> v_base_currency THEN
    RAISE EXCEPTION 'A payment across invoices is received in %. Receive money into a % account on the invoice itself.',
      v_base_currency, v_account_currency USING ERRCODE = '22023';
  END IF;
  v_receivable := private.control_account(p_org_id, '1100');

  -- What each invoice is to receive.
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) = 'null' THEN
    v_left := p_amount_cents;
    FOR v_invoice IN
      SELECT invoice.id, invoice.amount_due_cents
      FROM public.invoices AS invoice
      WHERE invoice.org_id = p_org_id AND invoice.customer_id = p_customer_id
        AND invoice.status NOT IN ('PAID', 'VOID') AND invoice.amount_due_cents > 0
        AND upper(invoice.currency) = v_base_currency
        AND invoice.date <= p_payment_date
        AND NOT (v_law AND invoice.matter_id IS NOT NULL)
      ORDER BY invoice.due_date NULLS LAST, invoice.date, invoice.invoice_number, invoice.id
    LOOP
      EXIT WHEN v_left = 0;
      v_amount := least(v_left, v_invoice.amount_due_cents);
      v_requested := v_requested || jsonb_build_array(jsonb_build_object('invoiceId', v_invoice.id, 'amountCents', v_amount));
      v_left := v_left - v_amount;
    END LOOP;
  ELSE
    IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) > 200 THEN
      RAISE EXCEPTION 'Share a payment across up to 200 invoices.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
      BEGIN
        v_invoice_id := (v_item->>'invoiceId')::UUID;
        v_amount := (v_item->>'amountCents')::BIGINT;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'An invoice share is not a valid invoice and amount.' USING ERRCODE = '22023';
      END;
      IF v_invoice_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'Each invoice the payment covers needs an amount above zero.' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_requested) AS taken(item) WHERE (taken.item->>'invoiceId')::UUID = v_invoice_id) THEN
        RAISE EXCEPTION 'An invoice appears twice in the payment.' USING ERRCODE = '22023';
      END IF;
      v_requested := v_requested || jsonb_build_array(jsonb_build_object('invoiceId', v_invoice_id, 'amountCents', v_amount));
    END LOOP;
  END IF;

  -- Each invoice is locked and checked, in a fixed order.
  FOR v_item IN
    SELECT requested.item FROM jsonb_array_elements(v_requested) AS requested(item)
    ORDER BY (requested.item->>'invoiceId')
  LOOP
    v_invoice_id := (v_item->>'invoiceId')::UUID;
    v_amount := (v_item->>'amountCents')::BIGINT;
    SELECT invoice.id, invoice.invoice_number, invoice.customer_id, invoice.status, invoice.date,
           invoice.total_cents, invoice.amount_due_cents, upper(invoice.currency) AS currency, invoice.matter_id
    INTO v_invoice
    FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = v_invoice_id
    FOR UPDATE;
    IF NOT FOUND OR v_invoice.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'Each invoice the payment covers must be one of this customer''s.' USING ERRCODE = '23503';
    END IF;
    IF v_law AND v_invoice.matter_id IS NOT NULL THEN
      RAISE EXCEPTION 'Fee note % is settled from its matter, where withholding and client money are recorded.', v_invoice.invoice_number
        USING ERRCODE = '23514';
    END IF;
    IF v_invoice.status IN ('PAID', 'VOID') OR v_invoice.amount_due_cents <= 0 THEN
      RAISE EXCEPTION 'Invoice % has nothing due.', v_invoice.invoice_number USING ERRCODE = '23514';
    END IF;
    IF v_invoice.currency IS DISTINCT FROM v_base_currency THEN
      RAISE EXCEPTION 'Invoice % is in %; receive its payment on the invoice itself.', v_invoice.invoice_number, v_invoice.currency
        USING ERRCODE = '22023';
    END IF;
    IF v_amount > v_invoice.amount_due_cents THEN
      RAISE EXCEPTION 'Invoice % has % cents due; put no more than that against it.', v_invoice.invoice_number, v_invoice.amount_due_cents
        USING ERRCODE = '23514';
    END IF;
    IF p_payment_date < v_invoice.date THEN
      RAISE EXCEPTION 'The payment is dated before invoice %.', v_invoice.invoice_number USING ERRCODE = '22023';
    END IF;
    v_applied := v_applied + v_amount;
    v_shares := v_shares || jsonb_build_array(jsonb_build_object(
      'invoiceId', v_invoice.id, 'number', v_invoice.invoice_number, 'amountCents', v_amount,
      'dueCents', v_invoice.amount_due_cents, 'totalCents', v_invoice.total_cents));
  END LOOP;
  IF v_applied > p_amount_cents THEN
    RAISE EXCEPTION 'The invoices are given % cents, more than the % cents received.', v_applied, p_amount_cents
      USING ERRCODE = '23514';
  END IF;
  v_credit := p_amount_cents - v_applied;

  v_number := 'PMT-' || to_char(p_payment_date, 'YYYY') || '-'
    || lpad(private.next_document_number(p_org_id, 'CUSTOMER_PAYMENT')::TEXT, 5, '0');

  v_journal := jsonb_build_array(jsonb_build_object(
    'accountId', p_deposit_account_id, 'debit', p_amount_cents, 'credit', 0,
    'description', 'Payment from ' || v_customer_name || COALESCE(', ref. ' || v_reference, ''),
    'entityType', 'CUSTOMER', 'entityId', p_customer_id));
  FOR v_share IN SELECT value FROM jsonb_array_elements(v_shares)
  LOOP
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_receivable, 'debit', 0, 'credit', (v_share->>'amountCents')::BIGINT,
      'description', 'Payment for ' || (v_share->>'number'), 'entityType', 'CUSTOMER', 'entityId', p_customer_id));
  END LOOP;
  IF v_credit > 0 THEN
    v_journal := v_journal || jsonb_build_array(jsonb_build_object(
      'accountId', v_receivable, 'debit', 0, 'credit', v_credit,
      'description', 'Kept as credit for ' || v_customer_name, 'entityType', 'CUSTOMER', 'entityId', p_customer_id));
  END IF;
  v_entry_id := private.insert_journal_entry(
    p_org_id, p_payment_date, 'Payment ' || v_number || ' from ' || v_customer_name,
    'CUSTOMER_PAYMENT', v_id, v_number, p_actor, v_journal, 'customer-payment:' || p_idempotency_key);

  INSERT INTO public.customer_payments (
    id, org_id, number, customer_id, payment_date, deposit_account_id, amount_cents, applied_cents,
    reference, memo, journal_entry_id, created_by, idempotency_key
  ) VALUES (
    v_id, p_org_id, v_number, p_customer_id, p_payment_date, p_deposit_account_id, p_amount_cents, v_applied,
    v_reference, v_memo, v_entry_id, p_actor, p_idempotency_key
  );

  FOR v_share IN SELECT value FROM jsonb_array_elements(v_shares)
  LOOP
    v_amount := (v_share->>'amountCents')::BIGINT;
    INSERT INTO public.invoice_payments (
      org_id, invoice_id, amount_cents, currency, foreign_amount_cents, exchange_rate, payment_date,
      account_id, journal_entry_id, idempotency_key, created_by, customer_payment_id
    ) VALUES (
      p_org_id, (v_share->>'invoiceId')::UUID, v_amount, v_base_currency, v_amount, 1, p_payment_date,
      p_deposit_account_id, v_entry_id, 'customer-payment:' || p_idempotency_key || ':' || (v_share->>'invoiceId'),
      p_actor, v_id
    );
    v_new_due := (v_share->>'dueCents')::BIGINT - v_amount;
    UPDATE public.invoices
    SET amount_due_cents = v_new_due, status = CASE WHEN v_new_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END
    WHERE org_id = p_org_id AND id = (v_share->>'invoiceId')::UUID;
    v_paid := v_paid || jsonb_build_array(jsonb_build_object(
      'invoiceId', v_share->>'invoiceId', 'invoiceNumber', v_share->>'number', 'amountCents', v_amount,
      'amountDueCents', v_new_due, 'status', CASE WHEN v_new_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END));
  END LOOP;

  UPDATE public.customers
  SET balance = greatest(COALESCE(balance, 0) - v_applied, 0)
  WHERE org_id = p_org_id AND id = p_customer_id;

  -- What is left over stays with the customer as a credit.
  IF v_credit > 0 THEN
    v_credit_id := gen_random_uuid();
    INSERT INTO public.credit_notes (
      id, org_id, kind, number, credit_date, customer_id, reference, memo, currency,
      subtotal_cents, tax_cents, total_cents, remaining_cents, journal_entry_id, created_by, idempotency_key,
      customer_payment_id
    ) VALUES (
      v_credit_id, p_org_id, 'CUSTOMER', v_number, p_payment_date, p_customer_id, v_reference,
      'Left over from payment ' || v_number, v_base_currency,
      v_credit, 0, v_credit, v_credit, v_entry_id, p_actor, 'customer-payment:' || p_idempotency_key,
      v_id
    );
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'CUSTOMER_PAYMENT', v_id,
    jsonb_build_object('number', v_number, 'customerId', p_customer_id, 'amountCents', p_amount_cents,
      'appliedCents', v_applied, 'creditCents', v_credit, 'invoices', v_paid));

  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'amountCents', p_amount_cents,
    'appliedCents', v_applied, 'creditCents', v_credit, 'creditNoteId', v_credit_id,
    'journalEntryId', v_entry_id, 'invoices', v_paid);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Reverse a payment whole: a dated entry undoes it, its invoices are owed
-- again, and its credit, if any, is withdrawn. A credit that has since been
-- applied or refunded is undone first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_customer_payment(
  p_org_id UUID,
  p_payment_id UUID,
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
  v_payment RECORD;
  v_credit RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
  v_share RECORD;
  v_new_due BIGINT;
  v_reopened JSONB := '[]'::JSONB;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT payment.* INTO v_payment
  FROM public.customer_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found in this organization.' USING ERRCODE = '23503';
  END IF;
  -- Asking twice returns the first reversal.
  IF v_payment.status = 'REVERSED' THEN
    RETURN jsonb_build_object('number', v_payment.number, 'reversalJournalEntryId', v_payment.reversal_journal_entry_id);
  END IF;
  v_reason := private.require_reason(p_reason, 'this payment');
  IF p_reversal_date IS NULL OR p_reversal_date < v_payment.payment_date THEN
    RAISE EXCEPTION 'A reversal is dated on or after the payment it reverses.' USING ERRCODE = '22023';
  END IF;

  SELECT credit.id, credit.number, credit.status INTO v_credit
  FROM public.credit_notes AS credit
  WHERE credit.org_id = p_org_id AND credit.customer_payment_id = p_payment_id
  FOR UPDATE;
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.credit_applications AS application
    WHERE application.org_id = p_org_id AND application.credit_note_id = v_credit.id
      AND application.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The credit left over from % has been applied or refunded. Undo those first.', v_payment.number
      USING ERRCODE = '23514';
  END IF;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_reversal_date, 'Reverse payment ' || v_payment.number || ': ' || v_reason,
    'ADJUSTMENT', p_payment_id, 'REV-' || v_payment.number, p_actor,
    private.reversal_lines(p_org_id, v_payment.journal_entry_id, v_payment.number),
    'customer-payment-reversal:' || p_payment_id::TEXT);

  FOR v_share IN
    SELECT payment.id, payment.invoice_id, payment.amount_cents
    FROM public.invoice_payments AS payment
    WHERE payment.org_id = p_org_id AND payment.customer_payment_id = p_payment_id
      AND payment.reversed_at IS NULL
    ORDER BY payment.invoice_id
  LOOP
    UPDATE public.invoice_payments
    SET reversed_at = now(), reversed_by = p_actor,
        reversal_journal_entry_id = v_reversal_id, reversal_reason = v_reason
    WHERE org_id = p_org_id AND id = v_share.id;
    UPDATE public.invoices AS invoice
    SET amount_due_cents = invoice.amount_due_cents + v_share.amount_cents,
        status = CASE WHEN invoice.amount_due_cents + v_share.amount_cents >= invoice.total_cents THEN 'SENT' ELSE 'PARTIALLY_PAID' END
    WHERE invoice.org_id = p_org_id AND invoice.id = v_share.invoice_id
    RETURNING invoice.amount_due_cents INTO v_new_due;
    v_reopened := v_reopened || jsonb_build_array(jsonb_build_object('invoiceId', v_share.invoice_id, 'amountDueCents', v_new_due));
  END LOOP;

  UPDATE public.customers
  SET balance = COALESCE(balance, 0) + v_payment.applied_cents
  WHERE org_id = p_org_id AND id = v_payment.customer_id;

  IF v_credit.id IS NOT NULL AND v_credit.status <> 'VOID' THEN
    UPDATE public.credit_notes
    SET status = 'VOID', remaining_cents = 0, void_journal_entry_id = v_reversal_id,
        voided_at = now(), voided_by = p_actor, void_reason = v_reason
    WHERE org_id = p_org_id AND id = v_credit.id;
  END IF;

  UPDATE public.customer_payments
  SET status = 'REVERSED', reversed_at = now(), reversed_by = p_actor,
      reversal_journal_entry_id = v_reversal_id, reversal_reason = v_reason
  WHERE org_id = p_org_id AND id = p_payment_id;

  -- A statement line matched to this payment can be matched again.
  UPDATE public.bank_transactions
  SET status = 'UNREVIEWED', matched_journal_entry_id = NULL
  WHERE org_id = p_org_id AND matched_journal_entry_id = v_payment.journal_entry_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'REVERSE', 'CUSTOMER_PAYMENT', p_payment_id,
    jsonb_build_object('number', v_payment.number, 'amountCents', v_payment.amount_cents, 'reason', v_reason,
      'reversalJournalEntryId', v_reversal_id, 'invoices', v_reopened));

  RETURN jsonb_build_object('number', v_payment.number, 'reversalJournalEntryId', v_reversal_id, 'invoices', v_reopened);
END;
$function$;


-- ---------------------------------------------------------------------------
-- 3. Customer payments are numbered PMT-YYYY-NNNNN. Otherwise as in
-- 20261008180657_add_organization_editions.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.next_document_number(p_org_id UUID, p_document_type TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_number INTEGER;
BEGIN
  IF p_document_type NOT IN (
    'INVOICE', 'BILL', 'SALES_ORDER', 'ESTIMATE', 'CREDIT_NOTE', 'SALES_RECEIPT',
    'EXPENSE', 'TRANSFER', 'PURCHASE_ORDER', 'SUPPLIER_CREDIT', 'REFUND', 'DEPOSIT',
    'MATTER', 'COLLECTION', 'REQUISITION', 'CUSTOMER_PAYMENT'
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


-- ---------------------------------------------------------------------------
-- 4. An invoice's share of a customer payment is reversed with the whole
-- payment. Otherwise as in 20261008213111_protect_law_money_corrections.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  p_org_id UUID,
  p_payment_id UUID,
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
  v_payment RECORD;
  v_invoice RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
  v_new_due BIGINT;
  v_status TEXT;
BEGIN
  -- A share of a payment across several invoices goes back with the whole payment.
  IF EXISTS (SELECT 1 FROM public.invoice_payments AS payment
    WHERE payment.org_id = p_org_id AND payment.id = p_payment_id AND payment.customer_payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This came with payment %, which covers more than this invoice. Reverse that payment instead.',
      (SELECT customer_payment.number FROM public.invoice_payments AS payment
       JOIN public.customer_payments AS customer_payment
         ON customer_payment.org_id = payment.org_id AND customer_payment.id = payment.customer_payment_id
       WHERE payment.org_id = p_org_id AND payment.id = p_payment_id)
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_payments AS payment
    JOIN public.invoices AS invoice ON invoice.org_id=payment.org_id
      AND invoice.id=payment.invoice_id
    JOIN public.organizations AS org ON org.id=invoice.org_id
    WHERE payment.org_id=p_org_id AND payment.id=p_payment_id
      AND invoice.matter_id IS NOT NULL AND org.edition='law') THEN
    RETURN public.reverse_law_invoice_payment(p_org_id,p_payment_id,
      p_reversal_date,p_reason,p_actor);
  END IF;
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_reason := private.require_reason(p_reason, 'this payment');
  IF p_reversal_date IS NULL THEN
    RAISE EXCEPTION 'A reversal date is required.' USING ERRCODE = '22023';
  END IF;

  SELECT payment.id, payment.invoice_id, payment.amount_cents, payment.payment_date,
         payment.journal_entry_id, payment.reversed_at, payment.reversal_journal_entry_id
  INTO v_payment
  FROM public.invoice_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found in this organization.' USING ERRCODE = '23503';
  END IF;

  SELECT invoice.id, invoice.invoice_number, invoice.customer_id, invoice.status,
         invoice.total_cents, invoice.amount_due_cents
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = v_payment.invoice_id
  FOR UPDATE;

  -- Asking twice returns the first reversal.
  IF v_payment.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object('reversalJournalEntryId', v_payment.reversal_journal_entry_id,
      'amountDueCents', v_invoice.amount_due_cents, 'status', v_invoice.status);
  END IF;
  IF p_reversal_date < v_payment.payment_date THEN
    RAISE EXCEPTION 'A reversal cannot be dated before the payment it reverses.' USING ERRCODE = '22023';
  END IF;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_reversal_date, 'Reverse payment for ' || v_invoice.invoice_number,
    'ADJUSTMENT', v_invoice.id, 'REV-' || v_invoice.invoice_number, p_actor,
    private.reversal_lines(p_org_id, v_payment.journal_entry_id, v_invoice.invoice_number),
    'invoice-payment-reversal:' || p_payment_id::TEXT
  );

  UPDATE public.invoice_payments
  SET reversed_at = now(), reversed_by = p_actor,
      reversal_journal_entry_id = v_reversal_id, reversal_reason = v_reason
  WHERE org_id = p_org_id AND id = p_payment_id;

  v_new_due := v_invoice.amount_due_cents + v_payment.amount_cents;
  v_status := CASE WHEN v_new_due >= v_invoice.total_cents THEN 'SENT' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.invoices
  SET amount_due_cents = v_new_due, status = v_status
  WHERE org_id = p_org_id AND id = v_invoice.id;
  UPDATE public.customers
  SET balance = COALESCE(balance, 0) + v_payment.amount_cents
  WHERE org_id = p_org_id AND id = v_invoice.customer_id;

  -- A statement line matched to this payment can be matched again.
  UPDATE public.bank_transactions
  SET status = 'UNREVIEWED', matched_journal_entry_id = NULL
  WHERE org_id = p_org_id AND matched_journal_entry_id = v_payment.journal_entry_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_actor, 'REVERSE', 'INVOICE', v_invoice.id,
    jsonb_build_object('paymentId', p_payment_id, 'amountCents', v_payment.amount_cents,
      'reason', v_reason, 'reversalJournalEntryId', v_reversal_id,
      'amountDueCents', v_new_due, 'status', v_status)
  );

  RETURN jsonb_build_object('reversalJournalEntryId', v_reversal_id,
    'amountDueCents', v_new_due, 'status', v_status);
END;
$function$;


-- ---------------------------------------------------------------------------
-- 5. A credit left over from a payment goes with the payment. Otherwise as
-- in 20261005000400_credit_notes.sql.
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
  IF v_credit.customer_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Credit % is what was left over from a payment. Apply it, refund it, or reverse the payment.', v_credit.number
      USING ERRCODE = '23514';
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
-- 6. Sales by customer leaves out credit kept from a payment: it is money
-- received, not a sale taken back. Otherwise as in 20261005000800.
-- ---------------------------------------------------------------------------
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
      AND credit.customer_payment_id IS NULL
  ) AS sales
  LEFT JOIN public.customers AS customer ON customer.org_id = p_org_id AND customer.id = sales.customer_id
  GROUP BY sales.customer_id, customer.display_name
  ORDER BY sum(sales.invoiced + sales.cash - sales.credited) DESC, 2;
$function$;


REVOKE ALL ON FUNCTION public.receive_customer_payment(UUID, UUID, DATE, UUID, BIGINT, JSONB, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_customer_payment(UUID, UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_customer_payment(UUID, UUID, DATE, UUID, BIGINT, JSONB, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_customer_payment(UUID, UUID, DATE, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION private.next_document_number(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reverse_invoice_payment(UUID, UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(UUID, UUID, DATE, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.void_credit_note(UUID, UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_credit_note(UUID, UUID, DATE, TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.sales_by_customer(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_customer(UUID, DATE, DATE) TO service_role;

-- Rollback: drop receive_customer_payment and reverse_customer_payment;
-- re-run next_document_number from 20261008180657, reverse_invoice_payment
-- from 20261008213111, void_credit_note from 20261005000400 and
-- sales_by_customer from 20261005000800; drop credit_notes.customer_payment_id
-- and invoice_payments.customer_payment_id with their constraints and
-- indexes; drop public.customer_payments.
