\c lltest
\set ON_ERROR_STOP 1
-- A church's public giving page (20261024000900): one link made by an owner
-- or admin, the paybill once registered, an account number per fund from
-- the giving rules, open campaigns with what has been given, no member.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_business UUID := '00000000-0000-0000-0000-0000000000aa';
  v_token TEXT := repeat('ab', 32);
  v_org UUID;
  v_building UUID;
  v_general UUID;
  v_member UUID;
  v_link JSONB;
  v_page JSONB;
  v_failed BOOLEAN;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Giving page test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving","type":"INCOME"},
      {"code":"4040","name":"Building giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"}]', 'giving-page-test');
  SELECT id INTO v_building FROM public.funds WHERE org_id = v_org AND code = 'BUILDING';
  SELECT id INTO v_general FROM public.funds WHERE org_id = v_org AND code = 'GENERAL';
  INSERT INTO public.members (org_id, member_number, first_name) VALUES (v_org, 'MEM-1', 'Miriam') RETURNING id INTO v_member;
  -- A church starts with giving rules: TITHE to General, BLD to Building,
  -- MSN to Missions, and member numbers to General. A second member-number
  -- rule tried later adds no second way.
  INSERT INTO public.giving_rules (org_id, priority, match_type, pattern, fund_id) VALUES (v_org, 500, 'MEMBER_NUMBER', NULL, v_building);
  INSERT INTO public.church_campaigns (org_id, fund_id, name, goal_cents, starts_on, ends_on, created_by)
    VALUES (v_org, v_building, 'Roof repairs', 5000000, DATE '2026-01-01', DATE '2026-12-31', v_owner);
  PERFORM public.record_contribution(v_org, v_member, v_building, NULL, 25000, 'BANK', DATE '2026-03-01', NULL, 'page-gift-1', v_owner);

  -- A business has no giving page.
  v_failed := false;
  BEGIN PERFORM public.share_giving_page(v_business, v_token, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  ASSERT v_failed, 'only a church shares a giving page';

  v_link := public.share_giving_page(v_org, v_token, v_owner);
  ASSERT v_link->>'token' = v_token AND (v_link->>'created')::BOOLEAN, 'link made';
  ASSERT public.share_giving_page(v_org, repeat('cd', 32), v_owner)->>'token' = v_token, 'the same link is copied again';

  v_page := public.open_giving_page(v_token);
  ASSERT v_page->>'church' = 'Giving page test', 'church named';
  ASSERT v_page->>'paybill' IS NULL, 'no paybill before the C2B link is registered';
  ASSERT jsonb_array_length(v_page->'ways') = 4, 'one way per account number, and one for member numbers';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_page->'ways') AS way WHERE way->>'accountNumber' = 'BLD' AND way->>'fundCode' = 'BUILDING'),
    'the building fund account number';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(v_page->'ways') AS way WHERE way->>'kind' = 'MEMBER_NUMBER' AND way->>'fundCode' = 'GENERAL') = 1,
    'member numbers give to the fund of the rule tried first';
  ASSERT (v_page->'campaigns'->0->>'givenCents')::BIGINT = 25000 AND v_page->'campaigns'->0->>'accountNumber' = 'BLD', 'campaign progress';
  ASSERT v_page::TEXT NOT LIKE '%Miriam%' AND v_page::TEXT NOT LIKE '%MEM-1%', 'no member is named';

  INSERT INTO public.org_integrations (org_id, kind, shortcode, environment, status, callback_token_hash, created_by)
  VALUES (v_org, 'MPESA_C2B', '247247', 'SANDBOX', 'REGISTERED', repeat('0', 64), v_owner);
  ASSERT public.open_giving_page(v_token)->>'paybill' = '247247', 'paybill once registered';
  ASSERT (SELECT views FROM public.church_giving_links WHERE org_id = v_org) = 2, 'views counted';

  ASSERT public.withdraw_giving_page(v_org, v_owner), 'withdrawn';
  ASSERT public.open_giving_page(v_token) IS NULL, 'a withdrawn link opens nothing';
  ASSERT NOT has_table_privilege('authenticated', 'public.church_giving_links', 'SELECT'), 'service role only';

  RAISE NOTICE 'church giving page passed';
END $test$;
ROLLBACK;
SELECT 'church giving page passed';
