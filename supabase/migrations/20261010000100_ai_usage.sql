-- AI usage, per organization.
--
-- The AI features moved from Google Gemini to Cloudflare Workers AI, which
-- the account gets 10,000 Neurons of free a day for, shared by every
-- organization. Each model call is recorded here so an organization can see
-- what its AI use was, and so one organization cannot use the whole day's
-- allowance: the Worker checks private.ai_calls against a daily ceiling
-- before each call (public.ai_units_left).
--
-- Like the rate limit counters, the table is private and reached only
-- through functions the Worker's service role may run.

CREATE TABLE private.ai_calls (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature     TEXT NOT NULL CHECK (feature ~ '^[a-z][a-z_.]{0,39}$'),
  model       TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  ok          BOOLEAN NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  neurons     NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (neurons >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_calls_org_created ON private.ai_calls (org_id, created_at DESC);

ALTER TABLE private.ai_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ai_calls FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_ai_call(
  p_org_id UUID,
  p_user_id UUID,
  p_feature TEXT,
  p_model TEXT,
  p_ok BOOLEAN,
  p_tokens_in INTEGER,
  p_tokens_out INTEGER,
  p_neurons NUMERIC,
  p_duration_ms INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO private.ai_calls (org_id, user_id, feature, model, ok, tokens_in, tokens_out, neurons, duration_ms)
  VALUES (
    p_org_id, p_user_id, p_feature, p_model, COALESCE(p_ok, false),
    GREATEST(COALESCE(p_tokens_in, 0), 0), GREATEST(COALESCE(p_tokens_out, 0), 0),
    GREATEST(COALESCE(p_neurons, 0), 0), GREATEST(COALESCE(p_duration_ms, 0), 0)
  );
END;
$function$;

-- What remains of an organization's daily ceiling, in Neurons. Cloudflare's
-- allowance runs from 00:00 UTC, so the day here does too.
CREATE OR REPLACE FUNCTION public.ai_units_left(p_org_id UUID, p_daily_units NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT GREATEST(p_daily_units - COALESCE(sum(c.neurons), 0), 0)
    FROM private.ai_calls c
   WHERE c.org_id = p_org_id
     AND c.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
$function$;

-- An organization's AI use since a moment, by feature.
CREATE OR REPLACE FUNCTION public.ai_usage(p_org_id UUID, p_since TIMESTAMPTZ)
RETURNS TABLE (feature TEXT, calls BIGINT, failed BIGINT, tokens_in BIGINT, tokens_out BIGINT, neurons NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT c.feature, count(*), count(*) FILTER (WHERE NOT c.ok), sum(c.tokens_in)::BIGINT, sum(c.tokens_out)::BIGINT, sum(c.neurons)
    FROM private.ai_calls c
   WHERE c.org_id = p_org_id AND c.created_at >= p_since
   GROUP BY c.feature
   ORDER BY c.feature;
$function$;

REVOKE ALL ON FUNCTION public.log_ai_call(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, NUMERIC, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_units_left(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_usage(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_ai_call(UUID, UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_units_left(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage(UUID, TIMESTAMPTZ) TO service_role;
