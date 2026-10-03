-- What the end-to-end flows need on top of tests/db/fixture.sql: sign-in
-- addresses the stub knows, a member, and the rest of the standard chart.
UPDATE auth.users SET email = 'owner@example.com' WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE auth.users SET email = 'member@example.com' WHERE id = '00000000-0000-0000-0000-000000000004';
INSERT INTO public.memberships (org_id, user_id, role)
VALUES ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000004', 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.accounts (org_id, code, name, type, is_bank_account) VALUES
  ('00000000-0000-0000-0000-0000000000aa', '1050', 'M-Pesa Till', 'ASSET', true),
  ('00000000-0000-0000-0000-0000000000aa', '1200', 'Inventory Asset', 'ASSET', false),
  ('00000000-0000-0000-0000-0000000000aa', '5000', 'Cost of Goods Sold', 'COGS', false),
  ('00000000-0000-0000-0000-0000000000aa', '6200', 'Rent and utilities', 'EXPENSE', false)
ON CONFLICT DO NOTHING;
-- No product tour or business-type question in the way.
INSERT INTO public.user_profiles (user_id, onboarding_status, onboarding_step) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SKIPPED', 0),
  ('00000000-0000-0000-0000-000000000004', 'SKIPPED', 0)
ON CONFLICT (user_id) DO UPDATE SET onboarding_status = 'SKIPPED';
UPDATE public.organizations SET business_type = 'general' WHERE id = '00000000-0000-0000-0000-0000000000aa';
