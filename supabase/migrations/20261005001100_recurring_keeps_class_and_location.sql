-- Recurring invoices and bills keep the class and location of the document
-- they were made from. The daily run posts with no request headers, so the
-- template carries the tags and run_recurring_template names them for the
-- posting. Otherwise as in 20261005000600.

ALTER TABLE public.recurring_templates
  ADD COLUMN IF NOT EXISTS class_id UUID,
  ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.recurring_templates
  ADD CONSTRAINT recurring_templates_org_class_fkey FOREIGN KEY (org_id, class_id)
    REFERENCES public.tracking_categories(org_id, id) ON DELETE SET NULL (class_id),
  ADD CONSTRAINT recurring_templates_org_location_fkey FOREIGN KEY (org_id, location_id)
    REFERENCES public.tracking_categories(org_id, id) ON DELETE SET NULL (location_id);

-- Templates made before this take the tags of their source document.
UPDATE public.recurring_templates AS template
SET class_id = entry.class_id, location_id = entry.location_id
FROM public.journal_entries AS entry
WHERE entry.org_id = template.org_id AND entry.source_type = template.kind
  AND entry.source_id = template.source_document_id
  AND (entry.class_id IS NOT NULL OR entry.location_id IS NOT NULL)
  AND template.class_id IS NULL AND template.location_id IS NULL;

