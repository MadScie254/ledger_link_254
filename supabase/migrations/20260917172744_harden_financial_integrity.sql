-- Financial integrity hardening
--
-- Adds the relational structure needed for atomic invoice, bill, payment,
-- payroll and multi-currency workflows. Application writes still go through
-- the RPCs created in the following migration; these constraints are the
-- database-level backstop that prevents cross-organization links.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- -------------------------------------------------------------------------
-- Currency and idempotency metadata
-- -------------------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE public.accounts AS account
SET currency = CASE account.code
  WHEN '1010' THEN 'USD'
  WHEN '1020' THEN 'EUR'
  ELSE upper(COALESCE(org.base_currency, 'KES'))
END
FROM public.organizations AS org
WHERE org.id = account.org_id
  AND account.currency IS NULL;

ALTER TABLE public.accounts
  ALTER COLUMN currency SET DEFAULT 'KES',
  ALTER COLUMN currency SET NOT NULL;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS org_id UUID,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS foreign_debit BIGINT,
  ADD COLUMN IF NOT EXISTS foreign_credit BIGINT,
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(20, 8);

UPDATE public.journal_lines AS line
SET org_id = entry.org_id
FROM public.journal_entries AS entry
WHERE entry.id = line.journal_entry_id
  AND line.org_id IS NULL;

ALTER TABLE public.journal_lines
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(20, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS foreign_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE public.invoices
SET foreign_amount_cents = total_cents
WHERE foreign_amount_cents IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN foreign_amount_cents SET NOT NULL;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(20, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS foreign_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE public.bills
SET foreign_amount_cents = total_cents
WHERE foreign_amount_cents IS NULL;

ALTER TABLE public.bills
  ALTER COLUMN foreign_amount_cents SET NOT NULL;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS matched_journal_entry_id UUID;

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS rate_version TEXT,
  ADD COLUMN IF NOT EXISTS total_employer_nssf_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_employer_ahl_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE public.payroll_runs
SET rate_version = 'legacy-unversioned'
WHERE rate_version IS NULL;

ALTER TABLE public.payroll_runs
  ALTER COLUMN rate_version SET NOT NULL;

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS org_id UUID,
  ADD COLUMN IF NOT EXISTS taxable_pay_cents BIGINT,
  ADD COLUMN IF NOT EXISTS employer_nssf_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_ahl_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_version TEXT;

UPDATE public.payslips AS payslip
SET org_id = run.org_id,
    taxable_pay_cents = COALESCE(payslip.taxable_pay_cents, payslip.gross_cents),
    rate_version = COALESCE(payslip.rate_version, run.rate_version, 'legacy-unversioned')
FROM public.payroll_runs AS run
WHERE run.id = payslip.payroll_run_id
  AND (payslip.org_id IS NULL OR payslip.taxable_pay_cents IS NULL OR payslip.rate_version IS NULL);

ALTER TABLE public.payslips
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN taxable_pay_cents SET NOT NULL,
  ALTER COLUMN rate_version SET NOT NULL;

-- -------------------------------------------------------------------------
-- Persisted document lines and payments
-- -------------------------------------------------------------------------

CREATE TABLE public.invoice_lines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL,
  invoice_id           UUID NOT NULL,
  description          TEXT NOT NULL,
  account_id           UUID NOT NULL,
  amount_cents         BIGINT NOT NULL CHECK (amount_cents >= 0),
  tax_cents            BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  foreign_amount_cents BIGINT NOT NULL CHECK (foreign_amount_cents >= 0),
  foreign_tax_cents    BIGINT NOT NULL DEFAULT 0 CHECK (foreign_tax_cents >= 0),
  line_position        INTEGER NOT NULL DEFAULT 1 CHECK (line_position > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_position)
);

CREATE TABLE public.bill_lines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL,
  bill_id              UUID NOT NULL,
  description          TEXT NOT NULL,
  account_id           UUID NOT NULL,
  amount_cents         BIGINT NOT NULL CHECK (amount_cents >= 0),
  tax_cents            BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  foreign_amount_cents BIGINT NOT NULL CHECK (foreign_amount_cents >= 0),
  foreign_tax_cents    BIGINT NOT NULL DEFAULT 0 CHECK (foreign_tax_cents >= 0),
  line_position        INTEGER NOT NULL DEFAULT 1 CHECK (line_position > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bill_id, line_position)
);

