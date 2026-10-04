-- Recurring invoices and bills.
--
-- A template is made from an invoice or bill already posted: its customer or
-- supplier and lines are copied, and a schedule is set (every N weeks,
-- months, quarters or years from a start date, until an end date or a number
-- of times). Each time it falls due a new invoice or bill is posted from the
-- template, dated that day and due after the template's terms. The Worker's
-- daily schedule calls public.run_due_recurring(); a template can also be run
-- by hand. Each occurrence is posted once: its number is part of the
-- document's idempotency key and of a unique run row.
--
-- Templates are in the organization's base currency.

CREATE TABLE public.recurring_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,
  name               TEXT NOT NULL,
  customer_id        UUID,
  vendor_id          UUID,
  source_document_id UUID,
  lines              JSONB NOT NULL,
  notes              TEXT,
  total_cents        BIGINT NOT NULL,
  frequency          TEXT NOT NULL,
  interval_count     INTEGER NOT NULL DEFAULT 1,
  start_date         DATE NOT NULL,
  end_date           DATE,
  max_occurrences    INTEGER,
  days_until_due     INTEGER NOT NULL DEFAULT 30,
  occurrences        INTEGER NOT NULL DEFAULT 0,
  next_run_date      DATE,
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  -- Who the documents are posted as: whoever last saved or resumed it.
  run_as             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_run_at        TIMESTAMPTZ,
  last_error         TEXT,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_templates_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT recurring_templates_kind_check CHECK (kind IN ('INVOICE', 'BILL')),
  CONSTRAINT recurring_templates_party_check CHECK (
    (kind = 'INVOICE' AND customer_id IS NOT NULL AND vendor_id IS NULL)
    OR (kind = 'BILL' AND vendor_id IS NOT NULL AND customer_id IS NULL)
  ),
  CONSTRAINT recurring_templates_frequency_check CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
  CONSTRAINT recurring_templates_interval_check CHECK (interval_count BETWEEN 1 AND 52),
  CONSTRAINT recurring_templates_end_check CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT recurring_templates_max_check CHECK (max_occurrences IS NULL OR max_occurrences BETWEEN 1 AND 1000),
  CONSTRAINT recurring_templates_due_check CHECK (days_until_due BETWEEN 0 AND 365),
  CONSTRAINT recurring_templates_status_check CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED')),
  CONSTRAINT recurring_templates_next_check CHECK ((status = 'ENDED') = (next_run_date IS NULL)),
  CONSTRAINT recurring_templates_text_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 200 AND (notes IS NULL OR length(notes) <= 4000)
    AND (last_error IS NULL OR length(last_error) <= 1000)
  ),
  CONSTRAINT recurring_templates_lines_check CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 200),
  CONSTRAINT recurring_templates_org_customer_fkey FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT recurring_templates_org_vendor_fkey FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.vendors(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.recurring_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  template_id   UUID NOT NULL,
  occurrence    INTEGER NOT NULL,
  run_date      DATE NOT NULL,
  document_id   UUID NOT NULL,
  document_number TEXT NOT NULL,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_runs_occurrence_key UNIQUE (template_id, occurrence),
  CONSTRAINT recurring_runs_template_fkey FOREIGN KEY (org_id, template_id)
    REFERENCES public.recurring_templates(org_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_recurring_templates_due ON public.recurring_templates(next_run_date) WHERE status = 'ACTIVE';
CREATE INDEX idx_recurring_templates_org ON public.recurring_templates(org_id, kind);
CREATE INDEX idx_recurring_runs_template ON public.recurring_runs(template_id, occurrence DESC);

ALTER TABLE public.recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_templates_select_policy ON public.recurring_templates
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY recurring_runs_select_policy ON public.recurring_runs
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.recurring_templates, public.recurring_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.recurring_templates, public.recurring_runs TO service_role;

-- The date of occurrence n (0 first), counted from the start each time so a
-- month-end start keeps to month ends (31 Jan, 28 Feb, 31 Mar).
CREATE OR REPLACE FUNCTION private.recurring_date(p_start DATE, p_frequency TEXT, p_interval INTEGER, p_occurrence INTEGER)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT (p_start + CASE p_frequency
    WHEN 'WEEKLY' THEN make_interval(weeks => p_interval * p_occurrence)
    WHEN 'MONTHLY' THEN make_interval(months => p_interval * p_occurrence)
    WHEN 'QUARTERLY' THEN make_interval(months => 3 * p_interval * p_occurrence)
    ELSE make_interval(years => p_interval * p_occurrence)
  END)::DATE;
$function$;

REVOKE ALL ON FUNCTION private.recurring_date(DATE, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- The next date to run, or NULL when the schedule is over.
CREATE OR REPLACE FUNCTION private.recurring_next(p_template public.recurring_templates)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_template.max_occurrences IS NOT NULL AND p_template.occurrences >= p_template.max_occurrences THEN NULL
    WHEN p_template.end_date IS NOT NULL
      AND private.recurring_date(p_template.start_date, p_template.frequency, p_template.interval_count, p_template.occurrences) > p_template.end_date THEN NULL
    ELSE private.recurring_date(p_template.start_date, p_template.frequency, p_template.interval_count, p_template.occurrences)
  END;
$function$;

REVOKE ALL ON FUNCTION private.recurring_next(public.recurring_templates) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Make a template from an invoice or bill, or change its schedule.
-- ---------------------------------------------------------------------------
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
    INSERT INTO public.recurring_templates (
      org_id, kind, name, customer_id, vendor_id, source_document_id, lines, notes, total_cents,
      frequency, interval_count, start_date, end_date, max_occurrences, days_until_due,
      next_run_date, run_as, created_by
    ) VALUES (
      p_org_id, p_kind, COALESCE(v_name, v_source.party_name || ', like ' || v_source.number),
      CASE WHEN p_kind = 'INVOICE' THEN v_source.party_id END, CASE WHEN p_kind = 'BILL' THEN v_source.party_id END,
      p_source_document_id, v_lines, v_source.notes, v_source.total_cents,
      p_frequency, p_interval_count, p_start_date, p_end_date, p_max_occurrences, p_days_until_due,
      p_start_date, p_actor, p_actor
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

-- ---------------------------------------------------------------------------
-- 2. Pause, resume or end a schedule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_recurring_status(
  p_org_id UUID,
  p_template_id UUID,
  p_status TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_template public.recurring_templates;
  v_next DATE;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF p_status NOT IN ('ACTIVE', 'PAUSED', 'ENDED') THEN
    RAISE EXCEPTION 'A schedule is active, paused or ended.' USING ERRCODE = '22023';
  END IF;
  SELECT template.* INTO v_template FROM public.recurring_templates AS template
  WHERE template.org_id = p_org_id AND template.id = p_template_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring template not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_template.status = p_status THEN
    RETURN jsonb_build_object('status', v_template.status, 'nextRunDate', v_template.next_run_date);
  END IF;
  IF v_template.status = 'ENDED' THEN
    RAISE EXCEPTION 'This schedule has ended. Make a new one from the latest document.' USING ERRCODE = '23514';
  END IF;
  v_next := CASE WHEN p_status = 'ENDED' THEN NULL ELSE v_template.next_run_date END;
  UPDATE public.recurring_templates
  SET status = p_status, next_run_date = v_next, last_error = CASE WHEN p_status = 'ACTIVE' THEN NULL ELSE last_error END,
      run_as = CASE WHEN p_status = 'ACTIVE' THEN p_actor ELSE run_as END, updated_at = now()
  WHERE org_id = p_org_id AND id = p_template_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'STATUS', 'RECURRING_TEMPLATE', p_template_id,
    jsonb_build_object('name', v_template.name, 'from', v_template.status, 'to', p_status));

  RETURN jsonb_build_object('status', p_status, 'nextRunDate', v_next);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Post the next occurrence: on its scheduled date, or today when run by
-- hand. Returns the document made.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Everything due, for every organization, up to today in its time zone.
-- Missed dates are caught up, at most 24 per template per call. A template
-- that fails keeps its place and records why, and the rest still run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_due_recurring()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_due RECORD;
  v_posted INTEGER := 0;
  v_failed INTEGER := 0;
  v_round INTEGER;
  v_next DATE;
  v_status TEXT;
BEGIN
  FOR v_due IN
    SELECT template.org_id, template.id, template.run_as,
           (now() AT TIME ZONE COALESCE(org.time_zone, 'Africa/Nairobi'))::DATE AS today
    FROM public.recurring_templates AS template
    JOIN public.organizations AS org ON org.id = template.org_id
    WHERE template.status = 'ACTIVE' AND template.next_run_date IS NOT NULL
      AND template.next_run_date <= (now() AT TIME ZONE COALESCE(org.time_zone, 'Africa/Nairobi'))::DATE
    ORDER BY template.next_run_date, template.id
  LOOP
    FOR v_round IN 1 .. 24
    LOOP
      SELECT template.next_run_date, template.status INTO v_next, v_status
      FROM public.recurring_templates AS template WHERE template.id = v_due.id;
      EXIT WHEN v_status <> 'ACTIVE' OR v_next IS NULL OR v_next > v_due.today;
      BEGIN
        PERFORM private.set_actor(v_due.run_as);
        PERFORM public.run_recurring_template(v_due.org_id, v_due.id, NULL, v_due.run_as);
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.recurring_templates
        SET last_error = left(SQLERRM, 1000), updated_at = now()
        WHERE id = v_due.id;
        v_failed := v_failed + 1;
        EXIT;
      END;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('posted', v_posted, 'failed', v_failed);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_recurring_template(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_recurring_status(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_recurring_template(UUID, UUID, DATE, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_due_recurring() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_recurring_template(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, INTEGER, INTEGER, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_recurring_status(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_recurring_template(UUID, UUID, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_due_recurring() TO service_role;

-- Rollback: drop the four public functions, private.recurring_next,
-- private.recurring_date, public.recurring_runs and public.recurring_templates.
