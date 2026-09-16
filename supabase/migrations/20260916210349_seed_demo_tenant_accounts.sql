-- The demo tenant backs the live balance sheet on the public landing page.
-- It had a row in `organizations` but zero accounts and zero journal entries,
-- so anything rendered from it would have been invented in the frontend.
-- This gives it a real chart of accounts for a Nairobi hardware retailer.
-- Amounts elsewhere are in cents, matching the rest of the ledger.

UPDATE public.organizations
SET name = 'Riverside Hardware Ltd',
    legal_name = 'Riverside Hardware Limited',
    industry = 'Retail - building materials',
    city = 'Nairobi',
    country = 'Kenya',
    base_currency = 'KES',
    is_demo = true
WHERE id = '146b2a09-11b0-47bd-a0ba-d9f27f1f12ec';

INSERT INTO public.accounts (org_id, code, name, type, subtype)
SELECT '146b2a09-11b0-47bd-a0ba-d9f27f1f12ec'::uuid, code, name, type::account_type, subtype
FROM (VALUES
  ('1000', 'Cash at Bank - KCB',  'ASSET',     'Current asset'),
  ('1010', 'M-Pesa Till',         'ASSET',     'Current asset'),
  ('1100', 'Accounts Receivable', 'ASSET',     'Current asset'),
  ('1200', 'Inventory',           'ASSET',     'Current asset'),
  ('1500', 'Equipment',           'ASSET',     'Non-current asset'),
  ('2000', 'Accounts Payable',    'LIABILITY', 'Current liability'),
  ('2100', 'VAT Payable',         'LIABILITY', 'Current liability'),
  ('2200', 'PAYE Payable',        'LIABILITY', 'Current liability'),
  ('2210', 'NSSF Payable',        'LIABILITY', 'Current liability'),
  ('2220', 'SHIF Payable',        'LIABILITY', 'Current liability'),
  ('3000', 'Share Capital',       'EQUITY',    'Contributed capital'),
  ('4000', 'Sales Revenue',       'INCOME',    'Operating income'),
  ('5000', 'Cost of Goods Sold',  'COGS',      'Direct costs'),
  ('6000', 'Salaries and Wages',  'EXPENSE',   'Operating expense'),
  ('6100', 'Rent',                'EXPENSE',   'Operating expense'),
  ('6200', 'Utilities',           'EXPENSE',   'Operating expense')
) AS seed(code, name, type, subtype)
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts
  WHERE org_id = '146b2a09-11b0-47bd-a0ba-d9f27f1f12ec'::uuid
);
