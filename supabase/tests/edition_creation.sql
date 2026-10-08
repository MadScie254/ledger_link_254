-- Run after the migration stack and tests/db/fixture.sql, using psql -v ON_ERROR_STOP=1.
-- The transaction leaves the fixture unchanged.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_law UUID;
  v_church UUID;
  v_business UUID;
  v_error TEXT;
BEGIN
  v_law := public.create_organization(
    v_owner,
    '{"name":"Mizani test","edition":"law","baseCurrency":"KES"}',
    '[{"code":"1060","name":"Client account, bank","type":"ASSET","isBankAccount":true},
      {"code":"2200","name":"Client money held","type":"LIABILITY"}]',
    'edition-law-test'
  );
  IF (SELECT edition::TEXT FROM public.organizations WHERE id = v_law) <> 'law' THEN
    RAISE EXCEPTION 'Law edition was not stored.';
  END IF;
  IF (SELECT count(*) FROM public.accounts WHERE org_id = v_law) <> 2 THEN
    RAISE EXCEPTION 'Law accounts were not seeded.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_subscriptions
    WHERE org_id = v_law AND plan_id = 'law_solo' AND status = 'TRIAL'
      AND trial_ends_at BETWEEN now() + interval '29 days' AND now() + interval '31 days'
  ) THEN
    RAISE EXCEPTION 'Law Solo trial was not created.';
  END IF;
  IF public.create_organization(v_owner, '{"name":"Replay","edition":"law"}', '[]', 'edition-law-test') <> v_law THEN
    RAISE EXCEPTION 'Creation key did not replay the original organization.';
  END IF;
  IF (SELECT count(*) FROM public.organization_subscriptions WHERE org_id = v_law) <> 1 THEN
    RAISE EXCEPTION 'Replay duplicated the subscription.';
  END IF;

  v_church := public.create_organization(
    v_owner,
    '{"name":"Kundi test","edition":"church","businessType":"general"}',
    '[{"code":"1040","name":"Cash on hand, collections","type":"ASSET","isBankAccount":true},
      {"code":"3200","name":"Restricted funds","type":"EQUITY"},
      {"code":"3300","name":"General fund","type":"EQUITY"}]',
    'edition-church-test'
  );
  IF (SELECT edition::TEXT FROM public.organizations WHERE id = v_church) <> 'church' THEN
    RAISE EXCEPTION 'Church edition was not stored.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_subscriptions
    WHERE org_id = v_church AND plan_id = 'church_seed' AND status = 'TRIAL'
  ) THEN
    RAISE EXCEPTION 'Church Seed trial was not created.';
  END IF;
  BEGIN
    PERFORM public.create_organization(v_owner,
      '{"name":"Collision","edition":"church","businessType":"nonprofit"}', '[]', 'edition-bad-test');
    RAISE EXCEPTION 'Church and nonprofit combination was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'church.*nonprofit' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE name = 'Collision') THEN
    RAISE EXCEPTION 'Rejected combination left an organization.';
  END IF;

  v_business := public.create_organization(v_owner, '{"name":"Business test"}', '[]', 'edition-business-test');
  IF (SELECT edition::TEXT FROM public.organizations WHERE id = v_business) <> 'business' THEN
    RAISE EXCEPTION 'Existing organization creation did not default to business.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_subscriptions WHERE org_id = v_business) THEN
    RAISE EXCEPTION 'Business organization received a pilot subscription.';
  END IF;
END
$test$;
ROLLBACK;
