-- Pay with M-Pesa: an invoice asks the customer's phone to pay.
--
-- With the M-Pesa Express passkey Safaricom issues for a paybill, a person
-- who posts to the books sends Daraja's STK push from an open invoice. The
-- customer sees the paybill and the invoice's number as the account on their
-- phone and enters their PIN. Safaricom's result comes back to a URL that
-- names this one request (its token is kept as a SHA-256). A paid result is
-- kept as an M-Pesa payment, as a C2B confirmation of the same receipt
-- number would be (whichever arrives first is the one kept), and settles the
-- invoice in the name of the person who asked. Paybills only: a till has no
-- account number for the invoice.

-- ---------------------------------------------------------------------------
-- 1. The passkey, in its own Vault secret
-- ---------------------------------------------------------------------------

ALTER TABLE public.org_integrations ADD COLUMN express_secret_id UUID;

CREATE FUNCTION public.save_mpesa_express_passkey(p_org_id UUID, p_passkey TEXT, p_created_by UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_row RECORD;
  v_passkey TEXT := NULLIF(btrim(p_passkey), '');
  v_secret UUID;
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_created_by);
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'business') THEN
    RAISE EXCEPTION 'Payment requests are available to business organizations.' USING ERRCODE = '23514';
  END IF;
  SELECT integration.id, integration.express_secret_id INTO v_row
  FROM public.org_integrations AS integration
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the M-Pesa settings first.' USING ERRCODE = '23503';
  END IF;
  IF v_passkey IS NULL THEN
    -- A blank passkey stops payment requests; the secret is emptied.
    IF v_row.express_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_row.express_secret_id, '{}', NULL, NULL, NULL);
    END IF;
    UPDATE public.org_integrations SET express_secret_id = NULL, updated_at = now() WHERE id = v_row.id;
  ELSE
    IF length(v_passkey) > 200 OR v_passkey !~ '^[A-Za-z0-9]+$' THEN
      RAISE EXCEPTION 'The M-Pesa Express passkey is the letters and digits Safaricom issued, at most 200.' USING ERRCODE = '22023';
    END IF;
    v_secret := v_row.express_secret_id;
    IF v_secret IS NULL THEN
      SELECT secret.id INTO v_secret FROM vault.secrets AS secret
      WHERE secret.name = 'org:' || p_org_id::TEXT || ':mpesa_express';
    END IF;
    IF v_secret IS NULL THEN
      v_secret := vault.create_secret(jsonb_build_object('passkey', v_passkey)::TEXT,
        'org:' || p_org_id::TEXT || ':mpesa_express', 'Daraja M-Pesa Express passkey');
    ELSE
      PERFORM vault.update_secret(v_secret, jsonb_build_object('passkey', v_passkey)::TEXT, NULL, NULL, NULL);
    END IF;
    UPDATE public.org_integrations SET express_secret_id = v_secret, updated_at = now() WHERE id = v_row.id;
  END IF;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'UPDATE', 'MPESA_INTEGRATION', v_row.id,
    jsonb_build_object('expressPasskeySaved', v_passkey IS NOT NULL));
  RETURN jsonb_build_object('id', v_row.id, 'hasExpressPasskey', v_passkey IS NOT NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.save_mpesa_express_passkey(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_mpesa_express_passkey(UUID, TEXT, UUID) TO service_role;

-- Read by the Worker when it calls Daraja, never by the browser.
CREATE FUNCTION public.mpesa_express_credentials(p_org_id UUID)
RETURNS TABLE (shortcode TEXT, environment TEXT, consumer_key TEXT, consumer_secret TEXT, passkey TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT integration.shortcode, integration.environment,
    (app.decrypted_secret::JSONB)->>'consumerKey', (app.decrypted_secret::JSONB)->>'consumerSecret',
    (express.decrypted_secret::JSONB)->>'passkey'
  FROM public.org_integrations AS integration
  JOIN vault.decrypted_secrets AS app ON app.id = integration.vault_secret_id
  JOIN vault.decrypted_secrets AS express ON express.id = integration.express_secret_id
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B' AND integration.status <> 'DISABLED';
$function$;
REVOKE ALL ON FUNCTION public.mpesa_express_credentials(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mpesa_express_credentials(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Requests
-- ---------------------------------------------------------------------------

CREATE TABLE public.mpesa_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  -- The customer's number as Daraja takes it: 2547XXXXXXXX or 2541XXXXXXXX.
  phone TEXT NOT NULL CHECK (phone ~ '^254[17][0-9]{8}$'),
  -- M-Pesa takes whole shillings.
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 100 AND amount_cents % 100 = 0 AND amount_cents <= 25000000),
  account_reference TEXT NOT NULL CHECK (account_reference ~ '^[A-Z0-9]{1,12}$'),
  callback_token_hash TEXT NOT NULL CHECK (callback_token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'PAID', 'FAILED')),
  checkout_request_id TEXT CHECK (checkout_request_id IS NULL OR length(checkout_request_id) BETWEEN 1 AND 100),
  merchant_request_id TEXT CHECK (merchant_request_id IS NULL OR length(merchant_request_id) <= 100),
  result_code TEXT CHECK (result_code IS NULL OR length(result_code) <= 20),
  result_message TEXT CHECK (result_message IS NULL OR length(result_message) <= 300),
  mpesa_payment_id UUID,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT mpesa_payment_requests_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT mpesa_payment_requests_token_key UNIQUE (callback_token_hash),
  CONSTRAINT mpesa_payment_requests_checkout_key UNIQUE (checkout_request_id),
  CONSTRAINT mpesa_payment_requests_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_payment_requests_payment_fkey FOREIGN KEY (org_id, mpesa_payment_id)
    REFERENCES public.mpesa_payments(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT mpesa_payment_requests_sent_check CHECK (status NOT IN ('SENT', 'PAID') OR checkout_request_id IS NOT NULL),
  CONSTRAINT mpesa_payment_requests_paid_check CHECK ((status = 'PAID') = (mpesa_payment_id IS NOT NULL))
);
CREATE INDEX mpesa_payment_requests_invoice ON public.mpesa_payment_requests(org_id, invoice_id, created_at DESC);
ALTER TABLE public.mpesa_payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpesa_payment_requests_read ON public.mpesa_payment_requests FOR SELECT
  USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.mpesa_payment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mpesa_payment_requests TO service_role;
CREATE TRIGGER mpesa_payment_requests_require_business BEFORE INSERT OR UPDATE OF org_id ON public.mpesa_payment_requests
  FOR EACH ROW EXECUTE FUNCTION private.require_business_org();

-- A request for an open base-currency invoice, before Daraja is called.
-- p_token_hash is the SHA-256 of the token the Worker puts in this
-- request's callback URL.
CREATE FUNCTION public.create_mpesa_payment_request(
  p_org_id UUID, p_invoice_id UUID, p_phone TEXT, p_amount_cents BIGINT, p_token_hash TEXT, p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_integration RECORD;
  v_invoice RECORD;
  v_base_currency TEXT;
  v_reference TEXT;
  v_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'business') THEN
    RAISE EXCEPTION 'Payment requests are available to business organizations.' USING ERRCODE = '23514';
  END IF;
  SELECT integration.status, integration.express_secret_id INTO v_integration
  FROM public.org_integrations AS integration
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B';
  IF NOT FOUND OR v_integration.status = 'DISABLED' OR v_integration.express_secret_id IS NULL THEN
    RAISE EXCEPTION 'An owner or admin saves the M-Pesa Express passkey in Settings, Integrations before invoices can ask for payment.'
      USING ERRCODE = '23503';
  END IF;
  IF p_phone IS NULL OR p_phone !~ '^254[17][0-9]{8}$' THEN
    RAISE EXCEPTION 'Enter the customer''s Safaricom number, such as 0712 345 678.' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The callback token hash is not valid.' USING ERRCODE = '22023';
  END IF;
  SELECT invoice.id, invoice.invoice_number, invoice.status, invoice.amount_due_cents, upper(invoice.currency) AS currency
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found in this organization.' USING ERRCODE = '23503';
  END IF;
  SELECT upper(base_currency) INTO v_base_currency FROM public.organizations WHERE id = p_org_id;
  IF v_invoice.status NOT IN ('SENT', 'PARTIALLY_PAID') OR v_invoice.amount_due_cents <= 0 THEN
    RAISE EXCEPTION '% has nothing due.', v_invoice.invoice_number USING ERRCODE = '23514';
  END IF;
  IF v_invoice.currency <> v_base_currency THEN
    RAISE EXCEPTION '% is in %; M-Pesa takes %.', v_invoice.invoice_number, v_invoice.currency, v_base_currency USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'M-Pesa takes whole shillings, at least 1.' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents > v_invoice.amount_due_cents THEN
    RAISE EXCEPTION 'Ask for no more than the % % due on %.', v_base_currency,
      private.mpesa_amount(v_invoice.amount_due_cents), v_invoice.invoice_number USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents > 25000000 THEN
    RAISE EXCEPTION 'One M-Pesa payment request is at most 250,000.' USING ERRCODE = '22023';
  END IF;
  v_reference := upper(regexp_replace(v_invoice.invoice_number, '[^A-Za-z0-9]', '', 'g'));
  IF v_reference = '' OR length(v_reference) > 12 THEN
    RAISE EXCEPTION '% is longer than the 12 letters and digits M-Pesa shows as the account.', v_invoice.invoice_number
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mpesa_payment_requests (org_id, invoice_id, phone, amount_cents, account_reference,
    callback_token_hash, requested_by)
  VALUES (p_org_id, p_invoice_id, p_phone, p_amount_cents, v_reference, p_token_hash, p_actor)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'CREATE', 'MPESA_PAYMENT_REQUEST', v_id,
    jsonb_build_object('invoiceId', p_invoice_id, 'invoiceNumber', v_invoice.invoice_number,
      'amountCents', p_amount_cents, 'phoneEnding', right(p_phone, 3)));
  RETURN jsonb_build_object('id', v_id, 'accountReference', v_reference, 'invoiceNumber', v_invoice.invoice_number);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_mpesa_payment_request(UUID, UUID, TEXT, BIGINT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mpesa_payment_request(UUID, UUID, TEXT, BIGINT, TEXT, UUID) TO service_role;

-- Daraja's answer to the push itself: accepted (with its checkout request
-- id) or refused (with its message). Safaricom's result can arrive before
-- this is recorded; the request then keeps that result, and only the ids
-- are added.
CREATE FUNCTION public.record_mpesa_payment_request_sent(
  p_org_id UUID, p_request_id UUID, p_accepted BOOLEAN, p_checkout_request_id TEXT, p_merchant_request_id TEXT, p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_status TEXT;
  v_checkout TEXT := left(NULLIF(btrim(p_checkout_request_id), ''), 100);
BEGIN
  SELECT request.status INTO v_status FROM public.mpesa_payment_requests AS request
  WHERE request.org_id = p_org_id AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF p_accepted AND v_checkout IS NULL THEN
    RAISE EXCEPTION 'An accepted request needs its checkout request id.' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'PENDING' THEN
    UPDATE public.mpesa_payment_requests
    SET checkout_request_id = COALESCE(checkout_request_id, v_checkout),
      merchant_request_id = COALESCE(merchant_request_id, left(NULLIF(btrim(p_merchant_request_id), ''), 100)),
      sent_at = COALESCE(sent_at, now())
    WHERE org_id = p_org_id AND id = p_request_id AND p_accepted;
    RETURN;
  END IF;
  IF p_accepted THEN
    UPDATE public.mpesa_payment_requests
    SET status = 'SENT', checkout_request_id = v_checkout,
      merchant_request_id = left(NULLIF(btrim(p_merchant_request_id), ''), 100),
      result_message = left(NULLIF(btrim(p_message), ''), 300), sent_at = now()
    WHERE org_id = p_org_id AND id = p_request_id;
  ELSE
    UPDATE public.mpesa_payment_requests
    SET status = 'FAILED', result_message = left(COALESCE(NULLIF(btrim(p_message), ''), 'Daraja did not accept the request.'), 300),
      completed_at = now()
    WHERE org_id = p_org_id AND id = p_request_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_mpesa_payment_request_sent(UUID, UUID, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mpesa_payment_request_sent(UUID, UUID, BOOLEAN, TEXT, TEXT, TEXT) TO service_role;

-- Safaricom's result, at the URL that names one request. p_payment holds the
-- paid receipt ({"transId", "transTime", "amountCents", "msisdn", "raw"})
-- when p_result_code is 0. A result already recorded is returned as it is.
CREATE FUNCTION public.complete_mpesa_payment_request(
  p_token_hash TEXT, p_checkout_request_id TEXT, p_result_code TEXT, p_result_desc TEXT, p_payment JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_request RECORD;
  v_kept JSONB;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT request.id, request.org_id, request.invoice_id, request.status, request.checkout_request_id,
         request.account_reference, request.requested_by, request.mpesa_payment_id, request.phone
  INTO v_request
  FROM public.mpesa_payment_requests AS request
  WHERE request.callback_token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_request.status IN ('PAID', 'FAILED') THEN
    RETURN jsonb_build_object('orgId', v_request.org_id, 'requestId', v_request.id, 'status', v_request.status,
      'paymentId', v_request.mpesa_payment_id, 'requestedBy', v_request.requested_by, 'repeat', true);
  END IF;
  -- The token names the request; the checkout id must agree with Daraja's
  -- answer to the push, unless the result came before that was recorded.
  IF NULLIF(btrim(p_checkout_request_id), '') IS NULL
     OR (v_request.checkout_request_id IS NOT NULL AND v_request.checkout_request_id <> btrim(p_checkout_request_id)) THEN
    RAISE EXCEPTION 'The result names another checkout request.' USING ERRCODE = '22023';
  END IF;

  IF p_result_code = '0' THEN
    IF p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object' THEN
      RAISE EXCEPTION 'A paid result needs its receipt.' USING ERRCODE = '22023';
    END IF;
    v_kept := public.receive_mpesa_payment(v_request.org_id, 'STK_CALLBACK',
      p_payment || jsonb_build_object('billRefNumber', v_request.account_reference,
        'transactionType', 'M-Pesa Express'));
    UPDATE public.mpesa_payment_requests
    SET status = 'PAID', result_code = '0', result_message = left(NULLIF(btrim(p_result_desc), ''), 300),
      checkout_request_id = COALESCE(checkout_request_id, left(btrim(p_checkout_request_id), 100)),
      mpesa_payment_id = (v_kept->>'id')::UUID, completed_at = now()
    WHERE id = v_request.id;
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
    VALUES (v_request.org_id, NULL, 'PAID', 'MPESA_PAYMENT_REQUEST', v_request.id,
      jsonb_build_object('transId', v_kept->>'transId', 'mpesaPaymentId', v_kept->>'id'));
    RETURN jsonb_build_object('orgId', v_request.org_id, 'requestId', v_request.id, 'status', 'PAID',
      'paymentId', v_kept->>'id', 'requestedBy', v_request.requested_by, 'repeat', false);
  END IF;

  UPDATE public.mpesa_payment_requests
  SET status = 'FAILED', result_code = left(COALESCE(NULLIF(btrim(p_result_code), ''), 'unknown'), 20),
    checkout_request_id = COALESCE(checkout_request_id, left(btrim(p_checkout_request_id), 100)),
    result_message = left(COALESCE(NULLIF(btrim(p_result_desc), ''), 'The customer did not pay.'), 300), completed_at = now()
  WHERE id = v_request.id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (v_request.org_id, NULL, 'FAILED', 'MPESA_PAYMENT_REQUEST', v_request.id,
    jsonb_build_object('resultCode', p_result_code, 'resultDesc', left(p_result_desc, 300)));
  RETURN jsonb_build_object('orgId', v_request.org_id, 'requestId', v_request.id, 'status', 'FAILED',
    'paymentId', NULL, 'requestedBy', v_request.requested_by, 'repeat', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_mpesa_payment_request(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mpesa_payment_request(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Rollback: DROP FUNCTION public.complete_mpesa_payment_request,
-- public.record_mpesa_payment_request_sent, public.create_mpesa_payment_request,
-- public.mpesa_express_credentials, public.save_mpesa_express_passkey;
-- DROP TABLE public.mpesa_payment_requests;
-- ALTER TABLE public.org_integrations DROP COLUMN express_secret_id.
