-- Lets a company pick its own accent color instead of the default oxblood.
-- Only the brand accent (buttons, the sidebar spine, focus rings) changes;
-- the meaning-carrying colors, blue for entered figures, red for totals and
-- errors, green for a tick, are never affected by this and stay fixed for
-- every organization, on every accent.
--
-- NOT NULL with a default: every existing organization keeps today's exact
-- oxblood look with no migration-time visual change.
CREATE TYPE public.organization_theme_accent AS ENUM (
  'oxblood',
  'forest',
  'navy',
  'plum',
  'slate'
);

ALTER TABLE public.organizations
  ADD COLUMN theme_accent public.organization_theme_accent NOT NULL DEFAULT 'oxblood';

COMMENT ON COLUMN public.organizations.theme_accent IS
  'The brand accent shown to everyone who opens this organization''s books. Never changes the meaning-carrying colors (entered-figure blue, loss/error red, tick green).';

-- Rollback, in dependency order:
-- ALTER TABLE public.organizations DROP COLUMN theme_accent;
-- DROP TYPE public.organization_theme_accent;
