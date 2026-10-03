import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { JournalEntryInput, LedgerEngineError } from './types';
import { UserError } from './errors';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRY_SELECT = `
  *,
  lines:journal_lines(*)
`;

function mapEntry(entry: any) {
  return {
    id: entry.id,
    orgId: entry.org_id,
    entryDate: entry.entry_date,
    memo: entry.memo,
    sourceType: entry.source_type,
    sourceId: entry.source_id,
    referenceNo: entry.reference_no,
    createdBy: entry.created_by,
    postedAt: entry.posted_at,
    lines: (entry.lines || []).map((line: any) => ({
      id: line.id,
      accountId: line.account_id,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      entityType: line.entity_type,
      entityId: line.entity_id,
      currency: line.currency,
      foreignDebit: line.foreign_debit,
      foreignCredit: line.foreign_credit,
      exchangeRate: line.exchange_rate,
    })),
  };
}

export class LedgerService {
  /**
   * Validates and posts a Journal Entry by calling the Supabase Postgres function.
   * The function ensures SUM(debit) == SUM(credit) and executes in a single transaction.
   */
  static async postJournalEntry(input: JournalEntryInput): Promise<string> {
    const supabase = getSupabase();
    
    // Quick validation before sending to DB
    if (!input.lines || input.lines.length < 2) {
      throw new LedgerEngineError('A journal entry must have at least two lines.');
    }

    // Call the Postgres function (Migration 004)
    const { data: entryId, error } = await supabase.rpc('post_journal_entry', {
      p_org_id: input.orgId,
      p_entry_date: input.entryDate,
      p_memo: input.memo || null,
      p_source_type: input.sourceType,
      p_source_id: input.sourceId || null,
      p_reference_no: input.referenceNo || null,
      p_created_by: input.createdBy || null,
      p_lines: input.lines,
      p_idempotency_key: input.idempotencyKey?.trim() || null,
    });

    // The database error keeps its SQLSTATE, so the Worker can tell a rule
    // the entry broke from an internal failure.
    if (error) throw error;

    return entryId;
  }

  /** Every entry, newest first. For exports and checks; screens read pages. */
  static async getJournalEntries(orgId: string) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => supabase
      .from('journal_entries')
      .select(ENTRY_SELECT)
      .eq('org_id', orgId)
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to));
    return data.map(mapEntry);
  }

  /**
   * One page of entries, newest entry date first, with their lines. The
   * cursor is the last entry of the previous page (entry date and id), so
   * pages neither skip nor repeat entries posted while someone reads.
   */
  static async getJournalEntriesPage(orgId: string, query: { cursor?: string; limit?: number }) {
    const supabase = getSupabase();
    const limit = Math.min(Math.max(query.limit || 100, 1), 200);
    let request = supabase
      .from('journal_entries')
      .select(ENTRY_SELECT)
      .eq('org_id', orgId);
    if (query.cursor) {
      const [date, id] = query.cursor.split('|');
      // Both parts are checked here because they are written into a filter.
      if (!ISO_DATE.test(date || '') || !UUID.test(id || '')) throw new UserError('That page link is not valid.');
      request = request.or(`entry_date.lt.${date},and(entry_date.eq.${date},id.lt.${id})`);
    }
    const { data, error } = await request
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (error) throw error;
    const rows = data || [];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      entries: page.map(mapEntry),
      nextCursor: rows.length > limit && last ? `${last.entry_date}|${last.id}` : null,
    };
  }
}
