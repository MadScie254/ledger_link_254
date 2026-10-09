-- M-Pesa giving for Kundi: receipts arrive from Safaricom's C2B confirmation
-- callback or from an uploaded M-Pesa statement, are kept once per
-- transaction, and are posted as giving when the Worker's matching rules
-- (src/utils/givingRules.ts) find one member and fund for them. Receipts the
-- rules cannot place wait in the treasurer's queue. The Daraja consumer key
-- and secret are kept in Supabase Vault and read only by the Worker.

-- ---------------------------------------------------------------------------
-- 1. Keep receipts, once per M-Pesa transaction.
-- ---------------------------------------------------------------------------
-- p_receipts: [{"transId", "transTime" (ISO), "amountCents", "billRefNumber",
-- "msisdn", "firstName", "raw"}]. A receipt already kept is returned as it
-- stands, with inserted = false. A callback has no person behind it, so
-- p_created_by may be null for C2B_CALLBACK; an upload names who uploaded.
CREATE FUNCTION public.ingest_mpesa_receipts(
  p_org_id UUID,
  p_source TEXT,
  p_receipts JSONB,
  p_created_by UUID
)
RETURNS TABLE (
  id UUID, trans_id TEXT, trans_time TIMESTAMPTZ, amount_cents BIGINT, bill_ref_number TEXT,
  first_name TEXT, status TEXT, member_id UUID, fund_id UUID, inserted BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_item JSONB;
  v_trans TEXT;
  v_id UUID;
  v_new UUID[] := '{}';
  v_all TEXT[] := '{}';
  v_batch UUID := gen_random_uuid();
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('C2B_CALLBACK', 'STATEMENT_UPLOAD') THEN
    RAISE EXCEPTION 'Receipts come from the C2B callback or a statement upload.' USING ERRCODE = '22023';
  END IF;
  IF p_created_by IS NOT NULL OR p_source = 'STATEMENT_UPLOAD' THEN
    PERFORM private.require_church_actor(p_org_id, p_created_by);
  ELSIF NOT EXISTS (SELECT 1 FROM public.organizations WHERE organizations.id = p_org_id AND edition = 'church') THEN
    RAISE EXCEPTION 'This action is available in Kundi church organizations.' USING ERRCODE = '23514';
  END IF;
  IF p_receipts IS NULL OR jsonb_typeof(p_receipts) <> 'array' OR jsonb_array_length(p_receipts) = 0 THEN
    RAISE EXCEPTION 'No M-Pesa receipts were given.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_receipts) > 5000 THEN
    RAISE EXCEPTION 'Upload at most 5,000 M-Pesa lines at a time.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_receipts) LOOP
    v_trans := upper(btrim(v_item->>'transId'));
    IF v_trans IS NULL OR v_trans !~ '^[A-Z0-9]{6,30}$' THEN
      RAISE EXCEPTION 'M-Pesa transaction code % is not valid.', COALESCE(v_item->>'transId', '(blank)') USING ERRCODE = '22023';
    END IF;
    v_all := array_append(v_all, v_trans);
    INSERT INTO public.mpesa_receipts AS receipt (org_id, trans_id, trans_time, amount_cents, bill_ref_number,
      msisdn, first_name, raw, source)
    VALUES (p_org_id, v_trans, (v_item->>'transTime')::TIMESTAMPTZ, (v_item->>'amountCents')::BIGINT,
      NULLIF(btrim(v_item->>'billRefNumber'), ''), NULLIF(btrim(v_item->>'msisdn'), ''),
      NULLIF(btrim(v_item->>'firstName'), ''), COALESCE(v_item->'raw', '{}'::JSONB), p_source)
    ON CONFLICT ON CONSTRAINT mpesa_receipts_org_trans_key DO NOTHING
    RETURNING receipt.id INTO v_id;
    IF v_id IS NOT NULL THEN
      v_new := array_append(v_new, v_id);
      IF p_source = 'C2B_CALLBACK' THEN
        INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
        VALUES (p_org_id, p_created_by, 'CREATE', 'MPESA_RECEIPT', v_id,
          jsonb_build_object('source', 'MPESA_C2B', 'transId', v_trans, 'amountCents', (v_item->>'amountCents')::BIGINT));
      END IF;
      v_id := NULL;
    END IF;
  END LOOP;

  IF p_source = 'STATEMENT_UPLOAD' THEN
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
    VALUES (p_org_id, p_created_by, 'IMPORT', 'MPESA_STATEMENT', v_batch,
      jsonb_build_object('source', 'MPESA_STATEMENT', 'lines', cardinality(v_all), 'newReceipts', cardinality(v_new)));
  END IF;

  RETURN QUERY
  SELECT receipt.id, receipt.trans_id, receipt.trans_time, receipt.amount_cents, receipt.bill_ref_number,
    receipt.first_name, receipt.status, receipt.member_id, receipt.fund_id, receipt.id = ANY (v_new)
  FROM public.mpesa_receipts AS receipt
  WHERE receipt.org_id = p_org_id AND receipt.trans_id = ANY (v_all)
  ORDER BY receipt.trans_time, receipt.trans_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Post receipts the rules (or the treasurer) placed, in one call.
-- ---------------------------------------------------------------------------
-- p_matches: [{"receiptId", "memberId", "fundId", "incomeAccountId"}]. Each
-- receipt posts through record_contribution on its own savepoint: one that
-- is refused (already posted, fund closed) is reported and stays in the
-- queue; the rest still post. p_source names where the match came from:
-- MPESA_C2B (the callback), MPESA_STATEMENT (an upload) or QUEUE (a person).
CREATE FUNCTION public.post_mpesa_matches(
  p_org_id UUID,
  p_matches JSONB,
  p_source TEXT,
  p_created_by UUID
)
RETURNS TABLE (receipt_id UUID, contribution_id UUID, journal_entry_id UUID, error TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_item JSONB;
  v_receipt RECORD;
  v_result JSONB;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_source IS NULL OR p_source NOT IN ('MPESA_C2B', 'MPESA_STATEMENT', 'QUEUE') THEN
    RAISE EXCEPTION 'Say where the match came from.' USING ERRCODE = '22023';
  END IF;
  IF p_matches IS NULL OR jsonb_typeof(p_matches) <> 'array' THEN
    RAISE EXCEPTION 'No matches were given.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_matches) > 5000 THEN
    RAISE EXCEPTION 'Post at most 5,000 M-Pesa lines at a time.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_matches) LOOP
    receipt_id := (v_item->>'receiptId')::UUID;
    contribution_id := NULL;
    journal_entry_id := NULL;
    error := NULL;
    SELECT receipt.id, receipt.trans_id, receipt.amount_cents INTO v_receipt
    FROM public.mpesa_receipts AS receipt
    WHERE receipt.org_id = p_org_id AND receipt.id = receipt_id;
    IF NOT FOUND THEN
      error := 'M-Pesa receipt not found in this church.';
      RETURN NEXT;
      CONTINUE;
    END IF;
    BEGIN
      v_result := public.record_contribution(
        p_org_id, NULLIF(v_item->>'memberId', '')::UUID, (v_item->>'fundId')::UUID,
        NULLIF(v_item->>'incomeAccountId', '')::UUID, v_receipt.amount_cents, 'MPESA', NULL,
        v_receipt.id, 'mpesa:' || v_receipt.id::TEXT, p_created_by);
      contribution_id := (v_result->>'id')::UUID;
      journal_entry_id := (v_result->>'journalEntryId')::UUID;
      INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
      VALUES (p_org_id, p_created_by, 'MATCH', 'MPESA_RECEIPT', v_receipt.id,
        jsonb_build_object('source', p_source, 'transId', v_receipt.trans_id, 'contributionId', contribution_id,
          'memberId', v_item->>'memberId', 'fundId', v_item->>'fundId', 'journalEntryId', journal_entry_id));
    EXCEPTION WHEN OTHERS THEN
      contribution_id := NULL;
      journal_entry_id := NULL;
      error := SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Set a receipt aside as not giving (a refund, a test, a payment for
--    something else), or put it back in the queue.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ignore_mpesa_receipt(p_org_id UUID, p_receipt_id UUID, p_reason TEXT, p_created_by UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_receipt RECORD;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Say why this receipt is not giving.' USING ERRCODE = '22023';
  END IF;
  SELECT receipt.id, receipt.trans_id, receipt.status INTO v_receipt
  FROM public.mpesa_receipts AS receipt
  WHERE receipt.org_id = p_org_id AND receipt.id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'M-Pesa receipt not found in this church.' USING ERRCODE = '23503';
  END IF;
  IF v_receipt.status <> 'UNMATCHED' THEN
    RAISE EXCEPTION 'M-Pesa receipt % is % and cannot be set aside.', v_receipt.trans_id, lower(v_receipt.status)
      USING ERRCODE = '23514';
  END IF;
  UPDATE public.mpesa_receipts SET status = 'IGNORED', ignored_reason = btrim(p_reason)
  WHERE org_id = p_org_id AND id = p_receipt_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'IGNORE', 'MPESA_RECEIPT', p_receipt_id,
    jsonb_build_object('transId', v_receipt.trans_id, 'reason', btrim(p_reason)));
END;
$function$;

CREATE FUNCTION public.restore_mpesa_receipt(p_org_id UUID, p_receipt_id UUID, p_created_by UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_receipt RECORD;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  SELECT receipt.id, receipt.trans_id, receipt.status INTO v_receipt
  FROM public.mpesa_receipts AS receipt
  WHERE receipt.org_id = p_org_id AND receipt.id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'M-Pesa receipt not found in this church.' USING ERRCODE = '23503';
  END IF;
  IF v_receipt.status <> 'IGNORED' THEN
    RAISE EXCEPTION 'Only a receipt set aside can go back to the queue.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.mpesa_receipts SET status = 'UNMATCHED', ignored_reason = NULL
  WHERE org_id = p_org_id AND id = p_receipt_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'RESTORE', 'MPESA_RECEIPT', p_receipt_id,
    jsonb_build_object('transId', v_receipt.trans_id));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The church's Daraja settings. Owners and admins only. The consumer key
--    and secret go into Vault and are never returned by this function.
-- ---------------------------------------------------------------------------
CREATE FUNCTION private.require_org_admin(p_org_id UUID, p_actor UUID) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_org_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Organization and actor are required.' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'The actor must match the signed-in user.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships AS membership
    WHERE membership.org_id = p_org_id AND membership.user_id = p_actor AND membership.role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'An organization owner or admin role is required.' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_org_admin(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.save_mpesa_integration(
  p_org_id UUID,
  p_shortcode TEXT,
  p_environment TEXT,
  p_consumer_key TEXT,
  p_consumer_secret TEXT,
  p_integration_actor_id UUID,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_row RECORD;
  v_secret UUID;
  v_changed BOOLEAN := false;
  v_key TEXT := NULLIF(btrim(p_consumer_key), '');
  v_value TEXT := NULLIF(btrim(p_consumer_secret), '');
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_created_by);
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'church') THEN
    RAISE EXCEPTION 'This action is available in Kundi church organizations.' USING ERRCODE = '23514';
  END IF;
  IF p_shortcode IS NULL OR btrim(p_shortcode) !~ '^[0-9]{5,10}$' THEN
    RAISE EXCEPTION 'Enter the paybill or till number Safaricom gave the church (5 to 10 digits).' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'M-Pesa giving is posted in the name of an owner, admin or accountant of this church.' USING ERRCODE = '22023';
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
    INSERT INTO public.org_integrations (org_id, kind, shortcode, environment, vault_secret_id, created_by)
    VALUES (p_org_id, 'MPESA_C2B', btrim(p_shortcode), p_environment, v_secret, p_created_by)
    RETURNING id INTO v_row.id;
  ELSE
    -- A new paybill or environment needs its URLs registered again.
    UPDATE public.org_integrations
    SET shortcode = btrim(p_shortcode), environment = p_environment, vault_secret_id = v_secret,
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
      'credentialsChanged', v_changed, 'integrationActorId', p_integration_actor_id));

  RETURN jsonb_build_object('id', v_row.id, 'hasCredentials', v_secret IS NOT NULL);
