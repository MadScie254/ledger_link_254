import { getSupabase } from './supabase';
import { AccountService } from './accounts';
import { UserError } from './errors';
import { publicMessage } from './publicMessage';
import { fetchAllRows } from './pagination';
import {
  AUTO_ACCEPT_CONFIDENCE,
  CONTROL_ACCOUNT_CODES,
  suggestBankMatches,
  type BankEntry,
  type BankLine,
  type BankMatchSuggestion,
  type OpenDocument,
} from '../utils/bankMatching';

/** The account statement lines are reconciled against. */
const BANK_ACCOUNT_CODE = '1000';

/**
 * Accepting a suggestion costs several Worker subrequests (the line, the
 * target, the posting and the status update), and the Workers Free plan
 * allows 50 per request. Each auto-accept run therefore takes a bounded batch;
 * the response says how many strong matches remain for the next run.
 */
const AUTO_ACCEPT_BATCH = 5;

/** What a statement line is matched to: exactly one of these. */
export interface BankMatchTarget {
  targetAccountId?: string;
  existingJournalEntryId?: string;
  invoiceId?: string;
  billId?: string;
}

export type BankMatchCandidate = BankMatchSuggestion & {
  description: string | null;
  date: string;
  direction: 'IN' | 'OUT';
  amountCents: number;
};

function mapTransaction(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    date: row.date,
    description: row.description,
    amountCents: Number(row.amount_cents) || 0,
    direction: row.direction,
    status: row.status,
    matchedJournalEntryId: row.matched_journal_entry_id ?? null,
    aiCategoryCode: row.ai_category_code,
    aiCategoryName: row.ai_category_name,
    createdAt: row.created_at
  };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function targetFor(suggestion: BankMatchSuggestion): BankMatchTarget | null {
  switch (suggestion.matchType) {
    case 'ENTRY': return suggestion.journalEntryId ? { existingJournalEntryId: suggestion.journalEntryId } : null;
    case 'INVOICE': return suggestion.entityId ? { invoiceId: suggestion.entityId } : null;
    case 'BILL': return suggestion.entityId ? { billId: suggestion.entityId } : null;
    case 'ACCOUNT': return suggestion.suggestedAccountId ? { targetAccountId: suggestion.suggestedAccountId } : null;
  }
}

/** Net movement of each journal entry on one account: positive is money in. */
async function bankMovementsByEntry(orgId: string, bankAccountId: string, range: { from?: string; to?: string; entryId?: string }) {
  const supabase = getSupabase();
  const rows = await fetchAllRows<any>((from, to) => {
    let query = supabase
      .from('journal_lines')
      .select('id, debit, credit, journal_entry:journal_entries!inner(id, org_id, entry_date, memo)')
      .eq('account_id', bankAccountId)
      .eq('journal_entries.org_id', orgId);
    if (range.entryId) query = query.eq('journal_entry_id', range.entryId);
    if (range.from) query = query.gte('journal_entries.entry_date', range.from);
    if (range.to) query = query.lte('journal_entries.entry_date', range.to);
    return query.order('id').range(from, to);
  });

  const byEntry = new Map<string, BankEntry>();
  for (const row of rows) {
    const entry = Array.isArray(row.journal_entry) ? row.journal_entry[0] : row.journal_entry;
    if (!entry?.id) continue;
    const current = byEntry.get(entry.id) || { journalEntryId: entry.id, entryDate: String(entry.entry_date || ''), memo: entry.memo ?? null, netBankCents: 0 };
    current.netBankCents += Math.round((Number(row.debit) || 0) - (Number(row.credit) || 0));
    byEntry.set(entry.id, current);
  }
  return byEntry;
}

/** Journal entries already reconciled to a statement line. */
async function linkedEntryIds(orgId: string): Promise<Set<string>> {
  const supabase = getSupabase();
  const rows = await fetchAllRows<{ matched_journal_entry_id: string | null }>((from, to) => supabase
    .from('bank_transactions')
    .select('id, matched_journal_entry_id')
    .eq('org_id', orgId)
    .not('matched_journal_entry_id', 'is', null)
    .order('id')
    .range(from, to));
  return new Set(rows.map((row) => row.matched_journal_entry_id).filter((id): id is string => Boolean(id)));
}

