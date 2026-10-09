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
-- A Mizani law firm with its own advocate, for the law edition flows.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000007', 'advocate@example.com') ON CONFLICT DO NOTHING;
INSERT INTO public.user_profiles (user_id, onboarding_status, onboarding_step)
VALUES ('00000000-0000-0000-0000-000000000007', 'SKIPPED', 0)
ON CONFLICT (user_id) DO UPDATE SET onboarding_status = 'SKIPPED';
SELECT public.create_organization('00000000-0000-0000-0000-000000000007',
  '{"name":"Wanjiru & Otieno Advocates (test)","edition":"law","taxId":"P051234567X","country":"Kenya"}',
  '[{"code":"1000","name":"Office bank","type":"ASSET","currency":"KES","isBankAccount":true},
    {"code":"1050","name":"M-Pesa","type":"ASSET","currency":"KES","isBankAccount":true},
    {"code":"1060","name":"Client account, bank","type":"ASSET","currency":"KES","isBankAccount":true},
    {"code":"1100","name":"Accounts receivable","type":"ASSET","currency":"KES"},
    {"code":"1170","name":"Withholding tax receivable","type":"ASSET","currency":"KES"},
    {"code":"1180","name":"Disbursements recoverable","type":"ASSET","currency":"KES"},
    {"code":"2000","name":"Accounts payable","type":"LIABILITY","currency":"KES"},
    {"code":"2100","name":"Output VAT","type":"LIABILITY","currency":"KES"},
    {"code":"2200","name":"Client money held","type":"LIABILITY","currency":"KES"},
    {"code":"3000","name":"Owner equity","type":"EQUITY","currency":"KES"},
    {"code":"4300","name":"Legal fees","type":"INCOME","currency":"KES"},
    {"code":"4310","name":"Conveyancing fees","type":"INCOME","currency":"KES"},
    {"code":"6000","name":"Operating expenses","type":"EXPENSE","currency":"KES"}]',
  'e2e-law-firm');
-- A Kundi church with its treasurer (owner) and a second counter
-- (accountant), and an M-Pesa link whose callback token the church flow
-- replays a confirmation to. The token is test-only.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000008', 'treasurer@example.com'),
  ('00000000-0000-0000-0000-000000000009', 'counter@example.com')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_profiles (user_id, onboarding_status, onboarding_step) VALUES
  ('00000000-0000-0000-0000-000000000008', 'SKIPPED', 0),
  ('00000000-0000-0000-0000-000000000009', 'SKIPPED', 0)
ON CONFLICT (user_id) DO UPDATE SET onboarding_status = 'SKIPPED';
SELECT public.create_organization('00000000-0000-0000-0000-000000000008',
  '{"name":"Kanisa la Majaribio (test)","edition":"church","country":"Kenya"}',
  '[{"code":"1000","name":"Church bank account","type":"ASSET","currency":"KES","isBankAccount":true},
    {"code":"1040","name":"Cash on hand, collections","type":"ASSET","currency":"KES","isBankAccount":true},
    {"code":"1050","name":"M-Pesa paybill","type":"ASSET","currency":"KES","isBankAccount":true},
    {"code":"2000","name":"Accounts payable","type":"LIABILITY","currency":"KES"},
    {"code":"3300","name":"General fund","type":"EQUITY","currency":"KES"},
    {"code":"4010","name":"Tithes","type":"INCOME","currency":"KES"},
    {"code":"4020","name":"Offerings","type":"INCOME","currency":"KES"},
    {"code":"4030","name":"Thanksgiving and special offerings","type":"INCOME","currency":"KES"},
    {"code":"4040","name":"Building and project giving","type":"INCOME","currency":"KES"},
    {"code":"4050","name":"Missions giving","type":"INCOME","currency":"KES"},
    {"code":"6310","name":"Ministry and department costs","type":"EXPENSE","currency":"KES"},
    {"code":"6400","name":"Bank and M-Pesa charges","type":"EXPENSE","currency":"KES"}]',
  'e2e-church');
INSERT INTO public.memberships (org_id, user_id, role)
SELECT id, '00000000-0000-0000-0000-000000000009', 'accountant' FROM public.organizations WHERE name = 'Kanisa la Majaribio (test)'
ON CONFLICT DO NOTHING;
UPDATE public.organizations SET integration_actor_id = '00000000-0000-0000-0000-000000000008'
WHERE name = 'Kanisa la Majaribio (test)';
INSERT INTO public.org_integrations (org_id, kind, shortcode, environment, callback_token_hash, status, registered_at)
SELECT id, 'MPESA_C2B', '600984', 'SANDBOX',
  encode(sha256(convert_to('e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0', 'UTF8')), 'hex'), 'REGISTERED', now()
FROM public.organizations WHERE name = 'Kanisa la Majaribio (test)';
