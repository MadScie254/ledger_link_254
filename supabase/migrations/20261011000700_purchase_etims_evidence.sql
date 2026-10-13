-- Purchase eTIMS evidence is recorded with the posting, without changing journal lines.
ALTER TABLE public.bills
  ADD COLUMN etims_invoice_number TEXT,
  ADD COLUMN etims_invoice_date DATE,
  ADD COLUMN etims_exemption_reason TEXT,
  ADD CONSTRAINT bills_etims_evidence_check CHECK (
    (etims_invoice_number IS NULL AND etims_invoice_date IS NULL AND etims_exemption_reason IS NULL)
    OR (etims_invoice_number IS NOT NULL AND etims_invoice_date IS NOT NULL AND etims_exemption_reason IS NULL)
    OR (etims_invoice_number IS NULL AND etims_invoice_date IS NULL AND etims_exemption_reason IS NOT NULL)
  ),
  ADD CONSTRAINT bills_etims_text_check CHECK (
    (etims_invoice_number IS NULL OR (length(etims_invoice_number) BETWEEN 1 AND 100 AND etims_invoice_number = btrim(etims_invoice_number)))
    AND (etims_exemption_reason IS NULL OR (length(etims_exemption_reason) BETWEEN 1 AND 500 AND etims_exemption_reason = btrim(etims_exemption_reason)))
  );

ALTER TABLE public.cash_transactions
  ADD COLUMN etims_invoice_number TEXT,
  ADD COLUMN etims_invoice_date DATE,
  ADD COLUMN etims_exemption_reason TEXT,
  ADD CONSTRAINT cash_transactions_etims_evidence_check CHECK (
    kind <> 'EXPENSE' AND etims_invoice_number IS NULL AND etims_invoice_date IS NULL AND etims_exemption_reason IS NULL
    OR kind = 'EXPENSE' AND (
      (etims_invoice_number IS NULL AND etims_invoice_date IS NULL AND etims_exemption_reason IS NULL)
      OR (etims_invoice_number IS NOT NULL AND etims_invoice_date IS NOT NULL AND etims_exemption_reason IS NULL)
      OR (etims_invoice_number IS NULL AND etims_invoice_date IS NULL AND etims_exemption_reason IS NOT NULL)
    )
  ),
  ADD CONSTRAINT cash_transactions_etims_text_check CHECK (
    (etims_invoice_number IS NULL OR (length(etims_invoice_number) BETWEEN 1 AND 100 AND etims_invoice_number = btrim(etims_invoice_number)))
    AND (etims_exemption_reason IS NULL OR (length(etims_exemption_reason) BETWEEN 1 AND 500 AND etims_exemption_reason = btrim(etims_exemption_reason)))
  );

CREATE OR REPLACE FUNCTION public.create_bill_with_evidence(
  p_org_id UUID, p_vendor_id UUID, p_bill_date DATE, p_due_date DATE,
  p_currency TEXT, p_exchange_rate NUMERIC, p_notes TEXT, p_created_by UUID,
  p_lines JSONB, p_idempotency_key TEXT, p_supplier_reference TEXT,
  p_etims_invoice_number TEXT, p_etims_invoice_date DATE, p_etims_exemption_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_id UUID;
  v_existing RECORD;
  v_number TEXT := NULLIF(btrim(p_etims_invoice_number), '');
  v_reason TEXT := NULLIF(btrim(p_etims_exemption_reason), '');
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  IF (v_number IS NULL AND p_etims_invoice_date IS NOT NULL)
     OR (v_number IS NOT NULL AND p_etims_invoice_date IS NULL)
     OR (v_number IS NOT NULL AND v_reason IS NOT NULL)
     OR length(v_number) > 100 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Purchase eTIMS evidence is invalid.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':bill:' || p_idempotency_key, 0));
  SELECT id, etims_invoice_number, etims_invoice_date, etims_exemption_reason INTO v_existing
  FROM public.bills WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.etims_invoice_number IS DISTINCT FROM v_number
       OR v_existing.etims_invoice_date IS DISTINCT FROM p_etims_invoice_date
       OR v_existing.etims_exemption_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'This bill key was already used with different eTIMS evidence.' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  v_id := public.create_bill_with_journal(p_org_id, p_vendor_id, p_bill_date, p_due_date,
    p_currency, p_exchange_rate, p_notes, p_created_by, p_lines, p_idempotency_key, p_supplier_reference);
  UPDATE public.bills SET etims_invoice_number = v_number, etims_invoice_date = p_etims_invoice_date,
    etims_exemption_reason = v_reason WHERE org_id = p_org_id AND id = v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_expense_with_evidence(
  p_org_id UUID, p_vendor_id UUID, p_payee_name TEXT, p_txn_date DATE,
  p_paid_from_account_id UUID, p_reference TEXT, p_memo TEXT, p_lines JSONB,
  p_actor UUID, p_idempotency_key TEXT,
  p_etims_invoice_number TEXT, p_etims_invoice_date DATE, p_etims_exemption_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_posted JSONB;
  v_existing RECORD;
  v_number TEXT := NULLIF(btrim(p_etims_invoice_number), '');
  v_reason TEXT := NULLIF(btrim(p_etims_exemption_reason), '');
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  IF (v_number IS NULL AND p_etims_invoice_date IS NOT NULL)
     OR (v_number IS NOT NULL AND p_etims_invoice_date IS NULL)
     OR (v_number IS NOT NULL AND v_reason IS NOT NULL)
     OR length(v_number) > 100 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Purchase eTIMS evidence is invalid.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':cash:' || p_idempotency_key, 0));
  SELECT id, kind, number, total_cents, journal_entry_id, etims_invoice_number,
    etims_invoice_date, etims_exemption_reason INTO v_existing
  FROM public.cash_transactions WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.kind <> 'EXPENSE'
       OR v_existing.etims_invoice_number IS DISTINCT FROM v_number
       OR v_existing.etims_invoice_date IS DISTINCT FROM p_etims_invoice_date
       OR v_existing.etims_exemption_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'This expense key was already used with different evidence.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'number', v_existing.number,
      'totalCents', v_existing.total_cents, 'journalEntryId', v_existing.journal_entry_id);
  END IF;
  v_posted := public.record_expense(p_org_id, p_vendor_id, p_payee_name, p_txn_date,
    p_paid_from_account_id, p_reference, p_memo, p_lines, p_actor, p_idempotency_key);
  UPDATE public.cash_transactions SET etims_invoice_number = v_number,
    etims_invoice_date = p_etims_invoice_date, etims_exemption_reason = v_reason
  WHERE org_id = p_org_id AND id = (v_posted->>'id')::UUID AND kind = 'EXPENSE';
  RETURN v_posted;