export class BankingService {
  static async getTransactions(orgId: string) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => supabase
      .from('bank_transactions')
      .select('*')
      .eq('org_id', orgId)
      .order('date', { ascending: false })
      .order('id')
      .range(from, to));

    return rows.map(mapTransaction);
  }

  static async syncTransactions(orgId: string) {
    // Bank integration (e.g. Daraja API or OFX upload) is not yet implemented.
    return { count: 0, message: "Bank sync isn't connected yet" };
  }

  static async getRules(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bank_rules')
      .select('id, match_text, target_account_id, accounts!inner(code, name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      matchText: row.match_text,
      targetAccountId: row.target_account_id,
      targetAccountCode: row.accounts?.code,
      targetAccountName: row.accounts?.name
    }));
  }

  static async createRule(orgId: string, matchText: string, targetAccountId: string, createdBy?: string): Promise<string> {
    const supabase = getSupabase();
    if (typeof matchText !== 'string' || !matchText.trim()) throw new Error('Match text is required.');
    if (!targetAccountId) throw new Error('A target account is required.');

    const { data: targetAccount, error: accountError } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('org_id', orgId)
      .eq('id', targetAccountId)
      .eq('is_active', true)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!targetAccount) throw new Error('The target account is inactive or belongs to another organization.');
    if (CONTROL_ACCOUNT_CODES.has(targetAccount.code)) {
      throw new Error('A rule cannot post to accounts receivable or payable. Statement lines that pay an invoice or bill are matched to the document instead.');
    }
    if (targetAccount.code === BANK_ACCOUNT_CODE) {
      throw new Error('A rule cannot post a bank line back to the bank account itself.');
    }

    const { data, error } = await supabase
      .from('bank_rules')
      .insert({ org_id: orgId, match_text: matchText.trim(), target_account_id: targetAccountId, created_by: createdBy || null })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  static async deleteRule(orgId: string, id: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.from('bank_rules').delete().eq('id', id).eq('org_id', orgId);
    if (error) throw error;
  }

  static async requestBankConnection(orgId: string, input: { institutionName: string; contactEmail?: string; notes?: string }, requestedBy?: string): Promise<string> {
    const supabase = getSupabase();
    if (!input.institutionName?.trim()) throw new Error('Institution name is required.');

    const { data, error } = await supabase
      .from('bank_connection_requests')
      .insert({
        org_id: orgId,
        institution_name: input.institutionName.trim(),
        contact_email: input.contactEmail || null,
        notes: input.notes || null,
        requested_by: requestedBy || null
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  static async getConnectionRequests(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bank_connection_requests')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      institutionName: row.institution_name,
      contactEmail: row.contact_email,
      notes: row.notes,
      status: row.status,
      createdAt: row.created_at
    }));
  }

  static async getReconciliationSummary(orgId: string) {
    const [transactions, bankAccount] = await Promise.all([
      this.getTransactions(orgId),
      AccountService.getAccountByCode(orgId, BANK_ACCOUNT_CODE),
    ]);
    const statementBalanceCents = transactions.reduce(
      (sum, tx: any) => sum + (tx.direction === 'IN' ? tx.amountCents : -tx.amountCents),
      0
    );

    let glBalanceCents = 0;
    if (bankAccount) {
      const balances = await AccountService.getAccountBalances(orgId);
      glBalanceCents = balances.get(bankAccount.id) || 0;
    }

    return {
      statementBalanceCents,
      glBalanceCents,
      varianceCents: statementBalanceCents - glBalanceCents,
      transactionCount: transactions.length
    };
  }

  /**
   * Suggests a match for each unmatched statement line. The scoring lives in
   * src/utils/bankMatching.ts; this gathers its inputs: unmatched lines, the
   * company's rules, open invoices and bills, and entries already posted to
   * the bank account that no line has claimed yet.
   */
  static async getAIMatches(orgId: string): Promise<BankMatchCandidate[]> {
    const supabase = getSupabase();
    const [unmatchedRows, rules, accounts, bankAccount] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('bank_transactions')
        .select('id, date, description, amount_cents, direction, status')
        .eq('org_id', orgId)
        .neq('status', 'MATCHED')
        .order('id')
        .range(from, to)),
      this.getRules(orgId),
      fetchAllRows<{ id: string; code: string; name: string; is_active: boolean }>((from, to) => supabase
        .from('accounts')
        .select('id, code, name, is_active')
        .eq('org_id', orgId)
        .order('id')
        .range(from, to)),
      AccountService.getAccountByCode(orgId, BANK_ACCOUNT_CODE),
    ]);

    const lines: BankLine[] = unmatchedRows.map((row) => ({
      id: row.id,
      date: String(row.date),
      description: row.description,
      amountCents: Number(row.amount_cents),
      direction: row.direction,
    }));
    if (lines.length === 0) return [];

    const dates = lines.map((line) => line.date.slice(0, 10)).sort();
    const [invoiceRows, billRows, movements, linked] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('invoices')
        .select('id, invoice_number, amount_due_cents, customers(display_name)')
        .eq('org_id', orgId)
        .in('status', ['SENT', 'PARTIALLY_PAID'])
        .order('id')
        .range(from, to)),
      fetchAllRows<any>((from, to) => supabase
        .from('bills')
        .select('id, bill_number, amount_due_cents, vendors(display_name)')
        .eq('org_id', orgId)
        .in('status', ['OPEN', 'PARTIALLY_PAID'])
        .order('id')
        .range(from, to)),
      bankAccount
        ? bankMovementsByEntry(orgId, bankAccount.id, { from: addDays(dates[0], -45), to: addDays(dates[dates.length - 1], 45) })
        : Promise.resolve(new Map<string, BankEntry>()),
      linkedEntryIds(orgId),
    ]);

    const relationName = (value: any) => (Array.isArray(value) ? value[0] : value)?.display_name ?? null;
    const openInvoices: OpenDocument[] = invoiceRows.map((row) => ({
      id: row.id, number: row.invoice_number, partyName: relationName(row.customers), amountDueCents: Number(row.amount_due_cents) || 0,
    }));
    const openBills: OpenDocument[] = billRows.map((row) => ({
      id: row.id, number: row.bill_number, partyName: relationName(row.vendors), amountDueCents: Number(row.amount_due_cents) || 0,
    }));
    const bankEntries = [...movements.values()].filter((entry) => !linked.has(entry.journalEntryId));

    const suggestions = suggestBankMatches({ lines, rules, openInvoices, openBills, bankEntries });

    // Resolve account guesses against this company's chart; a guess for an
    // account the company does not have, or has switched off, is dropped.
    const activeByCode = new Map(accounts.filter((a) => a.is_active !== false).map((a) => [a.code, a]));
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const candidates: BankMatchCandidate[] = [];
    for (const suggestion of suggestions) {
      if (suggestion.matchType === 'ACCOUNT' && !suggestion.suggestedAccountId) {
        const account = suggestion.suggestedAccountCode ? activeByCode.get(suggestion.suggestedAccountCode) : undefined;
        if (!account) continue;
        suggestion.suggestedAccountId = account.id;
        suggestion.suggestedAccountName = account.name;
        suggestion.entityName = account.name;
      }
      const line = lineById.get(suggestion.transactionId)!;
      candidates.push({ ...suggestion, description: line.description, date: line.date, direction: line.direction, amountCents: line.amountCents });
    }
    return candidates;
  }

  /**
   * Accepts the strong suggestions (AUTO_ACCEPT_CONFIDENCE or more; a lower
   * threshold from the caller is ignored), a bounded batch per request.
   */
  static async autoReconcileAll(orgId: string, minConfidence: number = AUTO_ACCEPT_CONFIDENCE, userId: string) {
    const threshold = Math.max(AUTO_ACCEPT_CONFIDENCE, Number(minConfidence) || 0);
    const matches = await this.getAIMatches(orgId);
    const qualifying = matches.filter((m) => m.confidence >= threshold);

    let reconciledCount = 0;
    const failures: Array<{ transactionId: string; message: string }> = [];
    for (const match of qualifying.slice(0, AUTO_ACCEPT_BATCH)) {
      const target = targetFor(match);
      if (!target) continue;
      try {
        await this.matchTransaction(orgId, match.transactionId, target, userId);
        reconciledCount++;
      } catch (err) {
        failures.push({ transactionId: match.transactionId, message: publicMessage(err) });
      }
    }

    return {
      count: reconciledCount,
      failed: failures.length,
      failures,
      remaining: Math.max(0, qualifying.length - AUTO_ACCEPT_BATCH),
      totalPending: matches.length,
    };
  }

  /**
   * Matches one statement line to exactly one target, in one database
   * transaction that locks the line (public.match_bank_transaction):
   * - invoiceId or billId records a payment against that document, so the
   *   invoice or bill, the customer or supplier balance and the ledger move
   *   together;
   * - existingJournalEntryId links an entry already posted that moved the bank
   *   account by the same amount in the same direction, posting nothing new;
   * - targetAccountId posts a new bank entry against that account, which may
   *   not be receivables, payables or the bank account itself.
   * Two people matching the same line at once cannot both post: the second
   * waits for the lock and is then told the line is already matched.
   */
  static async matchTransaction(orgId: string, transactionId: string, target: BankMatchTarget, userId: string): Promise<string> {
    const chosen = [target.targetAccountId, target.existingJournalEntryId, target.invoiceId, target.billId].filter(Boolean);
    if (chosen.length !== 1) {
      throw new UserError('Choose exactly one of an account, a posted entry, an invoice or a bill to match this line to.');
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('match_bank_transaction', {
      p_org_id: orgId,
      p_transaction_id: transactionId,
      p_target_account_id: target.targetAccountId || null,
      p_existing_journal_entry_id: target.existingJournalEntryId || null,
      p_invoice_id: target.invoiceId || null,
      p_bill_id: target.billId || null,
      p_actor: userId,
    });
    if (error) throw error;
    return data as string;
  }

  /**
   * Undoes a match: a posting the match made is reversed, and a link to an
   * entry posted elsewhere is removed. A line that recorded a payment is
   * undone by reversing that payment instead.
   */
  static async unmatchTransaction(orgId: string, transactionId: string, userId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('unmatch_bank_transaction', {
      p_org_id: orgId,
      p_transaction_id: transactionId,
      p_actor: userId,
    });
    if (error) throw error;
    return data as { reversalJournalEntryId: string | null };
  }
}
