-- The employee form has always asked for housing and transport allowances,
-- a national ID, an employment type and an M-Pesa number, but the employees
-- table had no columns for them and the API dropped them without a word.
-- Payroll then taxed base salary alone, so anyone with an allowance had PAYE,
-- SHIF and the Housing Levy under-deducted.
--
-- Cash allowances are part of taxable gross pay. Payroll now computes gross
-- as base salary plus these allowances (src/utils/kenyaPayroll.ts).
-- Existing employees get zero allowances, so their pay is unchanged until an
-- allowance is entered.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS housing_allowance_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_allowance_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS national_id TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_number TEXT;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_pay_components_nonnegative_check
  CHECK (
    COALESCE(base_salary, 0) >= 0
    AND housing_allowance_cents >= 0
    AND transport_allowance_cents >= 0
  );

COMMENT ON COLUMN public.employees.housing_allowance_cents IS
  'Monthly cash housing allowance in cents; part of taxable gross pay.';
COMMENT ON COLUMN public.employees.transport_allowance_cents IS
  'Monthly cash transport allowance in cents; part of taxable gross pay.';

-- Rollback:
-- ALTER TABLE public.employees DROP CONSTRAINT employees_pay_components_nonnegative_check;
-- ALTER TABLE public.employees
--   DROP COLUMN mpesa_number, DROP COLUMN employment_type, DROP COLUMN national_id,
--   DROP COLUMN transport_allowance_cents, DROP COLUMN housing_allowance_cents;
