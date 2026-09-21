-- Atomic financial workflows
--
-- The Worker authenticates the caller and selects an organization, but it uses
-- the Supabase service role for server-side data access.  Every function below
-- therefore re-checks the supplied actor against public.memberships before it
-- performs a privileged write.  A forged actor or cross-tenant UUID is rejected
-- even when the caller reaches PostgREST with a service-role key.

CREATE OR REPLACE FUNCTION private.require_financial_actor(
  p_org_id UUID,
  p_actor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_authenticated_user UUID := auth.uid();
  v_role public.membership_role;
BEGIN
  IF p_org_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Organization and actor are required.' USING ERRCODE = '22023';
  END IF;

  IF v_authenticated_user IS NOT NULL AND v_authenticated_user IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'The financial actor must match the authenticated user.' USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
  INTO v_role
  FROM public.memberships AS membership
  WHERE membership.org_id = p_org_id
    AND membership.user_id = p_actor_id;

  IF NOT FOUND OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'An organization owner or administrator is required.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.require_financial_actor(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

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
  IF p_document_type NOT IN ('INVOICE', 'BILL') THEN
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

CREATE OR REPLACE FUNCTION private.insert_journal_entry(
  p_org_id UUID,
  p_entry_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_reference_no TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry_id UUID;
  v_line JSONB;
  v_line_number INTEGER := 0;
  v_account_id UUID;
  v_account_currency TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_foreign_debit BIGINT;
  v_foreign_credit BIGINT;
  v_exchange_rate NUMERIC;
  v_currency TEXT;
  v_entity_type TEXT;
  v_entity_id UUID;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
BEGIN
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'Entry date is required.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry requires at least two lines.' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key cannot be blank.' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT entry.id INTO v_entry_id
    FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id
      AND entry.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    BEGIN
      v_account_id := (v_line->>'accountId')::UUID;
      v_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
      v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);
      v_foreign_debit := NULLIF(v_line->>'foreignDebit', '')::BIGINT;
      v_foreign_credit := NULLIF(v_line->>'foreignCredit', '')::BIGINT;
      v_exchange_rate := NULLIF(v_line->>'exchangeRate', '')::NUMERIC;
      v_currency := NULLIF(upper(btrim(v_line->>'currency')), '');
      v_entity_type := NULLIF(upper(btrim(v_line->>'entityType')), '');
      v_entity_id := NULLIF(v_line->>'entityId', '')::UUID;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Journal line % contains an invalid UUID or numeric value.', v_line_number
        USING ERRCODE = '22023';
    END;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Journal line % has no account.', v_line_number USING ERRCODE = '22023';
    END IF;
    IF v_debit < 0 OR v_credit < 0 OR v_debit <> trunc(v_debit) OR v_credit <> trunc(v_credit) THEN
      RAISE EXCEPTION 'Journal line % amounts must be non-negative integer cents.', v_line_number
        USING ERRCODE = '22023';
    END IF;
    IF (v_debit > 0 AND v_credit > 0) OR (v_debit = 0 AND v_credit = 0) THEN
      RAISE EXCEPTION 'Journal line % must contain exactly one non-zero side.', v_line_number
        USING ERRCODE = '22023';
    END IF;

    SELECT account.currency INTO v_account_currency
    FROM public.accounts AS account
    WHERE account.org_id = p_org_id
      AND account.id = v_account_id
      AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Journal line % uses an inactive or cross-organization account.', v_line_number
        USING ERRCODE = '23503';
    END IF;

    IF v_currency IS NULL THEN
      IF v_foreign_debit IS NOT NULL OR v_foreign_credit IS NOT NULL OR v_exchange_rate IS NOT NULL THEN
        RAISE EXCEPTION 'Journal line % has foreign amounts without currency metadata.', v_line_number
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF v_currency !~ '^[A-Z]{3}$' OR v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
        RAISE EXCEPTION 'Journal line % has invalid currency metadata.', v_line_number USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_foreign_debit, 0) < 0 OR COALESCE(v_foreign_credit, 0) < 0
         OR (COALESCE(v_foreign_debit, 0) > 0 AND COALESCE(v_foreign_credit, 0) > 0) THEN
        RAISE EXCEPTION 'Journal line % has invalid foreign debit/credit values.', v_line_number
          USING ERRCODE = '22023';
      END IF;
      IF (v_debit > 0 AND COALESCE(v_foreign_credit, 0) > 0)
         OR (v_credit > 0 AND COALESCE(v_foreign_debit, 0) > 0) THEN
        RAISE EXCEPTION 'Journal line % foreign amount is on the wrong side.', v_line_number
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_entity_id IS NOT NULL THEN
      CASE v_entity_type
        WHEN 'CUSTOMER' THEN
          PERFORM 1 FROM public.customers WHERE org_id = p_org_id AND id = v_entity_id;
        WHEN 'VENDOR' THEN
          PERFORM 1 FROM public.vendors WHERE org_id = p_org_id AND id = v_entity_id;
        WHEN 'EMPLOYEE' THEN
          PERFORM 1 FROM public.employees WHERE org_id = p_org_id AND id = v_entity_id;
        WHEN 'PROJECT' THEN
          PERFORM 1 FROM public.projects WHERE org_id = p_org_id AND id = v_entity_id;
        ELSE
          RAISE EXCEPTION 'Journal line % has an unsupported entity type.', v_line_number
            USING ERRCODE = '22023';
      END CASE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal line % references a cross-organization entity.', v_line_number
          USING ERRCODE = '23503';
      END IF;
    ELSIF v_entity_type IS NOT NULL THEN
      RAISE EXCEPTION 'Journal line % has an entity type without an entity.', v_line_number
        USING ERRCODE = '22023';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Journal entry is unbalanced: debits %, credits %.', v_total_debit, v_total_credit
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.journal_entries (
    org_id, entry_date, memo, source_type, source_id, reference_no,
    created_by, idempotency_key
  ) VALUES (
    p_org_id, p_entry_date, NULLIF(btrim(p_memo), ''), upper(btrim(p_source_type)),
    p_source_id, NULLIF(btrim(p_reference_no), ''), p_created_by,
    NULLIF(btrim(p_idempotency_key), '')
  ) RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.journal_lines (
      org_id, journal_entry_id, account_id, debit, credit, description,
      entity_type, entity_id, currency, foreign_debit, foreign_credit, exchange_rate
    ) VALUES (
      p_org_id,
      v_entry_id,
      (v_line->>'accountId')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      NULLIF(btrim(v_line->>'description'), ''),
      NULLIF(upper(btrim(v_line->>'entityType')), ''),
      NULLIF(v_line->>'entityId', '')::UUID,
      NULLIF(upper(btrim(v_line->>'currency')), ''),
      NULLIF(v_line->>'foreignDebit', '')::BIGINT,
      NULLIF(v_line->>'foreignCredit', '')::BIGINT,
      NULLIF(v_line->>'exchangeRate', '')::NUMERIC
    );
  END LOOP;

  RETURN v_entry_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.insert_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

