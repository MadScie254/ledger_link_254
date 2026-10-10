-- AI usage per organization (20261010000100_ai_usage.sql): calls are
-- recorded, the daily ceiling counts only today's Neurons in UTC, usage is
-- reported by feature, and none of it is reachable by browser roles.
\c lltest
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'check failed: %', p_what; END IF; END $$;

\set org '00000000-0000-0000-0000-0000000000aa'
\set owner '00000000-0000-0000-0000-000000000001'

-- Nothing used yet: the whole ceiling is left.
SELECT pg_temp.check(public.ai_units_left(:'org', 4000) = 4000, 'a fresh organization has its full ceiling');

SELECT public.log_ai_call(:'org', :'owner', 'ask.plan', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', true, 900, 40, 31.5, 820);
SELECT public.log_ai_call(:'org', :'owner', 'ask.answer', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', true, 700, 120, 44.25, 1500);
SELECT public.log_ai_call(:'org', :'owner', 'receipt.read', '@cf/mistralai/mistral-small-3.1-24b-instruct', false, 0, 0, 0, 30000);
-- Negative counts from a confused caller are stored as zero.
SELECT public.log_ai_call(:'org', NULL, 'bank.suggest', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', true, -5, -1, -2, -9);

SELECT pg_temp.check(public.ai_units_left(:'org', 4000) = 4000 - 75.75, 'today''s Neurons count against the ceiling');
SELECT pg_temp.check(public.ai_units_left(:'org', 50) = 0, 'the ceiling never goes below zero');

-- Yesterday (UTC) does not count against today.
INSERT INTO private.ai_calls (org_id, feature, model, ok, neurons, created_at)
VALUES (:'org', 'ask.plan', 'm', true, 5000, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 second');
SELECT pg_temp.check(public.ai_units_left(:'org', 4000) = 4000 - 75.75, 'calls before 00:00 UTC are yesterday''s');

-- Usage by feature since a moment.
SELECT pg_temp.check(
  (SELECT count(*) FROM public.ai_usage(:'org', now() - interval '1 hour')) = 4, 'four features used in the last hour');
SELECT pg_temp.check(
  (SELECT calls = 1 AND failed = 1 FROM public.ai_usage(:'org', now() - interval '1 hour') WHERE feature = 'receipt.read'), 'a failed call is counted as failed');
SELECT pg_temp.check(
  (SELECT tokens_in = 0 AND neurons = 0 FROM public.ai_usage(:'org', now() - interval '1 hour') WHERE feature = 'bank.suggest'), 'negative counts were stored as zero');
SELECT pg_temp.check(
  (SELECT sum(calls) FROM public.ai_usage(:'org', now() - interval '2 days')) = 5, 'yesterday''s call is in a longer window');

-- A feature name must be a plain identifier.
SELECT pg_temp.check(pg_temp.err($q$SELECT public.log_ai_call('00000000-0000-0000-0000-0000000000aa', NULL, 'Bad Feature!', 'm', true, 0, 0, 0, 0)$q$) ~* 'check constraint',
  'an odd feature name is refused');

-- Another organization's calls are its own.
SELECT pg_temp.check(public.ai_units_left('00000000-0000-0000-0000-0000000000bb', 4000) = 4000, 'usage is per organization');

-- Browser roles reach neither the table nor the functions.
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'private.ai_calls', 'SELECT'), 'authenticated cannot read the log');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.log_ai_call(uuid, uuid, text, text, boolean, integer, integer, numeric, integer)', 'EXECUTE'), 'authenticated cannot log calls');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.ai_units_left(uuid, numeric)', 'EXECUTE'), 'anon cannot read the ceiling');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.ai_usage(uuid, timestamptz)', 'EXECUTE'), 'authenticated cannot read usage');
SELECT pg_temp.check(has_function_privilege('service_role', 'public.ai_usage(uuid, timestamptz)', 'EXECUTE'), 'the Worker can read usage');

SELECT 'ai usage: all checks passed';
