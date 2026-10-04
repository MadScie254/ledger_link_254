-- Classes and locations: two ways to cut the profit and loss besides the
-- chart of accounts, as QuickBooks offers. A class is a line of business or
-- a department (Retail, Wholesale, Contracts); a location is a branch, shop
-- or site (Nairobi CBD, Kisumu). Each organization keeps its own lists.
--
-- A posting is tagged with one class and one location, both optional. The
-- Worker names them in the x-ledger-class and x-ledger-location headers of
-- the request that posts the document, as it names the person acting, so
-- every posting function tags its entry without changing what it takes. A
-- void or reversal takes the tags of the entry it reverses, so a voided
-- document nets to nothing in its class too.

CREATE TABLE public.tracking_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tracking_categories_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT tracking_categories_kind_check CHECK (kind IN ('CLASS', 'LOCATION')),
  CONSTRAINT tracking_categories_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX tracking_categories_org_kind_name ON public.tracking_categories(org_id, kind, lower(btrim(name)));

ALTER TABLE public.tracking_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracking_categories_select_policy ON public.tracking_categories
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.tracking_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tracking_categories TO service_role;

DROP TRIGGER IF EXISTS tracking_categories_audit ON public.tracking_categories;
CREATE TRIGGER tracking_categories_audit AFTER INSERT OR UPDATE OR DELETE ON public.tracking_categories
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('TRACKING_CATEGORY', 'created_at');

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS class_id UUID,
  ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_org_class_fkey FOREIGN KEY (org_id, class_id)
    REFERENCES public.tracking_categories(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT journal_entries_org_location_fkey FOREIGN KEY (org_id, location_id)
    REFERENCES public.tracking_categories(org_id, id) ON DELETE RESTRICT;
CREATE INDEX idx_journal_entries_class ON public.journal_entries(org_id, class_id) WHERE class_id IS NOT NULL;
CREATE INDEX idx_journal_entries_location ON public.journal_entries(org_id, location_id) WHERE location_id IS NOT NULL;

-- The class or location the request names, or NULL; an unknown, inactive or
-- other organization's one is refused.
CREATE OR REPLACE FUNCTION private.request_tag(p_org_id UUID, p_kind TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_text TEXT;
  v_headers TEXT;
  v_id UUID;
BEGIN
  v_text := NULLIF(current_setting('ledger.' || lower(p_kind) || '_id', true), '');
  IF v_text IS NULL THEN
    v_headers := NULLIF(current_setting('request.headers', true), '');
    IF v_headers IS NOT NULL THEN
      v_text := NULLIF(v_headers::jsonb ->> ('x-ledger-' || lower(p_kind)), '');
    END IF;
  END IF;
  IF v_text IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'That % is not recognised.', lower(p_kind) USING ERRCODE = '22023';
  END IF;
  SELECT tag.id INTO v_id FROM public.tracking_categories AS tag
  WHERE tag.org_id = p_org_id AND tag.id = v_text::UUID AND tag.kind = p_kind AND tag.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That % is not an active one of this organization.', lower(p_kind) USING ERRCODE = '23503';
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.request_tag(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Every posting records the class and location it was made under. Otherwise
-- as in 20261004000100.
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
  v_closed_through DATE;
  v_class_id UUID;
  v_location_id UUID;
BEGIN
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'Entry date is required.' USING ERRCODE = '22023';
  END IF;
  -- The closing date: nothing is posted on or before it.
  SELECT org.books_closed_through INTO v_closed_through
  FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_closed_through IS NOT NULL AND p_entry_date <= v_closed_through THEN
    RAISE EXCEPTION 'The books are closed through %. Date this after the closing date, or ask an owner or administrator to move it.',
      pg_catalog.to_char(v_closed_through, 'DD/MM/YYYY') USING ERRCODE = '23514';
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

  -- The class and location the request names (x-ledger-class and
  -- x-ledger-location), each checked to be this organization's and active.
  -- A reversal with none named takes those of the entry it reverses.
  v_class_id := private.request_tag(p_org_id, 'CLASS');
  v_location_id := private.request_tag(p_org_id, 'LOCATION');
  IF v_class_id IS NULL AND v_location_id IS NULL AND upper(btrim(p_source_type)) = 'ADJUSTMENT' AND p_source_id IS NOT NULL THEN
    SELECT entry.class_id, entry.location_id INTO v_class_id, v_location_id
    FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id AND entry.source_id = p_source_id
      AND (entry.class_id IS NOT NULL OR entry.location_id IS NOT NULL)
    ORDER BY entry.posted_at
    LIMIT 1;
  END IF;

  INSERT INTO public.journal_entries (
    org_id, entry_date, memo, source_type, source_id, reference_no,
    created_by, idempotency_key, class_id, location_id
  ) VALUES (
    p_org_id, p_entry_date, NULLIF(btrim(p_memo), ''), upper(btrim(p_source_type)),
    p_source_id, NULLIF(btrim(p_reference_no), ''), p_created_by,
    NULLIF(btrim(p_idempotency_key), ''), v_class_id, v_location_id
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

-- Income, cost of sales and expense totals by class or location over a
-- period; entries with none are one group with no id.
CREATE OR REPLACE FUNCTION public.profit_and_loss_by_tag(p_org_id UUID, p_kind TEXT, p_from DATE, p_to DATE)
RETURNS TABLE (tag_id UUID, account_id UUID, debit_cents NUMERIC, credit_cents NUMERIC)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT CASE WHEN p_kind = 'CLASS' THEN entry.class_id ELSE entry.location_id END,
         line.account_id, sum(line.debit), sum(line.credit)
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
  WHERE line.org_id = p_org_id AND entry.entry_date BETWEEN p_from AND p_to
    AND account.type::TEXT IN ('INCOME', 'COGS', 'EXPENSE')
  GROUP BY 1, line.account_id;
$function$;

REVOKE ALL ON FUNCTION public.profit_and_loss_by_tag(UUID, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profit_and_loss_by_tag(UUID, TEXT, DATE, DATE) TO service_role;

-- Rollback: restore private.insert_journal_entry from 20261004000100; drop
-- public.profit_and_loss_by_tag, private.request_tag, the two columns on
-- public.journal_entries and public.tracking_categories.
