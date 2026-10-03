-- Fields the forms already collect.
--
-- The supplier form asks for VAT number, category, payment method, bank and
-- M-Pesa details and a default expense account; the stock item form for unit
-- of measure, barcode, VAT rate, preferred supplier, location, target stock
-- and notes; the employee form for a middle name; the account form for what
-- the account is for. The tables had no columns
-- for them and the API dropped them without a word. Supplier bank and M-Pesa
-- details are recorded by the vendors audit trigger whenever they change.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS vat_number TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_number TEXT,
  ADD COLUMN IF NOT EXISTS default_account_id UUID,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_org_default_account_fkey
    FOREIGN KEY (org_id, default_account_id) REFERENCES public.accounts(org_id, id) ON DELETE SET NULL (default_account_id);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS unit_of_measure TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS preferred_vendor_id UUID,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS target_stock INTEGER,
  ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_org_preferred_vendor_fkey
    FOREIGN KEY (org_id, preferred_vendor_id) REFERENCES public.vendors(org_id, id) ON DELETE SET NULL (preferred_vendor_id),
  ADD CONSTRAINT inventory_items_tax_rate_check CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  ADD CONSTRAINT inventory_items_levels_check CHECK (
    COALESCE(reorder_point, 0) >= 0 AND COALESCE(target_stock, 0) >= 0
    AND COALESCE(unit_price_cents, 0) >= 0 AND COALESCE(cost_price_cents, 0) >= 0
  ) NOT VALID;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS middle_name TEXT;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_description_length_check CHECK (description IS NULL OR char_length(description) <= 1000);

-- Rollback: drop the added columns and constraints.
