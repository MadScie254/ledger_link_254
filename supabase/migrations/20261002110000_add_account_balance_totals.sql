-- Account balances, the P&L, the balance sheet and the trial balance used to
-- read every journal line of a company into the Worker and add them up there.
-- That broke in two ways as a company grew:
--   * reads that did not page stopped silently at the API's row limit (1,000
--     rows by default), so balances, budgets "spent" and the reconciliation
--     summary under-counted without any error;
--   * reads that did page cost one Worker subrequest per thousand lines, so a
--     balance sheet failed outright once the ledger was large enough.
--
-- This returns one row per account instead: the summed debits and credits of
-- the company's posted lines, optionally limited to an entry-date range.
-- Callers add account names and types and apply the normal-balance direction.
--
-- Callable by the Worker's service role only. The Worker verifies the caller's
-- membership of p_org_id before calling, as it does for every query.

CREATE OR REPLACE FUNCTION public.account_balance_totals(
  p_org_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE (account_id UUID, debit_cents NUMERIC, credit_cents NUMERIC)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT line.account_id, sum(line.debit), sum(line.credit)
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.id = line.journal_entry_id
  WHERE entry.org_id = p_org_id
    AND (p_from IS NULL OR entry.entry_date >= p_from)
    AND (p_to IS NULL OR entry.entry_date <= p_to)
  GROUP BY line.account_id
  ORDER BY line.account_id;
$function$;

REVOKE ALL ON FUNCTION public.account_balance_totals(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_balance_totals(UUID, DATE, DATE)
  TO service_role;

-- The same totals split by calendar month (period is YYYY-MM), for the
-- dashboard's sales-and-spending trend.
CREATE OR REPLACE FUNCTION public.account_monthly_totals(
  p_org_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (period TEXT, account_id UUID, debit_cents NUMERIC, credit_cents NUMERIC)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.to_char(entry.entry_date, 'YYYY-MM'), line.account_id, sum(line.debit), sum(line.credit)
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.id = line.journal_entry_id
  WHERE entry.org_id = p_org_id
    AND entry.entry_date >= p_from
    AND entry.entry_date <= p_to
  GROUP BY 1, line.account_id
  ORDER BY 1, line.account_id;
$function$;

REVOKE ALL ON FUNCTION public.account_monthly_totals(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_monthly_totals(UUID, DATE, DATE)
  TO service_role;

-- Rollback:
-- DROP FUNCTION public.account_monthly_totals(UUID, DATE, DATE);
-- DROP FUNCTION public.account_balance_totals(UUID, DATE, DATE);