CREATE TABLE public.invoice_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  invoice_id         UUID NOT NULL,
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  foreign_amount_cents BIGINT NOT NULL CHECK (foreign_amount_cents > 0),
  exchange_rate      NUMERIC(20, 8) NOT NULL CHECK (exchange_rate > 0),
  payment_date       DATE NOT NULL,
  account_id         UUID NOT NULL,
  journal_entry_id   UUID NOT NULL,
  idempotency_key    TEXT NOT NULL,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);

CREATE TABLE public.bill_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  bill_id            UUID NOT NULL,
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  foreign_amount_cents BIGINT NOT NULL CHECK (foreign_amount_cents > 0),
  exchange_rate      NUMERIC(20, 8) NOT NULL CHECK (exchange_rate > 0),
  payment_date       DATE NOT NULL,
  account_id         UUID NOT NULL,
  journal_entry_id   UUID NOT NULL,
  idempotency_key    TEXT NOT NULL,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);

-- -------------------------------------------------------------------------
-- Checks and uniqueness
-- -------------------------------------------------------------------------

-- Overdue is derived from due_date; normalize legacy display-only values
-- before enforcing the lifecycle state machine.
UPDATE public.invoices SET status = 'SENT' WHERE status = 'OVERDUE';
UPDATE public.invoices SET status = 'PARTIALLY_PAID' WHERE status = 'PARTIAL';
UPDATE public.bills SET status = 'OPEN' WHERE status = 'OVERDUE';
UPDATE public.bills SET status = 'PARTIALLY_PAID' WHERE status = 'PARTIAL';

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_currency_format_check CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT invoices_exchange_rate_positive_check CHECK (exchange_rate > 0),
  ADD CONSTRAINT invoices_amounts_nonnegative_check CHECK (
    subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
    AND amount_due_cents >= 0 AND amount_due_cents <= total_cents
    AND foreign_amount_cents >= 0
  ),
  ADD CONSTRAINT invoices_status_check CHECK (status IN ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID'));

ALTER TABLE public.bills
  ADD CONSTRAINT bills_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT bills_exchange_rate_positive_check CHECK (exchange_rate > 0),
  ADD CONSTRAINT bills_amounts_nonnegative_check CHECK (
    subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
    AND amount_due_cents >= 0 AND amount_due_cents <= total_cents
    AND foreign_amount_cents >= 0
  ),
  ADD CONSTRAINT bills_status_check CHECK (status IN ('DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID'));

ALTER TABLE public.journal_lines
  ADD CONSTRAINT journal_lines_foreign_amounts_check CHECK (
    (currency IS NULL AND foreign_debit IS NULL AND foreign_credit IS NULL AND exchange_rate IS NULL)
    OR
    (currency ~ '^[A-Z]{3}$' AND COALESCE(foreign_debit, 0) >= 0
      AND COALESCE(foreign_credit, 0) >= 0 AND exchange_rate > 0
      AND NOT (COALESCE(foreign_debit, 0) > 0 AND COALESCE(foreign_credit, 0) > 0))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_org_idempotency
  ON public.journal_entries(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_number
  ON public.invoices(org_id, invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_idempotency
  ON public.invoices(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_org_number
  ON public.bills(org_id, bill_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_org_idempotency
  ON public.bills(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_org_idempotency
  ON public.payroll_runs(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Composite candidate keys allow foreign keys to include org_id and make a
-- cross-tenant relationship structurally impossible.
ALTER TABLE public.accounts ADD CONSTRAINT accounts_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.customers ADD CONSTRAINT customers_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.vendors ADD CONSTRAINT vendors_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.bills ADD CONSTRAINT bills_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.employees ADD CONSTRAINT employees_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.payroll_runs ADD CONSTRAINT payroll_runs_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.projects ADD CONSTRAINT projects_org_id_id_key UNIQUE (org_id, id);

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_parent_id_fkey,
  ADD CONSTRAINT accounts_org_parent_fkey
    FOREIGN KEY (org_id, parent_id)
    REFERENCES public.accounts(org_id, id) ON DELETE SET NULL (parent_id);

-- Replace single-column relationships on critical tenant data with composite
-- relationships. Existing inconsistent data makes this migration fail loudly
-- rather than silently preserving a cross-organization link.
ALTER TABLE public.journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_journal_entry_id_fkey,
  DROP CONSTRAINT IF EXISTS journal_lines_account_id_fkey,
  ADD CONSTRAINT journal_lines_org_entry_fkey
    FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT journal_lines_org_account_fkey
    FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_customer_id_fkey,
  ADD CONSTRAINT invoices_org_customer_fkey
    FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_vendor_id_fkey,
  ADD CONSTRAINT bills_org_vendor_fkey
    FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.vendors(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_journal_entry_id_fkey,
  ADD CONSTRAINT payroll_runs_org_journal_fkey
    FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.payslips
  DROP CONSTRAINT IF EXISTS payslips_payroll_run_id_fkey,
  DROP CONSTRAINT IF EXISTS payslips_employee_id_fkey,
  ADD CONSTRAINT payslips_org_run_fkey
    FOREIGN KEY (org_id, payroll_run_id)
    REFERENCES public.payroll_runs(org_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT payslips_org_employee_fkey
    FOREIGN KEY (org_id, employee_id)
    REFERENCES public.employees(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_org_journal_fkey
    FOREIGN KEY (org_id, matched_journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_org_invoice_fkey
    FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT invoice_lines_org_account_fkey
    FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.bill_lines
  ADD CONSTRAINT bill_lines_org_bill_fkey
    FOREIGN KEY (org_id, bill_id)
    REFERENCES public.bills(org_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT bill_lines_org_account_fkey
    FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_org_invoice_fkey
    FOREIGN KEY (org_id, invoice_id)
    REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT invoice_payments_org_account_fkey
    FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT invoice_payments_org_journal_fkey
    FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.bill_payments
  ADD CONSTRAINT bill_payments_org_bill_fkey
    FOREIGN KEY (org_id, bill_id)
    REFERENCES public.bills(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT bill_payments_org_account_fkey
    FOREIGN KEY (org_id, account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT bill_payments_org_journal_fkey
    FOREIGN KEY (org_id, journal_entry_id)
    REFERENCES public.journal_entries(org_id, id) ON DELETE RESTRICT;

-- Additional tenant-bound references that can otherwise accept another
-- organization's UUID when the service role performs a write.
ALTER TABLE public.bank_rules
  DROP CONSTRAINT IF EXISTS bank_rules_target_account_id_fkey,
  ADD CONSTRAINT bank_rules_org_account_fkey
    FOREIGN KEY (org_id, target_account_id)
    REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_org_id_id_key UNIQUE (org_id, id),
  DROP CONSTRAINT IF EXISTS inventory_items_income_account_id_fkey,
  DROP CONSTRAINT IF EXISTS inventory_items_cogs_account_id_fkey,
  DROP CONSTRAINT IF EXISTS inventory_items_asset_account_id_fkey,
  ADD CONSTRAINT inventory_items_org_income_account_fkey
    FOREIGN KEY (org_id, income_account_id) REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_items_org_cogs_account_fkey
    FOREIGN KEY (org_id, cogs_account_id) REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_items_org_asset_account_fkey
    FOREIGN KEY (org_id, asset_account_id) REFERENCES public.accounts(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_customer_id_fkey,
  ADD CONSTRAINT projects_org_customer_fkey
    FOREIGN KEY (org_id, customer_id) REFERENCES public.customers(org_id, id) ON DELETE RESTRICT;

ALTER TABLE public.budgets
  DROP CONSTRAINT IF EXISTS budgets_account_id_fkey,
  ADD CONSTRAINT budgets_org_account_fkey
    FOREIGN KEY (org_id, account_id) REFERENCES public.accounts(org_id, id) ON DELETE CASCADE;

ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_project_id_fkey,
  ADD CONSTRAINT time_entries_org_project_fkey
    FOREIGN KEY (org_id, project_id) REFERENCES public.projects(org_id, id) ON DELETE CASCADE;

ALTER TABLE public.etims_submissions
  DROP CONSTRAINT IF EXISTS etims_submissions_invoice_id_fkey,
  ADD CONSTRAINT etims_submissions_org_invoice_fkey
    FOREIGN KEY (org_id, invoice_id) REFERENCES public.invoices(org_id, id) ON DELETE CASCADE;

-- -------------------------------------------------------------------------
-- Indexes, RLS and balance backfill
-- -------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_journal_entries_org_date
  ON public.journal_entries(org_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_org_account
  ON public.journal_lines(org_id, account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_org_invoice
  ON public.invoice_lines(org_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_bill_lines_org_bill
  ON public.bill_lines(org_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_org_invoice
  ON public.invoice_payments(org_id, invoice_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_bill_payments_org_bill
  ON public.bill_payments(org_id, bill_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status_due
  ON public.invoices(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_bills_org_status_due
  ON public.bills(org_id, status, due_date);

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_lines_select_policy ON public.invoice_lines
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY bill_lines_select_policy ON public.bill_lines
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY invoice_payments_select_policy ON public.invoice_payments
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY bill_payments_select_policy ON public.bill_payments
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_org_access(org_id)));

-- These are written only by the atomic SECURITY DEFINER workflows.
-- No INSERT/UPDATE/DELETE policies are intentionally created.

-- Statutory accounts are distinct: VAT, PAYE, NSSF, SHIF and AHL cannot share
-- one liability without destroying the filing reconciliation trail.
INSERT INTO public.accounts (org_id, code, name, type, subtype, currency)
SELECT org.id, seed.code, seed.name, seed.type::public.account_type, seed.subtype, upper(org.base_currency)
FROM public.organizations AS org
CROSS JOIN (VALUES
  ('1150', 'Recoverable VAT / Input Tax', 'ASSET', 'CURRENT_ASSET'),
  ('2110', 'PAYE Payable', 'LIABILITY', 'CURRENT_LIABILITY'),
  ('2120', 'NSSF Payable', 'LIABILITY', 'CURRENT_LIABILITY'),
  ('2130', 'SHIF Payable', 'LIABILITY', 'CURRENT_LIABILITY'),
  ('2140', 'Affordable Housing Levy Payable', 'LIABILITY', 'CURRENT_LIABILITY'),
  ('6110', 'Employer Payroll Contributions', 'EXPENSE', 'PAYROLL')
) AS seed(code, name, type, subtype)
ON CONFLICT (org_id, code) DO NOTHING;

UPDATE public.customers AS customer
SET balance = totals.amount_due
FROM (
  SELECT org_id, customer_id, COALESCE(sum(amount_due_cents), 0)::BIGINT AS amount_due
  FROM public.invoices
  WHERE customer_id IS NOT NULL AND status NOT IN ('PAID', 'VOID')
  GROUP BY org_id, customer_id
) AS totals
WHERE customer.org_id = totals.org_id AND customer.id = totals.customer_id;

UPDATE public.customers AS customer
SET balance = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoices AS invoice
  WHERE invoice.org_id = customer.org_id AND invoice.customer_id = customer.id
    AND invoice.status NOT IN ('PAID', 'VOID')
);

UPDATE public.vendors AS vendor
SET balance = totals.amount_due
FROM (
  SELECT org_id, vendor_id, COALESCE(sum(amount_due_cents), 0)::BIGINT AS amount_due
  FROM public.bills
  WHERE vendor_id IS NOT NULL AND status NOT IN ('PAID', 'VOID')
  GROUP BY org_id, vendor_id
) AS totals
WHERE vendor.org_id = totals.org_id AND vendor.id = totals.vendor_id;

UPDATE public.vendors AS vendor
SET balance = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.bills AS bill
  WHERE bill.org_id = vendor.org_id AND bill.vendor_id = vendor.id
    AND bill.status NOT IN ('PAID', 'VOID')
);
