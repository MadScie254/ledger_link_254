\c lltest
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'edition test: %', p_message; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_error text;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN v_error := SQLERRM; END;
  IF v_error IS NULL OR v_error !~* p_pattern THEN
    RAISE EXCEPTION 'expected error matching %, got %', p_pattern, coalesce(v_error, 'none');
  END IF;
END $$;

SELECT pg_temp.check((SELECT edition::text FROM public.organizations
  WHERE id = '00000000-0000-0000-0000-0000000000aa') = 'business', 'old organization defaults to business');
SELECT pg_temp.check((SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  FROM pg_enum WHERE enumtypid = 'public.organization_edition'::regtype) = ARRAY['business','law','church'], 'edition values');
SELECT pg_temp.check((SELECT count(*) FROM public.plans) = 7, 'seven launch plans');
SELECT pg_temp.check((SELECT (monthly_price_cents, annual_price_cents, max_users, max_members)
  FROM public.plans WHERE id = 'law_solo') = (250000::bigint, 2500000::bigint, 2, NULL::integer), 'law Solo price and limit');
SELECT pg_temp.check((SELECT (monthly_price_cents, annual_price_cents, max_users, max_members)
  FROM public.plans WHERE id = 'church_large') = (950000::bigint, 9500000::bigint, NULL::integer, 2000), 'church Large price and limit');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
  AND tablename='organizations' AND indexdef LIKE '%parent_org_id%'), 'parent organization indexed');

SELECT pg_temp.expect_err($q$UPDATE public.organizations SET integration_actor_id =
  '00000000-0000-0000-0000-000000000004' WHERE id = '00000000-0000-0000-0000-0000000000aa'$q$, 'owner, admin or accountant');
INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000004', 'member');
SELECT pg_temp.expect_err($q$UPDATE public.organizations SET integration_actor_id =
  '00000000-0000-0000-0000-000000000004' WHERE id = '00000000-0000-0000-0000-0000000000aa'$q$, 'owner, admin or accountant');
UPDATE public.memberships SET role='accountant' WHERE org_id='00000000-0000-0000-0000-0000000000aa'
  AND user_id='00000000-0000-0000-0000-000000000004';
UPDATE public.organizations SET integration_actor_id='00000000-0000-0000-0000-000000000004'
  WHERE id='00000000-0000-0000-0000-0000000000aa';
UPDATE public.memberships SET role='member' WHERE org_id='00000000-0000-0000-0000-0000000000aa'
  AND user_id='00000000-0000-0000-0000-000000000004';
SELECT pg_temp.check((SELECT integration_actor_id FROM public.organizations
  WHERE id='00000000-0000-0000-0000-0000000000aa') IS NULL, 'downgrade clears integration actor');

INSERT INTO public.organizations (id, name, edition) VALUES
  ('00000000-0000-0000-0000-0000000000bb', 'Other law firm', 'law');
UPDATE public.organizations SET edition='law' WHERE id='00000000-0000-0000-0000-0000000000aa';
INSERT INTO public.organization_subscriptions (org_id, plan_id, status, trial_ends_at) VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'law_solo', 'TRIAL', now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000000bb', 'law_firm', 'TRIAL', now() + interval '30 days');
SELECT pg_temp.expect_err($q$UPDATE public.organization_subscriptions SET plan_id='church_seed'
  WHERE org_id='00000000-0000-0000-0000-0000000000bb'$q$, 'same edition');
SELECT pg_temp.expect_err($q$UPDATE public.organizations SET edition='church'
  WHERE id='00000000-0000-0000-0000-0000000000bb'$q$, 'same edition');
SELECT pg_temp.check(NOT has_table_privilege('authenticated','public.plans','INSERT')
  AND NOT has_table_privilege('authenticated','public.organization_subscriptions','INSERT'), 'only service role can write plans');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.check((SELECT count(*) FROM public.plans) = 7, 'member reads plans');
SELECT pg_temp.check((SELECT count(*) FROM public.organization_subscriptions) = 1, 'member reads own subscription only');
RESET ROLE;
RESET request.jwt.claim.sub;

SELECT pg_temp.check(private.next_document_number('00000000-0000-0000-0000-0000000000aa','MATTER') = 1, 'matter numbering');
SELECT pg_temp.check(private.next_document_number('00000000-0000-0000-0000-0000000000aa','COLLECTION') = 1, 'collection numbering');
SELECT pg_temp.check(private.next_document_number('00000000-0000-0000-0000-0000000000aa','REQUISITION') = 1, 'requisition numbering');
SELECT pg_temp.check(private.next_document_number('00000000-0000-0000-0000-0000000000aa','ESTIMATE') = 1, 'existing estimate numbering remains');

SELECT 'ALL EDITION TESTS PASSED' AS result;
