-- An accountant, or bookkeeper, often serves several client organizations
-- from one account. The company switcher and the invite flow already
-- support belonging to more than one organization; the missing piece was a
-- role that can post to the books, like an admin, without being able to
-- change organization settings, invite others, or change anyone's role,
-- which stays owner and admin only.
--
-- Postgres enums only support adding a value, never removing one in the
-- same statement set; that is fine here, this never needs to be undone.
ALTER TYPE public.membership_role ADD VALUE IF NOT EXISTS 'accountant';

-- Rollback note: Postgres cannot drop an enum value directly. Removing this
-- role, if ever needed, means creating a new type without it, migrating
-- memberships.role across, and dropping the old type; not attempted here
-- because nothing requires it.
