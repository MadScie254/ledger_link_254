-- Lets a company describe what kind of business it runs, separate from the
-- free-text `industry` field. This one is a fixed list because the app reads
-- it: which extra accounts get seeded, which onboarding-tour steps apply, and
-- (client-side) which sidebar sections are promoted for that kind of work.
--
-- Nullable, no default: an existing organization keeps behaving exactly as it
-- does today until someone picks a type, in the post-signup prompt or later
-- from Settings.
CREATE TYPE public.organization_business_type AS ENUM (
  'retail',
  'services',
  'hospitality',
  'construction',
  'logistics',
  'nonprofit',
  'general'
);

ALTER TABLE public.organizations
  ADD COLUMN business_type public.organization_business_type;

COMMENT ON COLUMN public.organizations.business_type IS
  'Drives seeded accounts and onboarding content. Null = not chosen yet (pre-existing organizations, or a person who has not been asked).';

-- Rollback, in dependency order:
-- ALTER TABLE public.organizations DROP COLUMN business_type;
-- DROP TYPE public.organization_business_type;
