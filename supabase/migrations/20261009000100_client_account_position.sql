-- Where the client account stands on a day, for the client account screen
-- and the reporting accountant: the client bank account (1060), client
-- money held (2200), and the part of 2200 held in matter ledgers. When the
-- three differ, the screen shows by how much and why. Read only.
CREATE FUNCTION public.client_account_position(p_org_id UUID, p_as_of DATE)
RETURNS TABLE (client_bank_cents BIGINT, client_held_cents BIGINT, matter_ledgers_cents BIGINT, untagged_held_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH lines AS (
    SELECT account.code, line.debit, line.credit, line.entity_type
    FROM public.journal_lines AS line
    JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
    JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
    WHERE line.org_id = p_org_id AND entry.entry_date <= p_as_of AND account.code IN ('1060', '2200')
  )
  SELECT
    COALESCE(sum(lines.debit - lines.credit) FILTER (WHERE lines.code = '1060'), 0)::BIGINT,
    COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.code = '2200'), 0)::BIGINT,
    COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.code = '2200' AND lines.entity_type = 'MATTER'), 0)::BIGINT,
    COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.code = '2200' AND lines.entity_type IS DISTINCT FROM 'MATTER'), 0)::BIGINT
  FROM lines;
$function$;

REVOKE ALL ON FUNCTION public.client_account_position(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_account_position(UUID, DATE) TO service_role;

-- Rollback: drop public.client_account_position(UUID, DATE).
