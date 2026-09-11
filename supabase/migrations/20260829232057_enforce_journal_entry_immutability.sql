-- Posted journal entries must be append-only, exactly like journal_lines already correctly is
-- (journal_lines has no update/delete policy at all). journal_entries currently allows any org
-- member to UPDATE a posted entry in place, and any admin to hard-DELETE one — both break the
-- immutable-ledger guarantee ("The Sacred Ledger Core" comment in the original code). Corrections
-- must happen via a new reversing entry, never an edit or delete of history.

DROP POLICY IF EXISTS journal_entries_update_policy ON public.journal_entries;

DROP POLICY IF EXISTS journal_entries_delete_policy ON public.journal_entries;
CREATE POLICY journal_entries_delete_policy ON public.journal_entries
  FOR DELETE
  USING (false);
