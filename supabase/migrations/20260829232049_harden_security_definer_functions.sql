-- Pin search_path on every function (prevents search_path hijacking) and add missing
-- authorization checks. Also lock down which roles may call these directly via RPC.

-- 1. user_has_org_access: pin search_path, wrap auth.uid() for the RLS initplan optimization,
--    restrict direct RPC execution to authenticated only.
CREATE OR REPLACE FUNCTION public.user_has_org_access(check_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = check_org_id
    AND user_id = (SELECT auth.uid())
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.user_has_org_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_org_access(uuid) TO authenticated;

-- 2. user_is_org_admin: same treatment.
CREATE OR REPLACE FUNCTION public.user_is_org_admin(check_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = check_org_id
    AND user_id = (SELECT auth.uid())
    AND role IN ('admin', 'owner')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.user_is_org_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_org_admin(uuid) TO authenticated;

-- 3. post_journal_entry: THE CRITICAL FIX. This function had no authorization check at all
--    and was directly executable by the anon (unauthenticated) role — anyone could post a
--    balanced journal entry to any organization's real ledger without logging in.
CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id uuid, p_entry_date date, p_memo text, p_source_type text,
  p_source_id uuid, p_reference_no text, p_created_by uuid, p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry_id UUID;
  v_line JSONB;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line_count INT := 0;
BEGIN
  -- 0. AUTHORIZATION CHECK (this was completely missing before).
  IF NOT public.user_has_org_access(p_org_id) THEN
    RAISE EXCEPTION 'Access denied: you are not a member of this organization.';
  END IF;

  IF p_created_by IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'p_created_by must match the authenticated caller.';
  END IF;

  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'A journal entry must have at least two lines.';
  END IF;

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

  IF v_total_debit != v_total_credit THEN
    RAISE EXCEPTION 'Journal entry unbalanced: Debits (%) do not equal Credits (%).', v_total_debit, v_total_credit;
  END IF;

  INSERT INTO public.journal_entries (
    org_id, entry_date, memo, source_type, source_id, reference_no, created_by
  ) VALUES (
    p_org_id, p_entry_date, p_memo, p_source_type, p_source_id, p_reference_no, p_created_by
  ) RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.journal_lines (
      journal_entry_id, account_id, debit, credit, description, entity_type, entity_id
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
$function$;

REVOKE EXECUTE ON FUNCTION public.post_journal_entry(uuid, date, text, text, uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(uuid, date, text, text, uuid, text, uuid, jsonb) TO authenticated;

-- 4. increment_and_get: pin search_path, make it SECURITY DEFINER (document_counters has RLS
--    with no policies, so as SECURITY INVOKER this function currently fails for every real
--    caller except service_role), and add the same org-membership check.
CREATE OR REPLACE FUNCTION public.increment_and_get(p_org_id text, p_doc_type text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_next_number INT;
    v_org_uuid UUID;
BEGIN
    v_org_uuid := p_org_id::UUID;
    IF NOT public.user_has_org_access(v_org_uuid) THEN
      RAISE EXCEPTION 'Access denied: you are not a member of this organization.';
    END IF;

    INSERT INTO document_counters (org_id, doc_type, next_number)
    VALUES (p_org_id, p_doc_type, 2)
    ON CONFLICT (org_id, doc_type)
    DO UPDATE SET next_number = document_counters.next_number + 1
    RETURNING next_number - 1 INTO v_next_number;

    RETURN v_next_number;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.increment_and_get(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_and_get(text, text) TO authenticated;

-- 5. set_updated_at: pin search_path (it's a trigger function, harmless, but the linter is right
--    that it should be pinned too).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 6. rls_auto_enable: this is an event-trigger function (fires automatically on CREATE TABLE).
--    It should never be callable directly via RPC by anyone.
--    Some fresh/local databases never had this live-project helper, so keep
--    the hardening migration replayable without inventing an event trigger.
DO $function$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$function$;
