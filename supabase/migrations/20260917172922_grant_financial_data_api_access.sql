-- Explicit Data API privileges
--
-- Supabase projects no longer implicitly grant table privileges to API roles
-- for newly created objects.  LedgerLink routes all business-data access
-- through its authenticated Worker, so the browser roles do not need direct
-- table access.  The Worker service role receives only data privileges; schema
-- ownership and DDL remain unavailable.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE
  public.organizations,
  public.memberships,
  public.accounts,
  public.journal_entries,
  public.journal_lines,
  public.customers,
  public.vendors,
  public.invoices,
  public.invoice_lines,
  public.invoice_payments,
  public.bills,
  public.bill_lines,
  public.bill_payments,
  public.bank_transactions,
  public.bank_rules,
  public.bank_connection_requests,
  public.employees,
  public.payroll_runs,
  public.payslips,
  public.inventory_items,
  public.projects,
  public.time_entries,
  public.budgets,
  public.etims_submissions,
  public.document_counters,
  public.audit_logs
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.organizations,
  public.memberships,
  public.accounts,
  public.journal_entries,
  public.journal_lines,
  public.customers,
  public.vendors,
  public.invoices,
  public.invoice_lines,
  public.invoice_payments,
  public.bills,
  public.bill_lines,
  public.bill_payments,
  public.bank_transactions,
  public.bank_rules,
  public.bank_connection_requests,
  public.employees,
  public.payroll_runs,
  public.payslips,
  public.inventory_items,
  public.projects,
  public.time_entries,
  public.budgets,
  public.etims_submissions,
  public.document_counters,
  public.audit_logs
TO service_role;

-- Authentication-backed RLS helpers and the deliberately exposed manual
-- journal RPC remain callable by signed-in users.  All document, payment and
-- payroll workflow RPCs are service-only and independently verify the actor.
GRANT EXECUTE ON FUNCTION public.user_has_org_access(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_org_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_invoice_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_bill_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.receive_invoice_payment(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pay_bill(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_invoice_with_reversal(UUID, UUID, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_bill_with_reversal(UUID, UUID, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_payroll_with_journal(
  UUID, TEXT, DATE, TEXT, UUID, TEXT, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_invoice_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bill_with_journal(
  UUID, UUID, DATE, DATE, TEXT, NUMERIC, TEXT, UUID, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.receive_invoice_payment(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_bill(
  UUID, UUID, BIGINT, DATE, UUID, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_invoice_with_reversal(UUID, UUID, DATE, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.void_bill_with_reversal(UUID, UUID, DATE, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.run_payroll_with_journal(
  UUID, TEXT, DATE, TEXT, UUID, TEXT, UUID, UUID, UUID, UUID, UUID, UUID, UUID, JSONB
) TO service_role;