-- Replace the old RPC signature so PostgREST cannot choose a weaker overload.
DROP FUNCTION IF EXISTS public.post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB);

CREATE FUNCTION public.post_journal_entry(
  p_org_id UUID,
  p_entry_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_reference_no TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  CASE upper(btrim(p_source_type))
    WHEN 'BANK' THEN
      PERFORM 1 FROM public.bank_transactions AS transaction
      WHERE transaction.org_id = p_org_id AND transaction.id = p_source_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank journal source does not belong to this organization.' USING ERRCODE = '23503';
      END IF;
    WHEN 'MANUAL', 'ADJUSTMENT' THEN
      IF p_source_id IS NOT NULL THEN
        RAISE EXCEPTION 'Manual journal entries cannot attach a polymorphic source ID.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'This source type is reserved for an atomic workflow.' USING ERRCODE = '42501';
  END CASE;
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_org_id::TEXT || ':journal:' || p_idempotency_key, 0)
    );
    SELECT entry.id INTO v_entry_id
    FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id AND entry.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  v_entry_id := private.insert_journal_entry(
    p_org_id, p_entry_date, p_memo, p_source_type, p_source_id,
    p_reference_no, p_created_by, p_lines, p_idempotency_key
  );

  INSERT INTO public.audit_logs (
    org_id, user_id, action, resource_type, resource_id, details
  ) VALUES (
    p_org_id, p_created_by, 'CREATE', 'JOURNAL_ENTRY', v_entry_id,
    jsonb_build_object('sourceType', p_source_type, 'memo', p_memo)
  );

  RETURN v_entry_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT
) TO authenticated, service_role;