END;
$function$;

-- Read by the Worker when it calls Daraja, never by the browser.
CREATE FUNCTION public.mpesa_integration_credentials(p_org_id UUID)
RETURNS TABLE (shortcode TEXT, environment TEXT, consumer_key TEXT, consumer_secret TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT integration.shortcode, integration.environment,
    (secret.decrypted_secret::JSONB)->>'consumerKey', (secret.decrypted_secret::JSONB)->>'consumerSecret'
  FROM public.org_integrations AS integration
  JOIN vault.decrypted_secrets AS secret ON secret.id = integration.vault_secret_id
  WHERE integration.org_id = p_org_id AND integration.kind = 'MPESA_C2B';
$function$;

-- The outcome of a Register URL call. On success the new callback token's
-- SHA-256 replaces the old one, so earlier URLs stop working; on failure the
-- old token stays and Safaricom's answer is kept for the admin to read.
CREATE FUNCTION public.record_mpesa_registration(
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
    RAISE EXCEPTION 'Save the church''s M-Pesa settings first.' USING ERRCODE = '23503';
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

-- Which church a callback token belongs to. Only the hash is stored; the
-- Worker hashes the token in the URL and compares the two in constant time.
CREATE FUNCTION public.mpesa_callback_target(p_token_hash TEXT)
RETURNS TABLE (org_id UUID, token_hash TEXT, shortcode TEXT, integration_actor_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT integration.org_id, integration.callback_token_hash, integration.shortcode, organization.integration_actor_id
  FROM public.org_integrations AS integration
  JOIN public.organizations AS organization ON organization.id = integration.org_id
  WHERE integration.callback_token_hash = p_token_hash AND integration.kind = 'MPESA_C2B'
    AND integration.status <> 'DISABLED' AND organization.edition = 'church';
$function$;

-- New callback URLs for a church that registers them with Safaricom by hand
-- (through the M-Pesa org portal or its bank). The old URLs stop working.
CREATE FUNCTION public.set_mpesa_callback_token(p_org_id UUID, p_token_hash TEXT, p_created_by UUID)
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
    RAISE EXCEPTION 'Save the church''s M-Pesa settings first.' USING ERRCODE = '23503';
  END IF;
  UPDATE public.org_integrations SET callback_token_hash = p_token_hash, updated_at = now() WHERE id = v_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'ROTATE_TOKEN', 'MPESA_INTEGRATION', v_id, '{}'::JSONB);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Safaricom's charges from an uploaded statement. Each charge line is
--    kept by its receipt number, so a statement uploaded twice, or two
--    statements that overlap, post each charge once. The new charges post
--    together through record_mpesa_charges.
-- ---------------------------------------------------------------------------
CREATE TABLE public.mpesa_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trans_id TEXT NOT NULL CHECK (trans_id ~ '^[A-Z0-9]{6,30}$'),
  charged_on DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  journal_entry_id UUID NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mpesa_charges_org_trans_key UNIQUE (org_id, trans_id),
  CONSTRAINT mpesa_charges_org_journal_fkey FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX mpesa_charges_org_journal ON public.mpesa_charges(org_id, journal_entry_id);
CREATE TRIGGER mpesa_charges_require_church BEFORE INSERT OR UPDATE OF org_id ON public.mpesa_charges
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();
CREATE TRIGGER mpesa_charges_permanent BEFORE UPDATE OR DELETE ON public.mpesa_charges
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();
ALTER TABLE public.mpesa_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mpesa_charges FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mpesa_charges TO authenticated, service_role;
CREATE POLICY mpesa_charges_member_read ON public.mpesa_charges FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));

