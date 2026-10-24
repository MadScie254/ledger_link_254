-- A link a customer opens to see an invoice, save it as a PDF and pay it.
--
-- Anyone who posts to the books makes one for an open invoice; it is sent by
-- WhatsApp, SMS or email from the person's own phone or mail. The link holds
-- a random token and works until it is withdrawn or a new link replaces it;
-- a voided or drafted invoice is not shown. The page offers the paybill and
-- the invoice number as the account (a C2B payment that settles the invoice
-- on its own, 20261022000200), and, when the business has saved its M-Pesa
-- Express passkey and names a person to post M-Pesa payments, a request to
-- the customer's phone (20261022000300) in that person's name.

CREATE TABLE public.invoice_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  -- 32 random bytes as hex, made by the Worker. Kept so the same link can be
  -- copied again; only the service role reads it.
  token TEXT NOT NULL CHECK (token ~ '^[0-9a-f]{64}$'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  views INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  CONSTRAINT invoice_share_links_token_key UNIQUE (token),
  CONSTRAINT invoice_share_links_invoice_fkey FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX invoice_share_links_one_active ON public.invoice_share_links(org_id, invoice_id) WHERE revoked_at IS NULL;
ALTER TABLE public.invoice_share_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_share_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoice_share_links TO service_role;

-- The invoice's link: the one standing, or a new one with p_token.
CREATE FUNCTION public.share_invoice_link(p_org_id UUID, p_invoice_id UUID, p_token TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_invoice RECORD;
  v_link RECORD;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT invoice.id, invoice.invoice_number, invoice.status INTO v_invoice
  FROM public.invoices AS invoice WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found in this organization.' USING ERRCODE = '23503'; END IF;
  IF v_invoice.status IN ('DRAFT', 'VOID') THEN
    RAISE EXCEPTION '% is %; only a sent invoice is shared.', v_invoice.invoice_number, lower(v_invoice.status) USING ERRCODE = '23514';
  END IF;
  SELECT link.id, link.token, link.created_at, link.views, link.last_viewed_at INTO v_link
  FROM public.invoice_share_links AS link
  WHERE link.org_id = p_org_id AND link.invoice_id = p_invoice_id AND link.revoked_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('token', v_link.token, 'createdAt', v_link.created_at, 'views', v_link.views,
      'lastViewedAt', v_link.last_viewed_at, 'created', false);
  END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The link token is not valid.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invoice_share_links (org_id, invoice_id, token, created_by)
  VALUES (p_org_id, p_invoice_id, p_token, p_actor) RETURNING id, created_at INTO v_link;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'SHARE', 'INVOICE', p_invoice_id,
    jsonb_build_object('invoiceNumber', v_invoice.invoice_number, 'linkId', v_link.id));
  RETURN jsonb_build_object('token', p_token, 'createdAt', v_link.created_at, 'views', 0, 'lastViewedAt', NULL, 'created', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.share_invoice_link(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_invoice_link(UUID, UUID, TEXT, UUID) TO service_role;

-- Withdraws the invoice's link; the next share makes a new one.
CREATE FUNCTION public.withdraw_invoice_link(p_org_id UUID, p_invoice_id UUID, p_actor UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  UPDATE public.invoice_share_links SET revoked_at = now()
  WHERE org_id = p_org_id AND invoice_id = p_invoice_id AND revoked_at IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
    VALUES (p_org_id, p_actor, 'UNSHARE', 'INVOICE', p_invoice_id, jsonb_build_object('linkId', v_id));
  END IF;
  RETURN v_id IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.withdraw_invoice_link(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_invoice_link(UUID, UUID, UUID) TO service_role;

-- What a link opens, counted as a view unless p_count is false (the page
-- checking on a payment request): the organization and invoice, and
-- how the customer can pay. Nothing for a withdrawn link or a voided invoice.
CREATE FUNCTION public.open_invoice_link(p_token TEXT, p_count BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_link RECORD;
  v_invoice RECORD;
  v_org RECORD;
  v_integration RECORD;
  v_paybill TEXT;
  v_can_request BOOLEAN := false;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT link.id, link.org_id, link.invoice_id INTO v_link
  FROM public.invoice_share_links AS link WHERE link.token = p_token AND link.revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT invoice.id, invoice.invoice_number, invoice.status, invoice.amount_due_cents, upper(invoice.currency) AS currency
  INTO v_invoice FROM public.invoices AS invoice WHERE invoice.org_id = v_link.org_id AND invoice.id = v_link.invoice_id;
  IF NOT FOUND OR v_invoice.status IN ('DRAFT', 'VOID') THEN RETURN NULL; END IF;
  SELECT org.edition::TEXT AS edition, upper(org.base_currency) AS base_currency, org.integration_actor_id INTO v_org
  FROM public.organizations AS org WHERE org.id = v_link.org_id;
  SELECT integration.shortcode, integration.status, integration.callback_token_hash, integration.express_secret_id INTO v_integration
  FROM public.org_integrations AS integration
  WHERE integration.org_id = v_link.org_id AND integration.kind = 'MPESA_C2B' AND integration.status <> 'DISABLED';
  IF FOUND AND v_org.edition = 'business' AND v_invoice.currency = v_org.base_currency THEN
    -- A paybill payment settles the invoice only once Safaricom calls back.
    IF v_integration.status = 'REGISTERED' AND v_integration.callback_token_hash IS NOT NULL THEN
      v_paybill := v_integration.shortcode;
    END IF;
    v_can_request := v_integration.express_secret_id IS NOT NULL AND v_org.integration_actor_id IS NOT NULL;
  END IF;
  IF p_count THEN
    UPDATE public.invoice_share_links SET views = views + 1, last_viewed_at = now() WHERE id = v_link.id;
  END IF;
  RETURN jsonb_build_object(
    'orgId', v_link.org_id, 'invoiceId', v_link.invoice_id, 'invoiceNumber', v_invoice.invoice_number,
    'status', v_invoice.status, 'amountDueCents', v_invoice.amount_due_cents, 'currency', v_invoice.currency,
    'paybill', v_paybill,
    'accountNumber', upper(regexp_replace(v_invoice.invoice_number, '[^A-Za-z0-9]', '', 'g')),
    'canRequestPayment', v_can_request AND v_invoice.amount_due_cents >= 100,
    'requestActor', CASE WHEN v_can_request THEN v_org.integration_actor_id END);
END;
$function$;
REVOKE ALL ON FUNCTION public.open_invoice_link(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_invoice_link(TEXT, BOOLEAN) TO service_role;

-- Rollback: DROP FUNCTION public.open_invoice_link(TEXT, BOOLEAN), public.withdraw_invoice_link(UUID, UUID, UUID),
-- public.share_invoice_link(UUID, UUID, TEXT, UUID); DROP TABLE public.invoice_share_links.