-- The standalone counter RPC is no longer part of the public API; document
-- numbers are allocated inside the same transaction as the document itself.
REVOKE EXECUTE ON FUNCTION public.increment_and_get(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

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
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invoice line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;

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
      foreign_amount_cents, foreign_tax_cents, line_position
    ) VALUES (
      p_org_id, v_invoice_id, btrim(v_line->>'description'),
      (v_line->>'accountId')::UUID, v_amount, v_tax,
      v_foreign_amount, v_foreign_tax, v_position
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

REVOKE ALL ON FUNCTION public.create_invoice_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) TO service_role;

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
  p_idempotency_key TEXT
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
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Bill line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;

    IF NULLIF(btrim(v_line->>'description'), '') IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_tax < 0 THEN
      RAISE EXCEPTION 'Bill line % requires a description and positive integer-cent amount.', v_position
        USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.type IN ('ASSET', 'COGS', 'EXPENSE') AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill line % must use an active asset, COGS, or expense account in this organization.', v_position
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
    currency, exchange_rate, foreign_amount_cents, notes, created_by, idempotency_key
  ) VALUES (
    v_bill_id, p_org_id, v_bill_number, p_vendor_id, p_bill_date, p_due_date,
    v_subtotal, v_tax_total, v_total, v_total, 'OPEN',
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

    INSERT INTO public.bill_lines (
      org_id, bill_id, description, account_id, amount_cents, tax_cents,
      foreign_amount_cents, foreign_tax_cents, line_position
    ) VALUES (
      p_org_id, v_bill_id, btrim(v_line->>'description'),
      (v_line->>'accountId')::UUID, v_amount, v_tax,
      v_foreign_amount, v_foreign_tax, v_position
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

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'CREATE', 'BILL', v_bill_id,
    jsonb_build_object('billNumber', v_bill_number, 'totalCents', v_total,
      'currency', v_currency, 'foreignAmountCents', v_foreign_total)
  );

  RETURN v_bill_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_bill_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) TO service_role;

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
    AND account.type = 'ASSET' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit account must be an active asset account in this organization.' USING ERRCODE = '23503';
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

  SELECT COALESCE(sum(payment.foreign_amount_cents), 0)::BIGINT INTO v_foreign_paid
  FROM public.invoice_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.invoice_id = p_invoice_id;

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