-- p_charges: [{"transId", "date", "amountCents"}].
CREATE FUNCTION public.record_statement_charges(p_org_id UUID, p_charges JSONB, p_created_by UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_new JSONB;
  v_count INT;
  v_total BIGINT;
  v_end DATE;
  v_key TEXT;
  v_entry UUID;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_charges IS NULL OR jsonb_typeof(p_charges) <> 'array' THEN
    RAISE EXCEPTION 'No charges were given.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_charges) > 5000 THEN
    RAISE EXCEPTION 'Upload at most 5,000 M-Pesa lines at a time.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':statement-charges', 0));

  WITH given AS (
    SELECT DISTINCT ON (upper(btrim(item->>'transId')))
      upper(btrim(item->>'transId')) AS trans_id, (item->>'date')::DATE AS charged_on,
      (item->>'amountCents')::BIGINT AS amount_cents
    FROM jsonb_array_elements(p_charges) AS item
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('transId', given.trans_id, 'date', given.charged_on,
      'amountCents', given.amount_cents) ORDER BY given.trans_id), '[]'::JSONB),
    count(*), COALESCE(sum(given.amount_cents), 0), max(given.charged_on),
    md5(string_agg(given.trans_id, ',' ORDER BY given.trans_id))
  INTO v_new, v_count, v_total, v_end, v_key
  FROM given
  WHERE NOT EXISTS (SELECT 1 FROM public.mpesa_charges AS charge
    WHERE charge.org_id = p_org_id AND charge.trans_id = given.trans_id);

  IF v_count = 0 THEN
    RETURN jsonb_build_object('journalEntryId', NULL, 'charges', 0, 'amountCents', 0,
      'alreadyRecorded', jsonb_array_length(p_charges));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) AS item
    WHERE item->>'transId' !~ '^[A-Z0-9]{6,30}$' OR (item->>'amountCents')::BIGINT <= 0) THEN
    RAISE EXCEPTION 'Each charge needs its M-Pesa receipt number and an amount above nil.' USING ERRCODE = '22023';
  END IF;

  v_entry := public.record_mpesa_charges(p_org_id, v_end, v_total,
    'Statement charges, ' || v_count || CASE WHEN v_count = 1 THEN ' line' ELSE ' lines' END,
    'statement:' || v_key, p_created_by);
  INSERT INTO public.mpesa_charges (org_id, trans_id, charged_on, amount_cents, journal_entry_id, created_by)
  SELECT p_org_id, item->>'transId', (item->>'date')::DATE, (item->>'amountCents')::BIGINT, v_entry, p_created_by
  FROM jsonb_array_elements(v_new) AS item;

  RETURN jsonb_build_object('journalEntryId', v_entry, 'charges', v_count, 'amountCents', v_total,
    'alreadyRecorded', jsonb_array_length(p_charges) - v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_mpesa_receipts(UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_mpesa_matches(UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ignore_mpesa_receipt(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_mpesa_receipt(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_mpesa_integration(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mpesa_integration_credentials(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_mpesa_registration(UUID, TEXT, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mpesa_callback_target(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_mpesa_callback_token(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_statement_charges(UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mpesa_receipts(UUID, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_mpesa_matches(UUID, JSONB, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ignore_mpesa_receipt(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_mpesa_receipt(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_mpesa_integration(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mpesa_integration_credentials(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mpesa_registration(UUID, TEXT, BOOLEAN, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mpesa_callback_target(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_mpesa_callback_token(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_statement_charges(UUID, JSONB, UUID) TO service_role;

-- Rollback: drop the ten public functions above,
-- private.require_org_admin(UUID, UUID) and the mpesa_charges table. Vault secrets saved through
-- save_mpesa_integration stay in vault.secrets until deleted there.
