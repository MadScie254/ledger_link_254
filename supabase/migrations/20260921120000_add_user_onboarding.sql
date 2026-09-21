-- Persistent, cross-device onboarding state for each authenticated person.
CREATE TYPE public.onboarding_status AS ENUM (
  'NOT_ASKED',
  'IN_PROGRESS',
  'SKIPPED',
  'COMPLETED'
);

CREATE TABLE public.user_profiles (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_status  public.onboarding_status NOT NULL DEFAULT 'NOT_ASKED',
  onboarding_step    INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_step >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_select_own
  ON public.user_profiles FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY user_profiles_update_own
  ON public.user_profiles FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger function only: never callable through the Data API (matches
-- 20260829232146_lock_down_trigger_function_grants.sql).
REVOKE EXECUTE ON FUNCTION public.create_user_profile() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();

-- Existing accounts also begin at the one-time question.
INSERT INTO public.user_profiles (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;

-- Rollback, in dependency order:
-- DROP TRIGGER IF EXISTS on_auth_user_created_create_profile ON auth.users;
-- DROP FUNCTION IF EXISTS public.create_user_profile();
-- DROP TABLE IF EXISTS public.user_profiles;
-- DROP TYPE IF EXISTS public.onboarding_status;
