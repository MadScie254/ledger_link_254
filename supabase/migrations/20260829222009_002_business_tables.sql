-- ============================================================
-- LedgerLink Migration 002: Business Entity Tables
-- ============================================================

-- ─── customers ─────────────────────────────────────────────────────────────
CREATE TABLE public.customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name     TEXT NOT NULL,
  legal_name       TEXT,
  customer_type    TEXT DEFAULT 'Corporate',
  contact_person   TEXT,
  email            TEXT,
  phone            TEXT,
  kra_pin          TEXT,
  payment_terms    TEXT DEFAULT 'Net 30',
  credit_limit_cents BIGINT DEFAULT 0,
  currency         TEXT DEFAULT 'KES',
  discount_percent NUMERIC(5,2) DEFAULT 0,
  price_tier       TEXT DEFAULT 'Standard',
  billing_address  TEXT,
  shipping_address TEXT,
  city             TEXT,
  postal_code      TEXT,
  country          TEXT DEFAULT 'Kenya',
  notes            TEXT,
  balance          BIGINT DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── vendors ───────────────────────────────────────────────────────────────
CREATE TABLE public.vendors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name     TEXT NOT NULL,
  legal_name       TEXT,
  vendor_type      TEXT DEFAULT 'Supplier',
  contact_person   TEXT,
  email            TEXT,
  phone            TEXT,
  kra_pin          TEXT,
  payment_terms    TEXT DEFAULT 'Net 30',
  currency         TEXT DEFAULT 'KES',
  billing_address  TEXT,
  city             TEXT,
  postal_code      TEXT,
  country          TEXT DEFAULT 'Kenya',
  notes            TEXT,
  balance          BIGINT DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── invoices ──────────────────────────────────────────────────────────────
CREATE TABLE public.invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_number   TEXT NOT NULL,
  customer_id      UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  date             DATE NOT NULL,
  due_date         DATE,
  subtotal_cents   BIGINT NOT NULL DEFAULT 0,
  tax_cents        BIGINT NOT NULL DEFAULT 0,
  total_cents      BIGINT NOT NULL DEFAULT 0,
  amount_due_cents BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'DRAFT',
  currency         TEXT NOT NULL DEFAULT 'KES',
  notes            TEXT,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── bills ─────────────────────────────────────────────────────────────────
CREATE TABLE public.bills (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bill_number      TEXT,
  vendor_id        UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
  date             DATE NOT NULL,
  due_date         DATE,
  subtotal_cents   BIGINT NOT NULL DEFAULT 0,
  tax_cents        BIGINT NOT NULL DEFAULT 0,
  total_cents      BIGINT NOT NULL DEFAULT 0,
  amount_due_cents BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'DRAFT',
  currency         TEXT NOT NULL DEFAULT 'KES',
  notes            TEXT,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── bank_transactions ─────────────────────────────────────────────────────
CREATE TABLE public.bank_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  description      TEXT NOT NULL,
  amount_cents     BIGINT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  status           TEXT NOT NULL DEFAULT 'UNREVIEWED',
  ai_category_code TEXT,
  ai_category_name TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── employees ─────────────────────────────────────────────────────────────
CREATE TABLE public.employees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  department       TEXT,
  job_title        TEXT,
  hire_date        DATE,
  base_salary      BIGINT DEFAULT 0,
  currency         TEXT DEFAULT 'KES',
  pay_frequency    TEXT DEFAULT 'Monthly',
  kra_pin          TEXT,
  nssf_number      TEXT,
  nhif_number      TEXT,
  bank_name        TEXT,
  bank_account     TEXT,
  status           TEXT DEFAULT 'Active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── inventory_items ───────────────────────────────────────────────────────
CREATE TABLE public.inventory_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sku              TEXT,
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT,
  type             TEXT DEFAULT 'Inventory',
  quantity_on_hand INT DEFAULT 0,
  reorder_point    INT DEFAULT 0,
  unit_price_cents BIGINT DEFAULT 0,
  cost_price_cents BIGINT DEFAULT 0,
  income_account_id UUID REFERENCES public.accounts(id),
  cogs_account_id   UUID REFERENCES public.accounts(id),
  asset_account_id  UUID REFERENCES public.accounts(id),
  status           TEXT DEFAULT 'Active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── projects ──────────────────────────────────────────────────────────────
CREATE TABLE public.projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_code     TEXT,
  name             TEXT NOT NULL,
  customer_id      UUID REFERENCES public.customers(id),
  status           TEXT DEFAULT 'Planned',
  start_date       DATE,
  end_date         DATE,
  budget_cents     BIGINT DEFAULT 0,
  cost_cents       BIGINT DEFAULT 0,
  revenue_cents    BIGINT DEFAULT 0,
  manager_id       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── audit_logs ────────────────────────────────────────────────────────────
CREATE TABLE public.audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,
  resource_type    TEXT NOT NULL,
  resource_id      UUID NOT NULL,
  details          JSONB,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_customers_org_id ON public.customers(org_id);
CREATE INDEX idx_vendors_org_id ON public.vendors(org_id);
CREATE INDEX idx_invoices_org_id ON public.invoices(org_id);
CREATE INDEX idx_bills_org_id ON public.bills(org_id);
CREATE INDEX idx_bank_transactions_org_id ON public.bank_transactions(org_id);
CREATE INDEX idx_employees_org_id ON public.employees(org_id);
CREATE INDEX idx_inventory_items_org_id ON public.inventory_items(org_id);
CREATE INDEX idx_projects_org_id ON public.projects(org_id);
CREATE INDEX idx_audit_logs_org_id ON public.audit_logs(org_id);
