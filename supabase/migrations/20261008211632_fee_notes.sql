-- Fee-note support: preserve the business invoice signature and behavior.
ALTER TABLE public.organizations ADD COLUMN vat_registered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_vat_pin_check
  CHECK (NOT vat_registered OR NULLIF(btrim(tax_id),'') IS NOT NULL);

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
  v_item_id UUID;
  v_quantity NUMERIC;
  v_edition TEXT;
  v_vat_registered BOOLEAN;
  v_kra_pin TEXT;
  v_matter_id UUID;
  v_line_matter_id UUID;
  v_matter_type TEXT;
  v_line_kind TEXT;
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

  SELECT upper(org.base_currency),org.edition::TEXT,org.vat_registered,org.tax_id
    INTO v_base_currency,v_edition,v_vat_registered,v_kra_pin
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
  IF v_edition='law' THEN
    BEGIN
      v_matter_id := NULLIF(p_lines->0->>'matterId','')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Fee-note matter ID is invalid.' USING ERRCODE='22023';
    END;
    SELECT matter.matter_type INTO v_matter_type FROM public.matters AS matter
    WHERE matter.org_id=p_org_id AND matter.id=v_matter_id AND matter.client_id=p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fee-note matter and client must belong to this law organization.' USING ERRCODE='23503';
    END IF;
    IF current_setting('ledger.fee_note_matter_id',true) IS DISTINCT FROM v_matter_id::TEXT THEN
      RAISE EXCEPTION 'Law fee notes must use the atomic unbilled-work workflow.' USING ERRCODE='23514';
    END IF;
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
      v_item_id := NULLIF(v_line->>'inventoryItemId', '')::UUID;
      v_quantity := NULLIF(v_line->>'quantity', '')::NUMERIC;
      IF v_edition='law' THEN
        v_line_matter_id := NULLIF(v_line->>'matterId','')::UUID;
        v_line_kind := NULLIF(upper(btrim(v_line->>'lineKind')),'');
      ELSE
        v_line_matter_id := NULL;
        v_line_kind := 'OTHER';
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invoice line % contains an invalid value.', v_position USING ERRCODE = '22023';
    END;
    -- What was sold and how many, kept for sales-by-item; an invoice does not
    -- move stock (an order's completion or a sales receipt does).
    IF v_quantity IS NOT NULL AND (v_quantity <= 0 OR v_quantity > 1000000000) THEN
      RAISE EXCEPTION 'Invoice line % quantity must be greater than zero.', v_position USING ERRCODE = '22023';
    END IF;
    IF v_item_id IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_items AS item WHERE item.org_id = p_org_id AND item.id = v_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice line %: the stock item is not in this organization.', v_position USING ERRCODE = '23503';
      END IF;
    END IF;

    IF NULLIF(btrim(v_line->>'description'), '') IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_tax < 0 THEN
      RAISE EXCEPTION 'Invoice line % requires a description and positive integer-cent amount.', v_position
        USING ERRCODE = '22023';
    END IF;
    IF v_edition='law' AND (v_line_matter_id IS DISTINCT FROM v_matter_id
        OR v_line_kind NOT IN ('PROFIT_COST','DISBURSEMENT') OR v_line_kind IS NULL) THEN
      RAISE EXCEPTION 'Each fee-note line needs the same matter and a profit-cost or disbursement kind.'
        USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = v_account_id
      AND account.is_active AND (
        (v_edition='law' AND v_line_kind='DISBURSEMENT'
          AND account.code='1180' AND account.type='ASSET')
        OR (account.type='INCOME' AND (v_edition<>'law'
          OR (v_line_kind='PROFIT_COST' AND account.code=CASE
            WHEN v_matter_type='CONVEYANCING' THEN '4310' ELSE '4300' END)))
      );
    IF NOT FOUND THEN
      IF v_edition='law' THEN
        RAISE EXCEPTION 'Fee-note line % uses an invalid income or disbursement account.', v_position
          USING ERRCODE='23503';
      END IF;
      RAISE EXCEPTION 'Invoice line % must use an active income account in this organization.', v_position
        USING ERRCODE = '23503';
    END IF;
    IF v_edition='law' AND v_tax>0 AND (v_line_kind<>'PROFIT_COST'
      OR NOT v_vat_registered OR NULLIF(btrim(v_kra_pin),'') IS NULL) THEN
      RAISE EXCEPTION 'VAT applies only to profit-cost lines of a VAT-registered law organization.'
        USING ERRCODE='23514';
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
    currency, exchange_rate, foreign_amount_cents, notes, created_by, idempotency_key,
    matter_id
  ) VALUES (
    v_invoice_id, p_org_id, v_invoice_number, p_customer_id, p_issue_date, p_due_date,
    v_subtotal, v_tax_total, v_total, v_total, 'SENT',
    v_currency, p_exchange_rate, v_foreign_total, NULLIF(btrim(p_notes), ''),
    p_created_by, p_idempotency_key, v_matter_id
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
      foreign_amount_cents, foreign_tax_cents, line_position, inventory_item_id, quantity,
      line_kind
    ) VALUES (
      p_org_id, v_invoice_id, btrim(v_line->>'description'),
      (v_line->>'accountId')::UUID, v_amount, v_tax,
      v_foreign_amount, v_foreign_tax, v_position, v_item_id, v_quantity,
      CASE WHEN v_edition='law' THEN upper(btrim(v_line->>'lineKind')) ELSE 'OTHER' END
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

CREATE UNIQUE INDEX invoices_org_etims_number ON public.invoices(org_id,etims_invoice_number)
  WHERE etims_invoice_number IS NOT NULL;

-- Lock each selected work item before invoice creation. If any stamp fails,
-- the invoice, ledger entry and all stamps roll back in the same transaction.
CREATE FUNCTION public.create_fee_note_from_unbilled(p_org_id UUID,p_matter_id UUID,
  p_issue_date DATE,p_due_date DATE,p_time_entry_ids UUID[],p_disbursement_ids UUID[],
  p_vat_rate_percent NUMERIC,p_notes TEXT,p_idempotency_key TEXT,p_created_by UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_client UUID; v_matter_type TEXT; v_invoice UUID; v_lines JSONB := '[]'::JSONB;
  v_fee_account UUID; v_recoverable UUID; v_id UUID; v_seen UUID[] := ARRAY[]::UUID[];
  v_time RECORD; v_disbursement RECORD; v_tax BIGINT; v_count INTEGER := 0;
  v_updated INTEGER; v_vat_registered BOOLEAN; v_kra_pin TEXT;
BEGIN
  v_client := private.require_law_matter(p_org_id,p_matter_id,p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':invoice:' || p_idempotency_key,0));
  SELECT invoice.id INTO v_invoice FROM public.invoices AS invoice
  WHERE invoice.org_id=p_org_id AND invoice.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoices AS invoice
        WHERE invoice.id=v_invoice AND invoice.matter_id=p_matter_id
          AND invoice.date=p_issue_date AND invoice.due_date=p_due_date)
      OR (SELECT count(*) FROM public.time_entries AS entry
          WHERE entry.org_id=p_org_id AND entry.invoice_id=v_invoice)
        <> cardinality(COALESCE(p_time_entry_ids,ARRAY[]::UUID[]))
      OR (SELECT count(*) FROM public.time_entries AS entry
          WHERE entry.org_id=p_org_id AND entry.id=ANY(COALESCE(p_time_entry_ids,ARRAY[]::UUID[]))
            AND entry.invoice_id=v_invoice)
        <> cardinality(COALESCE(p_time_entry_ids,ARRAY[]::UUID[]))
      OR NOT EXISTS (SELECT 1 FROM public.audit_logs AS audit
          WHERE audit.org_id=p_org_id AND audit.resource_type='FEE_NOTE'
            AND audit.resource_id=v_invoice
            AND (audit.details->>'vatRatePercent')::NUMERIC=p_vat_rate_percent
            AND audit.details->>'notes' IS NOT DISTINCT FROM p_notes)
      OR (SELECT count(*) FROM public.disbursements AS disbursement
          WHERE disbursement.org_id=p_org_id AND disbursement.invoice_id=v_invoice)
        <> cardinality(COALESCE(p_disbursement_ids,ARRAY[]::UUID[]))
      OR (SELECT count(*) FROM public.disbursements AS disbursement
          WHERE disbursement.org_id=p_org_id
            AND disbursement.id=ANY(COALESCE(p_disbursement_ids,ARRAY[]::UUID[]))
            AND disbursement.invoice_id=v_invoice)
        <> cardinality(COALESCE(p_disbursement_ids,ARRAY[]::UUID[])) THEN
      RAISE EXCEPTION 'Idempotency key was already used for another fee note.' USING ERRCODE='23505';
    END IF;
    RETURN v_invoice;
  END IF;
  IF p_vat_rate_percent IS NULL OR p_vat_rate_percent<0 OR p_vat_rate_percent>100 THEN
    RAISE EXCEPTION 'VAT rate must be between zero and 100 percent.' USING ERRCODE='22023';
  END IF;
  SELECT org.vat_registered,org.tax_id INTO v_vat_registered,v_kra_pin
  FROM public.organizations AS org WHERE org.id=p_org_id;
  IF p_vat_rate_percent>0 AND (NOT v_vat_registered OR NULLIF(btrim(v_kra_pin),'') IS NULL) THEN
    RAISE EXCEPTION 'VAT requires a VAT-registered law organization with a KRA PIN.' USING ERRCODE='23514';
  END IF;
  SELECT matter.matter_type INTO v_matter_type FROM public.matters AS matter
  WHERE matter.org_id=p_org_id AND matter.id=p_matter_id;
  v_fee_account := private.law_account(p_org_id,
    CASE WHEN v_matter_type='CONVEYANCING' THEN '4310' ELSE '4300' END,'INCOME');
  v_recoverable := private.law_account(p_org_id,'1180','ASSET');

  FOREACH v_id IN ARRAY COALESCE(p_time_entry_ids,ARRAY[]::UUID[]) LOOP
    IF v_id IS NULL OR v_id=ANY(v_seen) THEN
      RAISE EXCEPTION 'Select each unbilled time entry once.' USING ERRCODE='23514';
    END IF;
    v_seen := array_append(v_seen,v_id);
    SELECT entry.id,entry.description,entry.amount_cents,entry.billable,entry.invoice_id
      INTO v_time FROM public.time_entries AS entry
    WHERE entry.org_id=p_org_id AND entry.matter_id=p_matter_id AND entry.id=v_id FOR UPDATE;
    IF NOT FOUND OR NOT v_time.billable OR v_time.invoice_id IS NOT NULL
      OR v_time.amount_cents IS NULL OR v_time.amount_cents<=0 THEN
      RAISE EXCEPTION 'Select only positive, billable, unbilled time from this matter.' USING ERRCODE='23514';
    END IF;
    v_tax := round(v_time.amount_cents*p_vat_rate_percent/100)::BIGINT;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'matterId',p_matter_id,'lineKind','PROFIT_COST','accountId',v_fee_account,
      'description',COALESCE(NULLIF(btrim(v_time.description),''),'Professional time'),
      'amountCents',v_time.amount_cents,'taxCents',v_tax));
    v_count := v_count+1;
  END LOOP;
  v_seen := ARRAY[]::UUID[];
  FOREACH v_id IN ARRAY COALESCE(p_disbursement_ids,ARRAY[]::UUID[]) LOOP
    IF v_id IS NULL OR v_id=ANY(v_seen) THEN
      RAISE EXCEPTION 'Select each unbilled disbursement once.' USING ERRCODE='23514';
    END IF;
    v_seen := array_append(v_seen,v_id);
    SELECT disbursement.id,disbursement.description,disbursement.amount_cents,
      disbursement.paid_from,disbursement.invoice_id INTO v_disbursement
    FROM public.disbursements AS disbursement
    WHERE disbursement.org_id=p_org_id AND disbursement.matter_id=p_matter_id
      AND disbursement.id=v_id FOR UPDATE;
    IF NOT FOUND OR v_disbursement.invoice_id IS NOT NULL OR v_disbursement.paid_from<>'OFFICE' THEN
      RAISE EXCEPTION 'Select only unbilled, office-paid disbursements from this matter.' USING ERRCODE='23514';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'matterId',p_matter_id,'lineKind','DISBURSEMENT','accountId',v_recoverable,
      'description',v_disbursement.description,'amountCents',v_disbursement.amount_cents,
      'taxCents',0));
    v_count := v_count+1;
  END LOOP;
  IF v_count=0 THEN RAISE EXCEPTION 'Select unbilled work for the fee note.' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.set_config('ledger.fee_note_matter_id',p_matter_id::TEXT,true);
  v_invoice := public.create_invoice_with_journal(p_org_id,v_client,p_issue_date,p_due_date,
    (SELECT upper(base_currency) FROM public.organizations WHERE id=p_org_id),1,
    p_notes,p_created_by,v_lines,p_idempotency_key);
  PERFORM pg_catalog.set_config('ledger.fee_note_matter_id','',true);
  UPDATE public.time_entries SET invoice_id=v_invoice
  WHERE org_id=p_org_id AND matter_id=p_matter_id AND id=ANY(COALESCE(p_time_entry_ids,ARRAY[]::UUID[]))
    AND invoice_id IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated<>cardinality(COALESCE(p_time_entry_ids,ARRAY[]::UUID[])) THEN
    RAISE EXCEPTION 'Time entries changed while creating the fee note.' USING ERRCODE='40001';
  END IF;
  UPDATE public.disbursements SET invoice_id=v_invoice
  WHERE org_id=p_org_id AND matter_id=p_matter_id
    AND id=ANY(COALESCE(p_disbursement_ids,ARRAY[]::UUID[])) AND invoice_id IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated<>cardinality(COALESCE(p_disbursement_ids,ARRAY[]::UUID[])) THEN
    RAISE EXCEPTION 'Disbursements changed while creating the fee note.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'CREATE','FEE_NOTE',v_invoice,
    jsonb_build_object('matterId',p_matter_id,'timeEntries',cardinality(COALESCE(p_time_entry_ids,ARRAY[]::UUID[])),
      'disbursements',cardinality(COALESCE(p_disbursement_ids,ARRAY[]::UUID[])),
      'vatRatePercent',p_vat_rate_percent,'notes',p_notes));
  RETURN v_invoice;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_fee_note_from_unbilled(UUID,UUID,DATE,DATE,UUID[],UUID[],NUMERIC,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_fee_note_from_unbilled(UUID,UUID,DATE,DATE,UUID[],UUID[],NUMERIC,TEXT,TEXT,UUID)
  TO service_role;

-- This stores a number entered after the firm issues the fee note in KRA's
-- system. It makes no claim that this application submitted anything to KRA.
CREATE FUNCTION public.record_fee_note_etims(p_org_id UUID,p_invoice_id UUID,
  p_etims_invoice_number TEXT,p_created_by UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_existing TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id,p_created_by);
  IF NULLIF(btrim(p_etims_invoice_number),'') IS NULL
    OR length(btrim(p_etims_invoice_number))>100 THEN
    RAISE EXCEPTION 'A KRA eTIMS invoice number is required (up to 100 characters).'
      USING ERRCODE='22023';
  END IF;
  SELECT invoice.etims_invoice_number INTO v_existing
  FROM public.invoices AS invoice
  JOIN public.matters AS matter ON matter.org_id=invoice.org_id AND matter.id=invoice.matter_id
  WHERE invoice.org_id=p_org_id AND invoice.id=p_invoice_id
    AND invoice.status IN ('SENT','PARTIALLY_PAID','PAID')
  FOR UPDATE OF invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'Issued fee note not found.' USING ERRCODE='23503'; END IF;
  IF v_existing IS NOT DISTINCT FROM btrim(p_etims_invoice_number) THEN RETURN; END IF;
  UPDATE public.invoices SET etims_invoice_number=btrim(p_etims_invoice_number),
    etims_recorded_at=now() WHERE org_id=p_org_id AND id=p_invoice_id;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'UPDATE','FEE_NOTE',p_invoice_id,
    jsonb_build_object('etimsInvoiceNumber',btrim(p_etims_invoice_number),
      'previousNumber',v_existing,'enteredManually',true));
END;
$function$;
REVOKE ALL ON FUNCTION public.record_fee_note_etims(UUID,UUID,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_fee_note_etims(UUID,UUID,TEXT,UUID) TO service_role;

-- The existing invoice void workflow posts its reversal before setting VOID.
-- Release selected work only after that reversal exists, in the same transaction.
CREATE FUNCTION private.release_void_fee_note_work() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.matter_id IS NULL OR NEW.status<>'VOID' OR OLD.status='VOID' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries AS entry
    WHERE entry.org_id=NEW.org_id AND entry.idempotency_key='void:invoice:' || NEW.id::TEXT) THEN
    RAISE EXCEPTION 'A fee note needs a posted void reversal before its work can be released.'
      USING ERRCODE='23514';
  END IF;
  UPDATE public.time_entries SET invoice_id=NULL WHERE org_id=NEW.org_id AND invoice_id=NEW.id;
  UPDATE public.disbursements SET invoice_id=NULL WHERE org_id=NEW.org_id AND invoice_id=NEW.id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.release_void_fee_note_work()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invoices_release_void_fee_note_work AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.release_void_fee_note_work();