REVOKE ALL ON FUNCTION public.receive_invoice_payment(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_invoice_payment(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) TO service_role;

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
         bill.exchange_rate, bill.foreign_amount_cents
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

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  SELECT account.currency INTO v_cash_currency
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_source_account_id
    AND account.type = 'ASSET' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account must be an active asset account in this organization.' USING ERRCODE = '23503';
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

  SELECT COALESCE(sum(payment.foreign_amount_cents), 0)::BIGINT INTO v_foreign_paid
  FROM public.bill_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.bill_id = p_bill_id;
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

REVOKE ALL ON FUNCTION public.pay_bill(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_bill(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) TO service_role;

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
  ) THEN
    RAISE EXCEPTION 'A paid or partially paid invoice cannot be voided; reverse its payments first.'
      USING ERRCODE = '23514';
  END IF;

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
    jsonb_build_object('reversalJournalEntryId', v_reversal_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.void_invoice_with_reversal(UUID, UUID, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice_with_reversal(UUID, UUID, DATE, UUID)
  TO service_role;

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

REVOKE ALL ON FUNCTION public.void_bill_with_reversal(UUID, UUID, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_bill_with_reversal(UUID, UUID, DATE, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.run_payroll_with_journal(
  p_org_id UUID,
  p_period TEXT,
  p_pay_date DATE,
  p_rate_version TEXT,
  p_created_by UUID,
  p_idempotency_key TEXT,
  p_salary_expense_account_id UUID,
  p_employer_expense_account_id UUID,
  p_cash_account_id UUID,
  p_paye_payable_account_id UUID,
  p_nssf_payable_account_id UUID,
  p_shif_payable_account_id UUID,
  p_ahl_payable_account_id UUID,
  p_payslips JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run_id UUID;
  v_journal_id UUID;
  v_base_currency TEXT;
  v_item JSONB;
  v_employee_id UUID;
  v_seen_employees UUID[] := ARRAY[]::UUID[];
  v_gross BIGINT;
  v_taxable BIGINT;
  v_paye BIGINT;
  v_nssf BIGINT;
  v_shif BIGINT;
  v_ahl BIGINT;
  v_employer_nssf BIGINT;
  v_employer_ahl BIGINT;
  v_net BIGINT;
  v_total_gross BIGINT := 0;
  v_total_taxable BIGINT := 0;
  v_total_paye BIGINT := 0;
  v_total_nssf BIGINT := 0;
  v_total_shif BIGINT := 0;
  v_total_ahl BIGINT := 0;
  v_total_employer_nssf BIGINT := 0;
  v_total_employer_ahl BIGINT := 0;
  v_total_net BIGINT := 0;
  v_journal_lines JSONB := '[]'::JSONB;
  v_line_number INTEGER := 0;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_period IS NULL OR btrim(p_period) = '' OR length(btrim(p_period)) > 100
     OR p_pay_date IS NULL OR p_rate_version IS NULL OR btrim(p_rate_version) = '' THEN
    RAISE EXCEPTION 'Payroll period, pay date, and rate version are required.' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':payroll:' || p_idempotency_key, 0)
  );

  SELECT run.id INTO v_run_id
  FROM public.payroll_runs AS run
  WHERE run.org_id = p_org_id AND run.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_run_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs AS run
    WHERE run.org_id = p_org_id AND run.period = btrim(p_period)
  ) THEN
    RAISE EXCEPTION 'Payroll has already been run for this period.' USING ERRCODE = '23505';
  END IF;

  SELECT upper(org.base_currency) INTO v_base_currency
  FROM public.organizations AS org WHERE org.id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_salary_expense_account_id AND code = '6100' AND type = 'EXPENSE' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_employer_expense_account_id AND code = '6110' AND type = 'EXPENSE' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_cash_account_id AND code = '1000' AND type = 'ASSET' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_paye_payable_account_id AND code = '2110' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_nssf_payable_account_id AND code = '2120' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_shif_payable_account_id AND code = '2130' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = p_org_id AND id = p_ahl_payable_account_id AND code = '2140' AND type = 'LIABILITY' AND currency = v_base_currency AND is_active) THEN
    RAISE EXCEPTION 'Payroll accounts are inactive, incorrectly typed, or outside this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(p_payslips) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payslips) = 0 THEN
    RAISE EXCEPTION 'Payroll requires at least one payslip.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payslips)
  LOOP
    v_line_number := v_line_number + 1;
    BEGIN
      v_employee_id := (v_item->>'employeeId')::UUID;
      v_gross := (v_item->>'grossCents')::BIGINT;
      v_taxable := (v_item->>'taxablePayCents')::BIGINT;
      v_paye := (v_item->>'payeCents')::BIGINT;
      v_nssf := (v_item->>'nssfCents')::BIGINT;
      v_shif := (v_item->>'shifCents')::BIGINT;
      v_ahl := (v_item->>'ahlCents')::BIGINT;
      v_employer_nssf := (v_item->>'employerNssfCents')::BIGINT;
      v_employer_ahl := (v_item->>'employerAhlCents')::BIGINT;
      v_net := (v_item->>'netCents')::BIGINT;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Payslip % contains an invalid value.', v_line_number USING ERRCODE = '22023';
    END;

    IF v_employee_id IS NULL OR v_gross IS NULL OR v_taxable IS NULL OR v_paye IS NULL
       OR v_nssf IS NULL OR v_shif IS NULL OR v_ahl IS NULL OR v_employer_nssf IS NULL
       OR v_employer_ahl IS NULL OR v_net IS NULL
       OR v_gross < 0 OR v_taxable < 0 OR v_taxable > v_gross OR v_paye < 0 OR v_nssf < 0
       OR v_shif < 0 OR v_ahl < 0 OR v_employer_nssf < 0 OR v_employer_ahl < 0 OR v_net < 0
       OR v_net <> v_gross - v_paye - v_nssf - v_shif - v_ahl
       OR NULLIF(v_item->>'rateVersion', '') IS DISTINCT FROM p_rate_version THEN
      RAISE EXCEPTION 'Payslip % totals or statutory rate version are inconsistent.', v_line_number
        USING ERRCODE = '23514';
    END IF;
    IF v_employee_id = ANY(v_seen_employees) THEN
      RAISE EXCEPTION 'An employee appears more than once in this payroll run.' USING ERRCODE = '23505';
    END IF;
    v_seen_employees := array_append(v_seen_employees, v_employee_id);

    PERFORM 1 FROM public.employees AS employee
    WHERE employee.org_id = p_org_id AND employee.id = v_employee_id
      AND employee.status = 'Active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payslip % references an inactive or cross-organization employee.', v_line_number
        USING ERRCODE = '23503';
    END IF;

    v_total_gross := v_total_gross + v_gross;
    v_total_taxable := v_total_taxable + v_taxable;
    v_total_paye := v_total_paye + v_paye;
    v_total_nssf := v_total_nssf + v_nssf;
    v_total_shif := v_total_shif + v_shif;
    v_total_ahl := v_total_ahl + v_ahl;
    v_total_employer_nssf := v_total_employer_nssf + v_employer_nssf;
    v_total_employer_ahl := v_total_employer_ahl + v_employer_ahl;
    v_total_net := v_total_net + v_net;
  END LOOP;

  IF v_total_gross <= 0 THEN
    RAISE EXCEPTION 'Payroll gross amount must be positive.' USING ERRCODE = '23514';
  END IF;

  v_run_id := gen_random_uuid();
  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'accountId', p_salary_expense_account_id, 'debit', v_total_gross, 'credit', 0,
      'description', 'Gross salaries — ' || btrim(p_period),
      'currency', v_base_currency, 'foreignDebit', v_total_gross,
      'foreignCredit', 0, 'exchangeRate', 1
    ),
    jsonb_build_object(
      'accountId', p_employer_expense_account_id,
      'debit', v_total_employer_nssf + v_total_employer_ahl, 'credit', 0,
      'description', 'Employer statutory contributions — ' || btrim(p_period),
      'currency', v_base_currency,
      'foreignDebit', v_total_employer_nssf + v_total_employer_ahl,
      'foreignCredit', 0, 'exchangeRate', 1
    ),
    jsonb_build_object(
      'accountId', p_cash_account_id, 'debit', 0, 'credit', v_total_net,
      'description', 'Net payroll — ' || btrim(p_period),
      'currency', v_base_currency, 'foreignDebit', 0,
      'foreignCredit', v_total_net, 'exchangeRate', 1
    )
  );
  IF v_total_paye > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_paye_payable_account_id, 'debit', 0, 'credit', v_total_paye,
      'description', 'PAYE payable — ' || btrim(p_period), 'currency', v_base_currency,
      'foreignDebit', 0, 'foreignCredit', v_total_paye, 'exchangeRate', 1
    ));
  END IF;
  IF v_total_nssf + v_total_employer_nssf > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_nssf_payable_account_id, 'debit', 0,
      'credit', v_total_nssf + v_total_employer_nssf,
      'description', 'NSSF payable — ' || btrim(p_period), 'currency', v_base_currency,
      'foreignDebit', 0, 'foreignCredit', v_total_nssf + v_total_employer_nssf, 'exchangeRate', 1
    ));
  END IF;
  IF v_total_shif > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_shif_payable_account_id, 'debit', 0, 'credit', v_total_shif,
      'description', 'SHIF payable — ' || btrim(p_period), 'currency', v_base_currency,
      'foreignDebit', 0, 'foreignCredit', v_total_shif, 'exchangeRate', 1
    ));
  END IF;
  IF v_total_ahl + v_total_employer_ahl > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_array(jsonb_build_object(
      'accountId', p_ahl_payable_account_id, 'debit', 0,
      'credit', v_total_ahl + v_total_employer_ahl,
      'description', 'Affordable Housing Levy payable — ' || btrim(p_period),
      'currency', v_base_currency, 'foreignDebit', 0,
      'foreignCredit', v_total_ahl + v_total_employer_ahl, 'exchangeRate', 1
    ));
  END IF;

  v_journal_id := private.insert_journal_entry(
    p_org_id, p_pay_date, 'Payroll — ' || btrim(p_period), 'PAYROLL', v_run_id,
    btrim(p_period), p_created_by, v_journal_lines,
    'payroll-post:' || p_idempotency_key
  );

  INSERT INTO public.payroll_runs (
    id, org_id, period, pay_date, journal_entry_id,
    total_gross_cents, total_net_cents, total_paye_cents, total_nssf_cents,
    total_shif_cents, total_ahl_cents, total_employer_nssf_cents,
    total_employer_ahl_cents, rate_version, idempotency_key, created_by
  ) VALUES (
    v_run_id, p_org_id, btrim(p_period), p_pay_date, v_journal_id,
    v_total_gross, v_total_net, v_total_paye, v_total_nssf,
    v_total_shif, v_total_ahl, v_total_employer_nssf,
    v_total_employer_ahl, p_rate_version, p_idempotency_key, p_created_by
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payslips)
  LOOP
    INSERT INTO public.payslips (
      org_id, payroll_run_id, employee_id, gross_cents, taxable_pay_cents,
      paye_cents, nssf_cents, shif_cents, ahl_cents,
      employer_nssf_cents, employer_ahl_cents, rate_version, net_cents
    ) VALUES (
      p_org_id, v_run_id, (v_item->>'employeeId')::UUID,
      (v_item->>'grossCents')::BIGINT, (v_item->>'taxablePayCents')::BIGINT,
      (v_item->>'payeCents')::BIGINT, (v_item->>'nssfCents')::BIGINT,
      (v_item->>'shifCents')::BIGINT, (v_item->>'ahlCents')::BIGINT,
      (v_item->>'employerNssfCents')::BIGINT, (v_item->>'employerAhlCents')::BIGINT,
      p_rate_version, (v_item->>'netCents')::BIGINT
    );
  END LOOP;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_created_by, 'CREATE', 'PAYROLL_RUN', v_run_id,
    jsonb_build_object('period', btrim(p_period), 'rateVersion', p_rate_version,
      'employeeCount', jsonb_array_length(p_payslips), 'totalGrossCents', v_total_gross,
      'totalNetCents', v_total_net, 'totalTaxablePayCents', v_total_taxable)
  );

  RETURN v_run_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_payroll_with_journal(
  UUID, TEXT, DATE, TEXT, UUID, TEXT, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payroll_with_journal(
  UUID, TEXT, DATE, TEXT, UUID, TEXT, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB
) TO service_role;
