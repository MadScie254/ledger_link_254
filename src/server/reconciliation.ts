import { getSupabase } from './supabase';
import { UserError } from './errors';

function mapReconciliation(row: any) {
  const account = Array.isArray(row.account) ? row.account[0] : row.account;
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: account ? `${account.code} ${account.name}` : null,
    statementDate: row.statement_date,
    statementBalanceCents: Number(row.statement_balance_cents) || 0,
    openingBalanceCents: Number(row.opening_balance_cents) || 0,
    status: row.status as 'IN_PROGRESS' | 'COMPLETED' | 'UNDONE',
    completedAt: row.completed_at,
    undoneAt: row.undone_at,
    undoReason: row.undo_reason,
    createdAt: row.created_at,
  };
}

/**
 * Reconciling a money account to a statement: tick the posted lines that
 * appear on it until, from the last reconciled balance, they come to the
 * statement's closing balance. Each step is one Postgres function.
 */
export class ReconciliationService {
  static async list(orgId: string, accountId?: string) {
    const supabase = getSupabase();
    let query = supabase
      .from('bank_reconciliations')
      .select('*, account:accounts!bank_reconciliations_account_fkey(code, name)')
      .eq('org_id', orgId);
    if (accountId) query = query.eq('account_id', accountId);
    const { data, error } = await query.order('statement_date', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return (data || []).map(mapReconciliation);
  }

  /** One reconciliation with every line it can tick, and its running figures. */
  static async worksheet(orgId: string, id: string) {
    const supabase = getSupabase();
    const [{ data: row, error }, { data: lines, error: linesError }] = await Promise.all([
      supabase
        .from('bank_reconciliations')
        .select('*, account:accounts!bank_reconciliations_account_fkey(code, name)')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle(),
      supabase.rpc('bank_reconciliation_worksheet', { p_org_id: orgId, p_reconciliation_id: id }),
    ]);
    if (error) throw error;
    if (linesError) throw linesError;
    if (!row) throw new UserError('Reconciliation not found in this organization.', 404);
    const reconciliation = mapReconciliation(row);
    const mapped = ((lines || []) as any[]).map((line) => ({
      journalLineId: line.journal_line_id,
      journalEntryId: line.journal_entry_id,
      date: line.entry_date,
      memo: line.memo,
      referenceNo: line.reference_no,
      sourceType: line.source_type,
      description: line.description,
      amountCents: Math.round((Number(line.debit) || 0) - (Number(line.credit) || 0)),
      cleared: Boolean(line.cleared),
      onStatement: Boolean(line.on_statement),
    }));
    // A finished reconciliation lists only what it cleared.
    const shown = reconciliation.status === 'IN_PROGRESS' ? mapped : mapped.filter((line) => line.cleared);
    const clearedIn = shown.filter((l) => l.cleared && l.amountCents > 0).reduce((sum, l) => sum + l.amountCents, 0);
    const clearedOut = shown.filter((l) => l.cleared && l.amountCents < 0).reduce((sum, l) => sum - l.amountCents, 0);
    const clearedBalanceCents = reconciliation.openingBalanceCents + clearedIn - clearedOut;
    return {
      reconciliation,
      lines: shown,
      clearedInCents: clearedIn,
      clearedOutCents: clearedOut,
      clearedBalanceCents,
      differenceCents: reconciliation.statementBalanceCents - clearedBalanceCents,
    };
  }

  static async start(orgId: string, input: { accountId: string; statementDate: string; statementBalanceCents: number; openingBalanceCents?: number }, actor: string) {
    const { data, error } = await getSupabase().rpc('start_bank_reconciliation', {
      p_org_id: orgId,
      p_account_id: input.accountId,
      p_statement_date: input.statementDate,
      p_statement_balance_cents: Math.trunc(input.statementBalanceCents),
      p_opening_balance_cents: input.openingBalanceCents == null ? null : Math.trunc(input.openingBalanceCents),
      p_actor: actor,
    });
    if (error) throw error;
    return data as { id: string; openingBalanceCents: number };
  }

  static async setLines(orgId: string, id: string, journalLineIds: string[], actor: string) {
    const { data, error } = await getSupabase().rpc('set_bank_reconciliation_lines', {
      p_org_id: orgId, p_reconciliation_id: id, p_journal_line_ids: journalLineIds, p_actor: actor,
    });
    if (error) throw error;
    return data as { clearedBalanceCents: number; differenceCents: number };
  }

  static async complete(orgId: string, id: string, actor: string) {
    const { data, error } = await getSupabase().rpc('complete_bank_reconciliation', {
      p_org_id: orgId, p_reconciliation_id: id, p_actor: actor,
    });
    if (error) throw error;
    return data as { status: string; clearedLines?: number };
  }

  /** Cancels one under way, or undoes the latest finished one of its account. */
  static async undo(orgId: string, id: string, reason: string | undefined, actor: string) {
    const { data, error } = await getSupabase().rpc('undo_bank_reconciliation', {
      p_org_id: orgId, p_reconciliation_id: id, p_reason: reason?.trim() || null, p_actor: actor,
    });
    if (error) throw error;
    return data as { status: 'CANCELLED' | 'UNDONE' };
  }
}
