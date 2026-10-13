import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

export class YearEndService {
  static async list(orgId: string) {
    const rows = await fetchAllRows<any>((from, to) => getSupabase().from('year_end_closes')
      .select('id, year_start, year_end, journal_entry_id, reopened_at, reversal_journal_entry_id, reopening_reason')
      .eq('org_id', orgId).order('year_end', { ascending: false }).order('id').range(from, to));
    return rows.map((row) => ({ id: row.id, yearStart: row.year_start, yearEnd: row.year_end,
      journalEntryId: row.journal_entry_id, reopenedAt: row.reopened_at,
      reversalJournalEntryId: row.reversal_journal_entry_id, reopeningReason: row.reopening_reason }));
  }

  static async close(orgId: string, yearEnd: string, actor: string) {
    const { data, error } = await getSupabase().rpc('close_financial_year', {
      p_org_id: orgId, p_year_end: yearEnd, p_actor: actor,
    });
    if (error) throw error;
    return data as { id: string; journalEntryId: string; yearEnd: string };
  }

  static async reopen(orgId: string, closeId: string, reason: string, actor: string) {
    const { data, error } = await getSupabase().rpc('reopen_financial_year', {
      p_org_id: orgId, p_close_id: closeId, p_reason: reason, p_actor: actor,
    });
    if (error) throw error;
    return data as { reversalJournalEntryId: string; yearEnd: string };
  }
}
