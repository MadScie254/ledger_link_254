-- Every posted amount is stored in the company's base currency. Changing the
-- base currency afterwards relabelled every historical figure (a KES ledger
-- would suddenly read as USD) without converting anything. Organization
-- settings allowed it at any time.
--
-- Once a company has posted any journal entry, its base currency is fixed.
-- Before the first entry it can still be corrected freely.

CREATE OR REPLACE FUNCTION private.prevent_base_currency_change_after_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.base_currency IS DISTINCT FROM OLD.base_currency
     AND EXISTS (SELECT 1 FROM public.journal_entries AS entry WHERE entry.org_id = OLD.id) THEN
    RAISE EXCEPTION 'The base currency cannot change after entries are posted: every posted amount is recorded in %.', OLD.base_currency
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.prevent_base_currency_change_after_posting()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS organizations_lock_base_currency ON public.organizations;
CREATE TRIGGER organizations_lock_base_currency
  BEFORE UPDATE OF base_currency ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_base_currency_change_after_posting();

-- Rollback:
-- DROP TRIGGER organizations_lock_base_currency ON public.organizations;
-- DROP FUNCTION private.prevent_base_currency_change_after_posting();
