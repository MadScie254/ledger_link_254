-- Rate limits, narrower direct access, and balances from documents.
--
-- 1. Rate limits. Nothing limited how often anyone could call the paid AI
--    endpoints, send invitations or create organizations.
--    public.consume_rate_limit counts calls per key in fixed windows; the
--    Worker refuses a call once a key's limit for the window is reached.
-- 2. public.post_journal_entry was callable by signed-in users directly,
--    bypassing the Worker's request checks. Only the Worker calls it now.
-- 3. The row-level policies for employees, payroll runs and payslips matched
--    any member, while the Worker keeps payroll from the read-only member
--    role. Browser roles hold no table privileges, so the policies were
--    dormant; they now match the Worker in case grants are ever restored.
-- 4. public.increment_and_get, replaced by private.next_document_number in
--    September, is dropped.
-- 5. public.party_balances returns what each customer and supplier owes from
--    the open invoices and bills, instead of the stored running balances,
--    which could drift.

-- 1. Rate limits -------------------------------------------------------------

CREATE TABLE private.rate_limit_counters (
  bucket       TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_window TIMESTAMPTZ;
  v_hits INTEGER;
BEGIN
  IF p_bucket IS NULL OR length(p_bucket) > 200 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit.' USING ERRCODE = '22023';
  END IF;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO private.rate_limit_counters AS counter (bucket, window_start, hits)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = counter.hits + 1
  RETURNING hits INTO v_hits;
  -- Old windows are cleared now and then rather than on every call.
  IF random() < 0.01 THEN
    DELETE FROM private.rate_limit_counters WHERE window_start < now() - interval '40 days';
  END IF;
  RETURN v_hits <= p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- 2. Direct journal RPC ------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT)
  FROM authenticated;

-- 3. Payroll policies --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_has_payroll_access(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = check_org_id AND user_id = (SELECT auth.uid())
      AND role IN ('owner', 'admin', 'accountant')
  );
$function$;

REVOKE ALL ON FUNCTION public.user_has_payroll_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_payroll_access(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS employees_select_policy ON public.employees;
DROP POLICY IF EXISTS employees_insert_policy ON public.employees;
DROP POLICY IF EXISTS employees_update_policy ON public.employees;
DROP POLICY IF EXISTS employees_delete_policy ON public.employees;
CREATE POLICY employees_select_policy ON public.employees
  FOR SELECT USING ((SELECT public.user_has_payroll_access(org_id)));

DROP POLICY IF EXISTS payroll_runs_select_policy ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_insert_policy ON public.payroll_runs;
CREATE POLICY payroll_runs_select_policy ON public.payroll_runs
  FOR SELECT USING ((SELECT public.user_has_payroll_access(org_id)));

DROP POLICY IF EXISTS payslips_select_policy ON public.payslips;
DROP POLICY IF EXISTS payslips_insert_policy ON public.payslips;
CREATE POLICY payslips_select_policy ON public.payslips
  FOR SELECT USING ((SELECT public.user_has_payroll_access(org_id)));

-- 4. Obsolete counter RPC ----------------------------------------------------

DROP FUNCTION IF EXISTS public.increment_and_get(TEXT, TEXT);

-- 5. Balances from documents -------------------------------------------------

CREATE OR REPLACE FUNCTION public.party_balances(p_org_id UUID)
RETURNS TABLE (party_type TEXT, party_id UUID, open_cents BIGINT, overdue_cents BIGINT, open_documents INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT 'CUSTOMER', invoice.customer_id, sum(invoice.amount_due_cents)::BIGINT,
         COALESCE(sum(invoice.amount_due_cents) FILTER (WHERE invoice.due_date < CURRENT_DATE), 0)::BIGINT,
         count(*)::INTEGER
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.status NOT IN ('PAID', 'VOID') AND invoice.customer_id IS NOT NULL
  GROUP BY invoice.customer_id
  UNION ALL
  SELECT 'VENDOR', bill.vendor_id, sum(bill.amount_due_cents)::BIGINT,
         COALESCE(sum(bill.amount_due_cents) FILTER (WHERE bill.due_date < CURRENT_DATE), 0)::BIGINT,
         count(*)::INTEGER
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id AND bill.status NOT IN ('PAID', 'VOID') AND bill.vendor_id IS NOT NULL
  GROUP BY bill.vendor_id;
$function$;

REVOKE ALL ON FUNCTION public.party_balances(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_balances(UUID) TO service_role;

-- Rollback: drop public.party_balances, public.consume_rate_limit and
-- private.rate_limit_counters; grant post_journal_entry back to
-- authenticated; restore the policies from 003_rls_policies.sql and
-- 20260915160000_add_payroll_runs_table.sql.
