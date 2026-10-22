-- Live M-Pesa payments for business organizations.
--
-- A business links its paybill or till through Safaricom's Daraja C2B API,
-- as a Kundi church does: the consumer key and secret go into Vault, and a
-- callback token (stored as its SHA-256) names the organization. Each
-- confirmation is kept once per M-Pesa transaction and becomes a statement
-- line on the business's M-Pesa money account (1050 unless another is
-- chosen), keyed as an uploaded statement keys a line with its receipt
-- number, so the same payment in a later statement file is skipped.
--
-- A payment settles an invoice on its own only when the account number the
-- customer typed is exactly one open invoice's number (spaces, hyphens and
-- case ignored), the invoice is in the base currency and the payment is no
-- more than the amount due. It settles through match_bank_transaction, in
-- the name of the organization's integration actor. Anything else waits in
-- Banking for a person, with the reason kept on the payment.

-- ---------------------------------------------------------------------------
-- 1. M-Pesa links for businesses as well as churches
-- ---------------------------------------------------------------------------

ALTER TABLE public.org_integrations ADD COLUMN money_account_id UUID;
ALTER TABLE public.org_integrations ADD CONSTRAINT org_integrations_money_account_fkey
  FOREIGN KEY (org_id, money_account_id) REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT;

CREATE FUNCTION private.require_mpesa_edition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations
                 WHERE id = NEW.org_id AND edition IN ('business', 'church')) THEN
    RAISE EXCEPTION 'M-Pesa links belong to business and Kundi church organizations.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_mpesa_edition() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER org_integrations_require_church ON public.org_integrations;
CREATE TRIGGER org_integrations_require_mpesa_edition BEFORE INSERT OR UPDATE OF org_id ON public.org_integrations
  FOR EACH ROW EXECUTE FUNCTION private.require_mpesa_edition();