CREATE OR REPLACE FUNCTION public.save_recurring_template(
  p_org_id UUID,
  p_template_id UUID,
  p_source_document_id UUID,
  p_kind TEXT,
  p_name TEXT,
  p_frequency TEXT,
  p_interval_count INTEGER,
  p_start_date DATE,
  p_end_date DATE,
  p_max_occurrences INTEGER,
  p_days_until_due INTEGER,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_template public.recurring_templates;
  v_source RECORD;
  v_lines JSONB;
  v_base_currency TEXT;
  v_name TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_id UUID;
  v_class_id UUID;
  v_location_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_frequency NOT IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY') THEN
    RAISE EXCEPTION 'Choose how often it repeats: weekly, monthly, quarterly or yearly.' USING ERRCODE = '22023';
  END IF;
  IF p_interval_count IS NULL OR p_interval_count < 1 OR p_interval_count > 52 THEN
    RAISE EXCEPTION 'Repeat every 1 to 52 periods.' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'The first date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The end date cannot be before the first date.' USING ERRCODE = '22023';
  END IF;
  IF p_max_occurrences IS NOT NULL AND (p_max_occurrences < 1 OR p_max_occurrences > 1000) THEN
    RAISE EXCEPTION 'Repeat between 1 and 1,000 times, or leave it open.' USING ERRCODE = '22023';
  END IF;
  IF p_days_until_due IS NULL OR p_days_until_due < 0 OR p_days_until_due > 365 THEN
    RAISE EXCEPTION 'Payment terms are 0 to 365 days.' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 200 THEN
    RAISE EXCEPTION 'Keep the name to 200 characters.' USING ERRCODE = '22023';
  END IF;

  IF p_template_id IS NOT NULL THEN
    SELECT template.* INTO v_template FROM public.recurring_templates AS template
    WHERE template.org_id = p_org_id AND template.id = p_template_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recurring template not found in this organization.' USING ERRCODE = '23503';
    END IF;
    IF v_template.status = 'ENDED' THEN
      RAISE EXCEPTION 'This schedule has ended. Make a new one from the latest document.' USING ERRCODE = '23514';
    END IF;
    IF v_template.occurrences > 0 AND p_start_date <> v_template.start_date THEN
      RAISE EXCEPTION 'The first date cannot change once a document has been made from it.' USING ERRCODE = '23514';
    END IF;
    v_template.name := COALESCE(v_name, v_template.name);
    v_template.frequency := p_frequency;
    v_template.interval_count := p_interval_count;
    v_template.start_date := p_start_date;
    v_template.end_date := p_end_date;
    v_template.max_occurrences := p_max_occurrences;
    v_template.days_until_due := p_days_until_due;
    v_template.next_run_date := private.recurring_next(v_template);
    UPDATE public.recurring_templates
    SET name = v_template.name, frequency = p_frequency, interval_count = p_interval_count, start_date = p_start_date,
        end_date = p_end_date, max_occurrences = p_max_occurrences, days_until_due = p_days_until_due,
        next_run_date = v_template.next_run_date,
        status = CASE WHEN v_template.next_run_date IS NULL THEN 'ENDED' ELSE status END,
        run_as = p_actor, last_error = NULL, updated_at = now()
    WHERE org_id = p_org_id AND id = p_template_id;
    v_id := p_template_id;
  ELSE
    IF p_kind NOT IN ('INVOICE', 'BILL') THEN
      RAISE EXCEPTION 'A recurring template is made from an invoice or a bill.' USING ERRCODE = '22023';
    END IF;
    SELECT upper(org.base_currency) INTO v_base_currency FROM public.organizations AS org WHERE org.id = p_org_id;
    IF p_kind = 'INVOICE' THEN
      SELECT invoice.invoice_number AS number, invoice.customer_id AS party_id, upper(invoice.currency) AS currency,
             invoice.total_cents, invoice.notes, invoice.status, customer.display_name AS party_name
      INTO v_source
      FROM public.invoices AS invoice
      JOIN public.customers AS customer ON customer.org_id = invoice.org_id AND customer.id = invoice.customer_id
      WHERE invoice.org_id = p_org_id AND invoice.id = p_source_document_id;
      SELECT jsonb_agg(jsonb_build_object(
        'description', line.description, 'accountId', line.account_id, 'amountCents', line.amount_cents,
        'taxCents', line.tax_cents, 'inventoryItemId', line.inventory_item_id, 'quantity', line.quantity
      ) ORDER BY line.line_position) INTO v_lines
      FROM public.invoice_lines AS line WHERE line.org_id = p_org_id AND line.invoice_id = p_source_document_id;
    ELSE
      SELECT bill.bill_number AS number, bill.vendor_id AS party_id, upper(bill.currency) AS currency,
             bill.total_cents, bill.notes, bill.status, vendor.display_name AS party_name
      INTO v_source
      FROM public.bills AS bill
      JOIN public.vendors AS vendor ON vendor.org_id = bill.org_id AND vendor.id = bill.vendor_id
      WHERE bill.org_id = p_org_id AND bill.id = p_source_document_id;
      SELECT jsonb_agg(jsonb_build_object(
        'description', line.description, 'accountId', line.account_id, 'amountCents', line.amount_cents,
        'taxCents', line.tax_cents, 'inventoryItemId', line.inventory_item_id, 'quantity', line.quantity
      ) ORDER BY line.line_position) INTO v_lines
      FROM public.bill_lines AS line WHERE line.org_id = p_org_id AND line.bill_id = p_source_document_id;
    END IF;
    IF v_source.number IS NULL THEN
      RAISE EXCEPTION '% not found in this organization.', initcap(p_kind) USING ERRCODE = '23503';
    END IF;
    IF v_source.currency IS DISTINCT FROM v_base_currency THEN
      RAISE EXCEPTION 'Recurring documents are in %; % is in %.', v_base_currency, v_source.number, v_source.currency
        USING ERRCODE = '22023';
    END IF;
    IF v_lines IS NULL THEN
      RAISE EXCEPTION '% has no lines to repeat.', v_source.number USING ERRCODE = '22023';
    END IF;

    -- The first occurrence is on the start date, which the checks above keep
    -- on or before any end date.
    -- The class and location the document was posted under come with it.
    SELECT entry.class_id, entry.location_id INTO v_class_id, v_location_id
    FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id AND entry.source_type = p_kind AND entry.source_id = p_source_document_id
    ORDER BY entry.posted_at
    LIMIT 1;

    INSERT INTO public.recurring_templates (
      org_id, kind, name, customer_id, vendor_id, source_document_id, lines, notes, total_cents,
      frequency, interval_count, start_date, end_date, max_occurrences, days_until_due,
      next_run_date, run_as, created_by, class_id, location_id
    ) VALUES (
      p_org_id, p_kind, COALESCE(v_name, v_source.party_name || ', like ' || v_source.number),
      CASE WHEN p_kind = 'INVOICE' THEN v_source.party_id END, CASE WHEN p_kind = 'BILL' THEN v_source.party_id END,
      p_source_document_id, v_lines, v_source.notes, v_source.total_cents,
      p_frequency, p_interval_count, p_start_date, p_end_date, p_max_occurrences, p_days_until_due,
      p_start_date, p_actor, p_actor, v_class_id, v_location_id
    )
    RETURNING * INTO v_template;
    v_id := v_template.id;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, CASE WHEN p_template_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END, 'RECURRING_TEMPLATE', v_id,
    jsonb_build_object('name', v_template.name, 'frequency', p_frequency, 'intervalCount', p_interval_count,
      'nextRunDate', v_template.next_run_date));

  RETURN jsonb_build_object('id', v_id, 'name', v_template.name, 'nextRunDate', v_template.next_run_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_recurring_template(
  p_org_id UUID,
  p_template_id UUID,
  p_document_date DATE,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_template public.recurring_templates;
  v_date DATE;
  v_document_id UUID;
  v_number TEXT;
  v_occurrence INTEGER;
  v_key TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT template.* INTO v_template FROM public.recurring_templates AS template
  WHERE template.org_id = p_org_id AND template.id = p_template_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring template not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_template.status = 'ENDED' OR v_template.next_run_date IS NULL THEN
    RAISE EXCEPTION 'This schedule has ended.' USING ERRCODE = '23514';
  END IF;

  v_occurrence := v_template.occurrences + 1;
  v_date := COALESCE(p_document_date, v_template.next_run_date);
  v_key := 'recurring:' || p_template_id::TEXT || ':' || v_occurrence::TEXT;

  -- Each document is posted under the template's class and location
  -- (private.request_tag reads these settings before any request header).
  -- One made inactive since is left off, so the schedule keeps running.
  PERFORM set_config('ledger.class_id', COALESCE((
    SELECT tag.id::TEXT FROM public.tracking_categories AS tag
    WHERE tag.org_id = p_org_id AND tag.id = v_template.class_id AND tag.kind = 'CLASS' AND tag.is_active), ''), true);
  PERFORM set_config('ledger.location_id', COALESCE((
    SELECT tag.id::TEXT FROM public.tracking_categories AS tag
    WHERE tag.org_id = p_org_id AND tag.id = v_template.location_id AND tag.kind = 'LOCATION' AND tag.is_active), ''), true);

  IF v_template.kind = 'INVOICE' THEN
    v_document_id := public.create_invoice_with_journal(
      p_org_id, v_template.customer_id, v_date, v_date + v_template.days_until_due,
      (SELECT upper(org.base_currency) FROM public.organizations AS org WHERE org.id = p_org_id), 1,
      v_template.notes, p_actor, v_template.lines, v_key);
    SELECT invoice.invoice_number INTO v_number FROM public.invoices AS invoice
    WHERE invoice.org_id = p_org_id AND invoice.id = v_document_id;
  ELSE
    v_document_id := public.create_bill_with_journal(
      p_org_id, v_template.vendor_id, v_date, v_date + v_template.days_until_due,
      (SELECT upper(org.base_currency) FROM public.organizations AS org WHERE org.id = p_org_id), 1,
      v_template.notes, p_actor, v_template.lines, v_key, NULL);
    SELECT bill.bill_number INTO v_number FROM public.bills AS bill
    WHERE bill.org_id = p_org_id AND bill.id = v_document_id;
  END IF;

  PERFORM set_config('ledger.class_id', '', true);
  PERFORM set_config('ledger.location_id', '', true);

  INSERT INTO public.recurring_runs (org_id, template_id, occurrence, run_date, document_id, document_number, created_by)
  VALUES (p_org_id, p_template_id, v_occurrence, v_date, v_document_id, v_number, p_actor);

  v_template.occurrences := v_occurrence;
  v_template.next_run_date := private.recurring_next(v_template);
  UPDATE public.recurring_templates
  SET occurrences = v_occurrence, next_run_date = v_template.next_run_date,
      status = CASE WHEN v_template.next_run_date IS NULL THEN 'ENDED' ELSE status END,
      last_run_at = now(), last_error = NULL, updated_at = now()
  WHERE org_id = p_org_id AND id = p_template_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'RUN', 'RECURRING_TEMPLATE', p_template_id,
    jsonb_build_object('name', v_template.name, 'occurrence', v_occurrence, 'documentId', v_document_id,
      'documentNumber', v_number, 'nextRunDate', v_template.next_run_date));

  RETURN jsonb_build_object('documentId', v_document_id, 'documentNumber', v_number, 'documentDate', v_date,
    'nextRunDate', v_template.next_run_date);
END;
$function$;

-- Rollback: restore save_recurring_template and run_recurring_template from
-- 20261005000600, then drop the two columns.
