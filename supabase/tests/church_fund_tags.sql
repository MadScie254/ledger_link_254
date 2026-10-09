-- Run after the full migration stack and tests/db/fixture.sql. The
-- transaction leaves the fixture unchanged.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_org UUID;
  v_building UUID;
  v_general UUID;
  v_bank UUID;
  v_vendor UUID;
  v_expense JSONB;
  v_business JSONB;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Kanisa fund tags","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"1040","name":"Cash on hand, collections","type":"ASSET","isBankAccount":true},
      {"code":"1050","name":"M-Pesa","type":"ASSET","isBankAccount":true},
      {"code":"2000","name":"Accounts payable","type":"LIABILITY"},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving and special offerings","type":"INCOME"},
      {"code":"4040","name":"Building and project giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"},
      {"code":"6310","name":"Ministry and department costs","type":"EXPENSE"},
      {"code":"6400","name":"Bank and M-Pesa charges","type":"EXPENSE"}]', 'church-fund-tags-test');
  SELECT id INTO v_building FROM public.funds WHERE org_id = v_org AND code = 'BUILDING';
  SELECT id INTO v_general FROM public.funds WHERE org_id = v_org AND code = 'GENERAL';
  SELECT id INTO v_bank FROM public.accounts WHERE org_id = v_org AND code = '1000';
  INSERT INTO public.vendors (org_id, display_name) VALUES (v_org, 'Mfano Hardware') RETURNING id INTO v_vendor;

  -- An expense naming a supplier, sent with the building fund as the Bills
  -- and expenses screen sends it: the expense line is the fund's.
  PERFORM set_config('request.headers', jsonb_build_object('x-ledger-fund', v_building)::TEXT, true);
  v_expense := public.record_expense(v_org, v_vendor, NULL, DATE '2026-10-06', v_bank, 'INV-55', NULL,
    jsonb_build_array(jsonb_build_object('description', 'Roofing nails', 'accountId',
      (SELECT id FROM public.accounts WHERE org_id = v_org AND code = '6310'), 'amountCents', 250000)), v_owner, 'fund-tag-expense');
  PERFORM set_config('request.headers', '', true);
  IF (SELECT line.entity_type || ':' || line.entity_id FROM public.journal_lines AS line
      JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.org_id = v_org AND account.code = '6310') <> 'FUND:' || v_building THEN
    RAISE EXCEPTION 'An expense naming a supplier was not tagged to the fund it was sent with.';
  END IF;
  -- The supplier stays on the expense record.
  IF (SELECT vendor_id FROM public.cash_transactions WHERE id = (v_expense->>'id')::UUID) <> v_vendor THEN
    RAISE EXCEPTION 'The expense lost its supplier.';
  END IF;

  -- Voided, the reversal stays with the fund.
  PERFORM public.void_cash_transaction(v_org, (v_expense->>'id')::UUID, DATE '2026-10-07', 'Returned the nails', v_owner);
  IF (SELECT count(*) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.org_id = v_org AND account.code = '6310' AND line.entity_type = 'FUND' AND line.entity_id = v_building) <> 2 THEN
    RAISE EXCEPTION 'The expense and its reversal are not both on the building fund.';
  END IF;
  IF (SELECT expense_cents FROM public.fund_balances(v_org, DATE '2026-10-01', DATE '2026-10-31') WHERE code = 'BUILDING') <> 0 THEN
    RAISE EXCEPTION 'A voided expense still counts against the building fund.';
  END IF;

  -- With no fund named, a supplier's expense is the general fund's.
  v_expense := public.record_expense(v_org, v_vendor, NULL, DATE '2026-10-08', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Brooms', 'accountId',
      (SELECT id FROM public.accounts WHERE org_id = v_org AND code = '6310'), 'amountCents', 50000)), v_owner, 'fund-tag-general');
  IF (SELECT expense_cents FROM public.fund_balances(v_org, DATE '2026-10-01', DATE '2026-10-31') WHERE code = 'GENERAL') <> 50000 THEN
    RAISE EXCEPTION 'An untagged supplier expense is not on the general fund.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.org_id = v_org AND account.type IN ('INCOME', 'EXPENSE', 'COGS') AND line.entity_type IS DISTINCT FROM 'FUND') THEN
    RAISE EXCEPTION 'A church income or expense line is not tagged to a fund.';
  END IF;

  -- Outside churches nothing changes: the supplier stays on the line.
  v_business := public.record_expense('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000d1', NULL,
    DATE '2026-10-06', '00000000-0000-0000-0000-00000000a000', NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Stationery', 'accountId', '00000000-0000-0000-0000-00000000a600',
      'amountCents', 10000)), '00000000-0000-0000-0000-000000000001', 'business-vendor-expense');
  IF (SELECT entity_type FROM public.journal_lines WHERE journal_entry_id = (v_business->>'journalEntryId')::UUID
      AND account_id = '00000000-0000-0000-0000-00000000a600') <> 'VENDOR' THEN
    RAISE EXCEPTION 'A business expense lost its supplier tag.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'ALL CHURCH FUND TAG SQL TESTS PASSED';
