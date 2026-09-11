-- ============================================================
-- LedgerLink Migration 004: post_journal_entry Function
-- ============================================================

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id UUID,
  p_entry_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_reference_no TEXT,
  p_created_by UUID,
  p_lines JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry_id UUID;
  v_line JSONB;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line_count INT := 0;
BEGIN
  -- 1. Validate lines exist and minimum length
  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'A journal entry must have at least two lines.';
  END IF;

  -- 2. Validate line amounts
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Debits and credits must be non-negative.';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'A single line cannot have both a debit and a credit.';
    END IF;

    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'A line must have either a debit or a credit.';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  -- 3. Strict equality check for double-entry accounting
  IF v_total_debit != v_total_credit THEN
    RAISE EXCEPTION 'Journal entry unbalanced: Debits (%) do not equal Credits (%).', v_total_debit, v_total_credit;
  END IF;

  -- 4. Post to Database
  INSERT INTO public.journal_entries (
    org_id, entry_date, memo, source_type, source_id, reference_no, created_by
  ) VALUES (
    p_org_id, p_entry_date, p_memo, p_source_type, p_source_id, p_reference_no, p_created_by
  ) RETURNING id INTO v_entry_id;

  -- 5. Insert Lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.journal_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description,
      entity_type,
      entity_id
    ) VALUES (
      v_entry_id,
      (v_line->>'accountId')::UUID,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',
      v_line->>'entityType',
      NULLIF(v_line->>'entityId', '')::UUID
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;
