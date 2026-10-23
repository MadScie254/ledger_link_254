\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_org UUID;
  v_fund UUID;
  v_member UUID;
  v_campaign UUID;
BEGIN
  v_org := public.create_organization(v_owner, '{"name":"Campaign test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving","type":"INCOME"},
      {"code":"4040","name":"Building giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"}]', 'campaign-test');
  SELECT id INTO v_fund FROM public.funds WHERE org_id = v_org AND code = 'BUILDING';
  INSERT INTO public.members (org_id, member_number, first_name)
    VALUES (v_org, 'MEM-1', 'Miriam') RETURNING id INTO v_member;
  INSERT INTO public.church_campaigns (org_id, fund_id, name, goal_cents, starts_on, ends_on, created_by)
    VALUES (v_org, v_fund, 'Roof repairs', 5000000, DATE '2026-01-01', DATE '2026-12-31', v_owner)
    RETURNING id INTO v_campaign;
  INSERT INTO public.church_pledges (org_id, campaign_id, member_id, pledged_cents, pledged_on, created_by)
    VALUES (v_org, v_campaign, v_member, 100000, DATE '2026-02-01', v_owner);
  PERFORM public.record_contribution(v_org, v_member, v_fund, NULL, 25000, 'BANK',
    DATE '2026-03-01', NULL, 'campaign-gift-1', v_owner);
  IF (SELECT given_cents FROM public.church_campaign_progress(v_org) WHERE campaign_id = v_campaign) <> 25000 THEN
    RAISE EXCEPTION 'Campaign progress did not count the posted gift.';
  END IF;
  IF (SELECT received_cents FROM public.church_pledge_progress(v_org) WHERE campaign_id = v_campaign AND member_id = v_member) <> 25000 THEN
    RAISE EXCEPTION 'Pledge progress did not count the member gift.';
  END IF;
  IF (SELECT pledged_cents FROM public.church_pledges WHERE org_id = v_org AND campaign_id = v_campaign) <> 100000 THEN
    RAISE EXCEPTION 'Pledge cents were not stored.';
  END IF;
  BEGIN
    INSERT INTO public.church_campaigns (org_id, fund_id, name, goal_cents, starts_on, ends_on)
      VALUES (v_org, v_fund, 'Overlapping appeal', 100, DATE '2026-06-01', DATE '2027-01-01');
    RAISE EXCEPTION 'Overlapping campaigns were accepted.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.church_pledges (org_id, campaign_id, member_id, pledged_cents, pledged_on)
      VALUES (v_org, v_campaign, v_member, 100, DATE '2026-02-01');
    RAISE EXCEPTION 'Duplicate member pledge was accepted.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$test$;
ROLLBACK;
SELECT 'CHURCH CAMPAIGN TEST PASSED';
