import { getSupabase } from './supabase';
import { JournalEntryInput, LedgerEngineError } from './types';
import { AuditService } from './audit';

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
      p_lines: input.lines
    });

    if (error) {
      throw new LedgerEngineError(`Failed to post journal entry: ${error.message}`);
    }

    if (input.createdBy) {
      await AuditService.logEvent({
        orgId: input.orgId,
        userId: input.createdBy,
        action: 'CREATE',
        resourceType: 'JOURNAL_ENTRY',
        resourceId: entryId,
        details: { memo: input.memo, sourceType: input.sourceType }
      });
    }

    return entryId;
  }

  static async getJournalEntries(orgId: string) {
    const supabase = getSupabase();
    
    // The new Postgres version must return entries with their lines joined, since reports depend on line-level data.
    const { data, error } = await supabase
      .from('journal_entries')
      .select(`
        *,
        lines:journal_lines(*)
      `)
      .eq('org_id', orgId)
      .order('posted_at', { ascending: false });
      
    if (error) throw error;
    
    return (data || []).map((entry: any) => ({
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
        entityId: line.entity_id
      }))
    }));
  }
}