-- The 7-argument version was church-only. This one takes the money account
-- a business's payments land in; churches keep posting through giving.
DROP FUNCTION public.save_mpesa_integration(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID);
CREATE FUNCTION public.save_mpesa_integration(
  p_org_id UUID,
  p_shortcode TEXT,
  p_environment TEXT,
  p_consumer_key TEXT,
  p_consumer_secret TEXT,
  p_integration_actor_id UUID,
  p_created_by UUID,
  p_money_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_row RECORD;
  v_edition TEXT;
  v_base_currency TEXT;
  v_money_account UUID;
  v_secret UUID;
  v_changed BOOLEAN := false;
  v_key TEXT := NULLIF(btrim(p_consumer_key), '');
  v_value TEXT := NULLIF(btrim(p_consumer_secret), '');
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_created_by);
  SELECT edition::TEXT, upper(base_currency) INTO v_edition, v_base_currency
  FROM public.organizations WHERE id = p_org_id;
  IF v_edition IS NULL OR v_edition NOT IN ('business', 'church') THEN
    RAISE EXCEPTION 'M-Pesa links are available to business and Kundi church organizations.' USING ERRCODE = '23514';
  END IF;
  IF p_shortcode IS NULL OR btrim(p_shortcode) !~ '^[0-9]{5,10}$' THEN
    RAISE EXCEPTION 'Enter the paybill or till number Safaricom gave the organization (5 to 10 digits).' USING ERRCODE = '22023';
  END IF;
  IF p_environment IS NULL OR p_environment NOT IN ('SANDBOX', 'PRODUCTION') THEN
    RAISE EXCEPTION 'Choose the Daraja sandbox or production.' USING ERRCODE = '22023';
  END IF;
  IF (v_key IS NULL) <> (v_value IS NULL) THEN
    RAISE EXCEPTION 'Enter both the consumer key and the consumer secret, or neither to keep the saved ones.' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NOT NULL AND (length(v_key) > 200 OR length(v_value) > 200) THEN
    RAISE EXCEPTION 'The consumer key and secret are at most 200 characters each.' USING ERRCODE = '22023';
  END IF;
  IF p_integration_actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.memberships AS membership
    WHERE membership.org_id = p_org_id AND membership.user_id = p_integration_actor_id
      AND membership.role IN ('owner', 'admin', 'accountant')) THEN
    RAISE EXCEPTION 'M-Pesa payments are posted in the name of an owner, admin or accountant of this organization.' USING ERRCODE = '22023';
  END IF;

  IF v_edition = 'business' THEN
    v_money_account := p_money_account_id;
    IF v_money_account IS NULL THEN
      SELECT account.id INTO v_money_account FROM public.accounts AS account
      WHERE account.org_id = p_org_id AND account.code = '1050';
    END IF;
    IF v_money_account IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounts AS account
      WHERE account.org_id = p_org_id AND account.id = v_money_account AND account.is_active
        AND account.is_bank_account AND account.type = 'ASSET' AND upper(account.currency) = v_base_currency) THEN
      RAISE EXCEPTION 'Choose the active money account in % that M-Pesa payments land in.', v_base_currency USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT integration.id, integration.vault_secret_id, integration.shortcode, integration.environment INTO v_row
  FROM public.org_integrations AS integration
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B'
  FOR UPDATE;

  v_secret := v_row.vault_secret_id;
  IF v_key IS NOT NULL THEN
    v_changed := true;
    IF v_secret IS NULL THEN
      v_secret := vault.create_secret(
        jsonb_build_object('consumerKey', v_key, 'consumerSecret', v_value)::TEXT,
        'org:' || p_org_id::TEXT || ':mpesa_c2b', 'Daraja C2B consumer key and secret');
    ELSE
      PERFORM vault.update_secret(v_secret,
        jsonb_build_object('consumerKey', v_key, 'consumerSecret', v_value)::TEXT, NULL, NULL, NULL);
    END IF;
  END IF;

  IF v_row.id IS NULL THEN
    INSERT INTO public.org_integrations (org_id, kind, shortcode, environment, vault_secret_id, money_account_id, created_by)
    VALUES (p_org_id, 'MPESA_C2B', btrim(p_shortcode), p_environment, v_secret, v_money_account, p_created_by)
    RETURNING id INTO v_row.id;
  ELSE
    -- A new paybill or environment needs its URLs registered again.
    UPDATE public.org_integrations
    SET shortcode = btrim(p_shortcode), environment = p_environment, vault_secret_id = v_secret,
      money_account_id = v_money_account,
      status = CASE WHEN v_row.shortcode IS DISTINCT FROM btrim(p_shortcode) OR v_row.environment <> p_environment
        THEN 'DRAFT' ELSE status END,
      updated_at = now()
    WHERE id = v_row.id;
  END IF;

  UPDATE public.organizations SET integration_actor_id = p_integration_actor_id
  WHERE id = p_org_id AND integration_actor_id IS DISTINCT FROM p_integration_actor_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'UPDATE', 'MPESA_INTEGRATION', v_row.id,
    jsonb_build_object('shortcode', btrim(p_shortcode), 'environment', p_environment,
      'credentialsChanged', v_changed, 'integrationActorId', p_integration_actor_id,
      'moneyAccountId', v_money_account));

  RETURN jsonb_build_object('id', v_row.id, 'hasCredentials', v_secret IS NOT NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.save_mpesa_integration(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_mpesa_integration(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID) TO service_role;

-- Which organization a callback token belongs to, and its edition.
DROP FUNCTION public.mpesa_callback_target(TEXT);
CREATE FUNCTION public.mpesa_callback_target(p_token_hash TEXT)
RETURNS TABLE (org_id UUID, token_hash TEXT, shortcode TEXT, integration_actor_id UUID,
  edition TEXT, money_account_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT integration.org_id, integration.callback_token_hash, integration.shortcode,
    organization.integration_actor_id, organization.edition::TEXT, integration.money_account_id
  FROM public.org_integrations AS integration
  JOIN public.organizations AS organization ON organization.id = integration.org_id
  WHERE integration.callback_token_hash = p_token_hash AND integration.kind = 'MPESA_C2B'
    AND integration.status <> 'DISABLED' AND organization.edition IN ('business', 'church');
$function$;
REVOKE ALL ON FUNCTION public.mpesa_callback_target(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mpesa_callback_target(TEXT) TO service_role;

-- The same two functions, worded for any organization.
CREATE OR REPLACE FUNCTION public.record_mpesa_registration(
  p_org_id UUID,
  p_token_hash TEXT,
  p_succeeded BOOLEAN,
  p_message TEXT,
  p_created_by UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_id UUID;
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_created_by);
  SELECT integration.id INTO v_id FROM public.org_integrations AS integration
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the M-Pesa settings first.' USING ERRCODE = '23503';
  END IF;
  IF p_succeeded THEN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'The callback token hash is not valid.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.org_integrations
    SET callback_token_hash = p_token_hash, status = 'REGISTERED', registered_at = now(), last_error = NULL,
      updated_at = now()
    WHERE id = v_id;
  ELSE
    UPDATE public.org_integrations
    SET last_error = left(COALESCE(NULLIF(btrim(p_message), ''), 'Safaricom did not accept the URLs.'), 1000),
      updated_at = now()
    WHERE id = v_id;
  END IF;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, CASE WHEN p_succeeded THEN 'REGISTER' ELSE 'REGISTER_FAILED' END,
    'MPESA_INTEGRATION', v_id, jsonb_build_object('message', left(p_message, 300)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_mpesa_callback_token(p_org_id UUID, p_token_hash TEXT, p_created_by UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_id UUID;
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_created_by);
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The callback token hash is not valid.' USING ERRCODE = '22023';
  END IF;
  SELECT integration.id INTO v_id FROM public.org_integrations AS integration
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the M-Pesa settings first.' USING ERRCODE = '23503';
  END IF;
  UPDATE public.org_integrations SET callback_token_hash = p_token_hash, updated_at = now() WHERE id = v_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'ROTATE_TOKEN', 'MPESA_INTEGRATION', v_id, '{}'::JSONB);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Payments, kept once per M-Pesa transaction
-- ---------------------------------------------------------------------------

ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_org_id_id_key UNIQUE (org_id, id);

CREATE TABLE public.mpesa_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trans_id TEXT NOT NULL CHECK (trans_id ~ '^[A-Z0-9]{6,30}$'),
  trans_time TIMESTAMPTZ NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  -- The account number the customer typed; the only thing matched.
  bill_ref_number TEXT CHECK (bill_ref_number IS NULL OR length(bill_ref_number) <= 100),
  -- Kept as Safaricom sends it, which is masked or hashed; never matched.
  msisdn TEXT CHECK (msisdn IS NULL OR length(msisdn) <= 100),
  payer_name TEXT CHECK (payer_name IS NULL OR length(payer_name) <= 100),
  shortcode TEXT CHECK (shortcode IS NULL OR length(shortcode) <= 20),
  transaction_type TEXT CHECK (transaction_type IS NULL OR length(transaction_type) <= 40),
  source TEXT NOT NULL CHECK (source IN ('C2B_CALLBACK', 'STK_CALLBACK')),
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  bank_transaction_id UUID NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'WAITING' CHECK (outcome IN ('WAITING', 'SETTLED')),
  outcome_note TEXT CHECK (outcome_note IS NULL OR length(outcome_note) <= 300),
  invoice_id UUID,
  journal_entry_id UUID,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mpesa_payments_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT mpesa_payments_org_trans_key UNIQUE (org_id, trans_id),
  CONSTRAINT mpesa_payments_bank_line_fkey FOREIGN KEY (org_id, bank_transaction_id)
    REFERENCES public.bank_transactions(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_payments_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_payments_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_payments_settled_check CHECK (
    (outcome = 'SETTLED') = (invoice_id IS NOT NULL AND journal_entry_id IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX mpesa_payments_org_time ON public.mpesa_payments(org_id, trans_time DESC);
CREATE INDEX mpesa_payments_bank_line ON public.mpesa_payments(org_id, bank_transaction_id);
ALTER TABLE public.mpesa_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpesa_payments_read ON public.mpesa_payments FOR SELECT
  USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.mpesa_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mpesa_payments TO service_role;

CREATE FUNCTION private.require_business_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.org_id AND edition = 'business') THEN
    RAISE EXCEPTION 'M-Pesa payments are kept for business organizations; churches keep M-Pesa receipts in Giving.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_business_org() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mpesa_payments_require_business BEFORE INSERT OR UPDATE OF org_id ON public.mpesa_payments
  FOR EACH ROW EXECUTE FUNCTION private.require_business_org();

-- Invoices found by their number with spaces, hyphens and case ignored.
CREATE INDEX invoices_org_number_compact
  ON public.invoices (org_id, (upper(regexp_replace(invoice_number, '[^A-Za-z0-9]', '', 'g'))));

-- p_payment: {"transId", "transTime" (ISO), "amountCents", "billRefNumber",
-- "msisdn", "payerName", "shortcode", "transactionType", "raw"}. A callback
-- has no person behind it; the token the Worker checked named the
-- organization. A payment already kept is returned as it stands.
CREATE FUNCTION public.receive_mpesa_payment(p_org_id UUID, p_source TEXT, p_payment JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_integration RECORD;
  v_trans TEXT;
  v_time TIMESTAMPTZ;
  v_amount BIGINT;
  v_ref TEXT;
  v_payer TEXT;
  v_line UUID;
  v_existing RECORD;
  v_id UUID;
  v_description TEXT;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('C2B_CALLBACK', 'STK_CALLBACK') THEN
    RAISE EXCEPTION 'Payments come from the C2B or STK callback.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'business') THEN
    RAISE EXCEPTION 'M-Pesa payments are kept for business organizations.' USING ERRCODE = '23514';
  END IF;
  SELECT integration.id, integration.status, integration.money_account_id INTO v_integration
  FROM public.org_integrations AS integration
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B';
  IF NOT FOUND OR v_integration.status = 'DISABLED' THEN
    RAISE EXCEPTION 'This organization has no active M-Pesa link.' USING ERRCODE = '23503';
  END IF;
  IF v_integration.money_account_id IS NULL THEN
    RAISE EXCEPTION 'Choose the money account M-Pesa payments land in.' USING ERRCODE = '23503';
  END IF;
  PERFORM private.require_money_account(p_org_id, v_integration.money_account_id, 'The M-Pesa account');

  v_trans := upper(btrim(p_payment->>'transId'));
  IF v_trans IS NULL OR v_trans !~ '^[A-Z0-9]{6,30}$' THEN
    RAISE EXCEPTION 'M-Pesa transaction code % is not valid.', COALESCE(p_payment->>'transId', '(blank)') USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_time := (p_payment->>'transTime')::TIMESTAMPTZ;
    v_amount := (p_payment->>'amountCents')::BIGINT;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'The M-Pesa payment has a time or amount that cannot be read.' USING ERRCODE = '22023';
  END;
  IF v_time IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_amount > 100000000000 THEN
    RAISE EXCEPTION 'The M-Pesa payment needs a time and an amount above nothing.' USING ERRCODE = '22023';
  END IF;
  v_ref := left(NULLIF(btrim(p_payment->>'billRefNumber'), ''), 100);
  v_payer := left(NULLIF(btrim(p_payment->>'payerName'), ''), 100);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':mpesa:' || v_trans, 0));
  SELECT payment.id, payment.bank_transaction_id, payment.outcome INTO v_existing
  FROM public.mpesa_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.trans_id = v_trans;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'transId', v_trans, 'bankTransactionId', v_existing.bank_transaction_id,
      'inserted', false, 'outcome', v_existing.outcome);
  END IF;

  -- The statement line, keyed by the receipt number as a statement upload
  -- keys it; a line the account already has (from an earlier upload) is used.
  v_description := left('M-Pesa ' || v_trans
    || COALESCE(' from ' || v_payer, '')
    || COALESCE(', account ' || v_ref, ''), 500);
  INSERT INTO public.bank_transactions (org_id, bank_account_id, date, description, amount_cents, direction,
    status, reference, import_key)
  VALUES (p_org_id, v_integration.money_account_id, (v_time AT TIME ZONE 'Africa/Nairobi')::DATE, v_description,
    v_amount, 'IN', 'UNREVIEWED', v_trans, 'ref:' || lower(v_trans))
  ON CONFLICT (org_id, bank_account_id, import_key) WHERE import_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_line;
  IF v_line IS NULL THEN
    SELECT tx.id INTO v_line FROM public.bank_transactions AS tx
    WHERE tx.org_id = p_org_id AND tx.bank_account_id = v_integration.money_account_id
      AND tx.import_key = 'ref:' || lower(v_trans);
  END IF;

  INSERT INTO public.mpesa_payments (org_id, trans_id, trans_time, amount_cents, bill_ref_number, msisdn,
    payer_name, shortcode, transaction_type, source, raw, bank_transaction_id)
  VALUES (p_org_id, v_trans, v_time, v_amount, v_ref, left(NULLIF(btrim(p_payment->>'msisdn'), ''), 100),
    v_payer, left(NULLIF(btrim(p_payment->>'shortcode'), ''), 20),
    left(NULLIF(btrim(p_payment->>'transactionType'), ''), 40), p_source,
    COALESCE(p_payment->'raw', '{}'::JSONB), v_line)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, NULL, 'CREATE', 'MPESA_PAYMENT', v_id,
    jsonb_build_object('source', p_source, 'transId', v_trans, 'amountCents', v_amount,
      'bankTransactionId', v_line));

  RETURN jsonb_build_object('id', v_id, 'transId', v_trans, 'bankTransactionId', v_line,
    'inserted', true, 'outcome', 'WAITING');
END;
$function$;
REVOKE ALL ON FUNCTION public.receive_mpesa_payment(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_mpesa_payment(UUID, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Settling an invoice from the account number
-- ---------------------------------------------------------------------------

CREATE FUNCTION private.mpesa_amount(p_cents BIGINT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT pg_catalog.to_char(p_cents / 100.0, 'FM999,999,999,990.00');
$function$;
REVOKE ALL ON FUNCTION private.mpesa_amount(BIGINT) FROM PUBLIC, anon, authenticated, service_role;

-- Records why a payment waits, and returns what the caller reports.
CREATE FUNCTION private.mpesa_payment_waits(p_org_id UUID, p_payment_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  UPDATE public.mpesa_payments SET outcome_note = left(p_note, 300)
  WHERE org_id = p_org_id AND id = p_payment_id AND outcome = 'WAITING';
  RETURN jsonb_build_object('id', p_payment_id, 'outcome', 'WAITING', 'note', left(p_note, 300));
END;
$function$;
REVOKE ALL ON FUNCTION private.mpesa_payment_waits(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- p_actor is the organization's integration actor, or the person asking
-- for the payment to be settled again. With no actor the payment waits.
CREATE FUNCTION public.settle_mpesa_payment(p_org_id UUID, p_payment_id UUID, p_actor UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_payment RECORD;
  v_line RECORD;
  v_base_currency TEXT;
  v_compact TEXT;
  v_count INTEGER;
  v_invoice RECORD;
  v_entry UUID;
BEGIN
  SELECT payment.id, payment.trans_id, payment.amount_cents, payment.bill_ref_number, payment.bank_transaction_id,
         payment.outcome, payment.invoice_id, payment.journal_entry_id
  INTO v_payment
  FROM public.mpesa_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'M-Pesa payment not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_payment.outcome = 'SETTLED' THEN
    RETURN jsonb_build_object('id', v_payment.id, 'outcome', 'SETTLED', 'invoiceId', v_payment.invoice_id,
      'journalEntryId', v_payment.journal_entry_id);
  END IF;
  IF p_actor IS NULL THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      'No one is named in Settings, Integrations to post M-Pesa payments, so it waits in Banking.');
  END IF;
  PERFORM private.require_financial_actor(p_org_id, p_actor);

  SELECT tx.id, tx.status INTO v_line FROM public.bank_transactions AS tx
  WHERE tx.org_id = p_org_id AND tx.id = v_payment.bank_transaction_id;
  IF v_line.status = 'MATCHED' THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id, 'Its statement line is already matched in Banking.');
  END IF;

  v_compact := upper(regexp_replace(COALESCE(v_payment.bill_ref_number, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_compact = '' THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      'The customer gave no account number (a till payment has none), so it waits in Banking.');
  END IF;
  SELECT count(*) INTO v_count FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id
    AND upper(regexp_replace(invoice.invoice_number, '[^A-Za-z0-9]', '', 'g')) = v_compact
    AND invoice.status IN ('SENT', 'PARTIALLY_PAID') AND invoice.amount_due_cents > 0;
  IF v_count = 0 THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      format('Account number %s is not the number of an open invoice, so it waits in Banking.', v_payment.bill_ref_number));
  END IF;
  IF v_count > 1 THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      format('Account number %s fits more than one open invoice, so it waits in Banking.', v_payment.bill_ref_number));
  END IF;
  SELECT invoice.id, invoice.invoice_number, invoice.amount_due_cents, upper(invoice.currency) AS currency
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id
    AND upper(regexp_replace(invoice.invoice_number, '[^A-Za-z0-9]', '', 'g')) = v_compact
    AND invoice.status IN ('SENT', 'PARTIALLY_PAID') AND invoice.amount_due_cents > 0;
  SELECT upper(org.base_currency) INTO v_base_currency FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_invoice.currency <> v_base_currency THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      format('%s is in %s; match it in Banking at the day''s rate.', v_invoice.invoice_number, v_invoice.currency));
  END IF;
  IF v_payment.amount_cents > v_invoice.amount_due_cents THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      format('%s %s is more than the %s %s due on %s; match it in Banking.', v_base_currency,
        private.mpesa_amount(v_payment.amount_cents), v_base_currency,
        private.mpesa_amount(v_invoice.amount_due_cents), v_invoice.invoice_number));
  END IF;

  BEGIN
    v_entry := public.match_bank_transaction(p_org_id, v_payment.bank_transaction_id, NULL, NULL,
      v_invoice.id, NULL, p_actor);
  EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation OR unique_violation
    OR invalid_parameter_value OR insufficient_privilege THEN
    RETURN private.mpesa_payment_waits(p_org_id, p_payment_id,
      left(format('%s was not settled: %s', v_invoice.invoice_number, SQLERRM), 300));
  END;

  UPDATE public.mpesa_payments
  SET outcome = 'SETTLED', outcome_note = NULL, invoice_id = v_invoice.id, journal_entry_id = v_entry,
    settled_at = now()
  WHERE org_id = p_org_id AND id = p_payment_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'SETTLE', 'MPESA_PAYMENT', p_payment_id,
    jsonb_build_object('transId', v_payment.trans_id, 'invoiceId', v_invoice.id,
      'invoiceNumber', v_invoice.invoice_number, 'journalEntryId', v_entry, 'amountCents', v_payment.amount_cents));
  RETURN jsonb_build_object('id', p_payment_id, 'outcome', 'SETTLED', 'invoiceId', v_invoice.id,
    'invoiceNumber', v_invoice.invoice_number, 'journalEntryId', v_entry);
END;
$function$;
REVOKE ALL ON FUNCTION public.settle_mpesa_payment(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_mpesa_payment(UUID, UUID, UUID) TO service_role;

-- Rollback: DROP FUNCTION public.settle_mpesa_payment, public.receive_mpesa_payment,
-- private.mpesa_payment_waits, private.mpesa_amount; DROP TABLE public.mpesa_payments;
-- DROP FUNCTION private.require_business_org; DROP INDEX invoices_org_number_compact;
-- ALTER TABLE public.bank_transactions DROP CONSTRAINT bank_transactions_org_id_id_key;
-- re-create save_mpesa_integration, mpesa_callback_target, record_mpesa_registration and
-- set_mpesa_callback_token from 20261009000400; DROP TRIGGER org_integrations_require_mpesa_edition
-- and re-create org_integrations_require_church on private.require_church_org();
-- ALTER TABLE public.org_integrations DROP COLUMN money_account_id.