END;
$function$;

-- Only purchase VAT already posted to the recoverable VAT account is at risk.
CREATE OR REPLACE FUNCTION public.input_vat_at_risk(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE(period TEXT, supplier_id UUID, supplier_name TEXT,
  bill_count BIGINT, expense_count BIGINT, vat_cents BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Report dates are invalid.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT to_char(purchase.purchase_date, 'YYYY-MM') AS period, purchase.vendor_id,
    purchase.supplier_name, count(*) FILTER (WHERE purchase.kind = 'BILL') AS bill_count,
    count(*) FILTER (WHERE purchase.kind = 'EXPENSE') AS expense_count,
    sum(purchase.tax_cents)::BIGINT AS vat_cents
  FROM (
    SELECT bill.date AS purchase_date, bill.vendor_id,
      COALESCE(vendor.display_name, 'Unknown supplier') AS supplier_name,
      'BILL'::TEXT AS kind, bill.tax_cents
    FROM public.bills AS bill
    LEFT JOIN public.vendors AS vendor ON vendor.org_id = bill.org_id AND vendor.id = bill.vendor_id
    WHERE bill.org_id = p_org_id AND bill.date BETWEEN p_from AND p_to
      AND bill.status NOT IN ('VOID', 'DRAFT') AND bill.tax_cents > 0
      AND bill.etims_invoice_number IS NULL AND bill.etims_exemption_reason IS NULL
    UNION ALL
    SELECT txn.txn_date, txn.vendor_id, COALESCE(vendor.display_name, txn.payee_name, 'Other payees'),
      'EXPENSE'::TEXT, txn.tax_cents
    FROM public.cash_transactions AS txn
    LEFT JOIN public.vendors AS vendor ON vendor.org_id = txn.org_id AND vendor.id = txn.vendor_id
    WHERE txn.org_id = p_org_id AND txn.txn_date BETWEEN p_from AND p_to
      AND txn.kind = 'EXPENSE' AND txn.status = 'POSTED' AND txn.tax_cents > 0
      AND txn.etims_invoice_number IS NULL AND txn.etims_exemption_reason IS NULL
  ) AS purchase
  GROUP BY to_char(purchase.purchase_date, 'YYYY-MM'), purchase.vendor_id, purchase.supplier_name
  ORDER BY 1, 3;
END;
$function$;

-- Evidence may arrive after posting. This changes the document record and audit trail only.
CREATE OR REPLACE FUNCTION public.set_purchase_etims_evidence(
  p_org_id UUID, p_kind TEXT, p_record_id UUID, p_actor UUID,
  p_etims_invoice_number TEXT, p_etims_invoice_date DATE, p_etims_exemption_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_number TEXT := NULLIF(btrim(p_etims_invoice_number), '');
  v_reason TEXT := NULLIF(btrim(p_etims_exemption_reason), '');
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF (v_number IS NULL AND p_etims_invoice_date IS NOT NULL)
     OR (v_number IS NOT NULL AND p_etims_invoice_date IS NULL)
     OR (v_number IS NOT NULL AND v_reason IS NOT NULL)
     OR length(v_number) > 100 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Purchase eTIMS evidence is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'BILL' THEN
    UPDATE public.bills SET etims_invoice_number = v_number,
      etims_invoice_date = p_etims_invoice_date, etims_exemption_reason = v_reason
    WHERE org_id = p_org_id AND id = p_record_id;
  ELSIF p_kind = 'EXPENSE' THEN
    UPDATE public.cash_transactions SET etims_invoice_number = v_number,
      etims_invoice_date = p_etims_invoice_date, etims_exemption_reason = v_reason
    WHERE org_id = p_org_id AND id = p_record_id AND kind = 'EXPENSE';
  ELSE
    RAISE EXCEPTION 'Purchase kind is invalid.' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found in this organization.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'UPDATE', p_kind, p_record_id,
    jsonb_build_object('field', 'purchase_etims_evidence', 'cuInvoiceNumber', v_number,
      'cuInvoiceDate', p_etims_invoice_date, 'exemptionReason', v_reason));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_bill_with_evidence(UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT, TEXT, TEXT, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill_with_evidence(UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT, TEXT, TEXT, DATE, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.record_expense_with_evidence(UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, JSONB, UUID, TEXT, TEXT, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_with_evidence(UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, JSONB, UUID, TEXT, TEXT, DATE, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.input_vat_at_risk(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.input_vat_at_risk(UUID, DATE, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.set_purchase_etims_evidence(UUID, TEXT, UUID, UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_purchase_etims_evidence(UUID, TEXT, UUID, UUID, TEXT, DATE, TEXT) TO service_role;
