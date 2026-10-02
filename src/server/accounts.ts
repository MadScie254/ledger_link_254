import { getSupabase } from './supabase';
import { AuditService } from './audit';
import { fetchAllRows } from './pagination';

const ACCOUNT_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE']);
const CREDIT_NORMAL_TYPES = new Set(['LIABILITY', 'EQUITY', 'INCOME']);

/** Summed debits and credits for one account, in cents. */
export interface AccountTotals {
  debitCents: number;
  creditCents: number;
}

export interface AccountInput {
  orgId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';
  subtype?: string;
  parentId?: string;
  currency?: string;
  createdBy?: string;
}

function normalBalance(type: string, totals: AccountTotals | undefined): number {
  if (!totals) return 0;
  return CREDIT_NORMAL_TYPES.has(type) ? totals.creditCents - totals.debitCents : totals.debitCents - totals.creditCents;
}

export class AccountService {
  static async createAccount(input: AccountInput): Promise<string> {
    const supabase = getSupabase();
    let currency = input.currency?.trim().toUpperCase();
    if (!currency) {
      const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('base_currency')
        .eq('id', input.orgId)
        .single();
      if (organizationError) throw organizationError;
      currency = String(organization.base_currency || 'KES').toUpperCase();
    }
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Account currency must be a three-letter ISO code.');

    if (input.parentId) {
      const { data: parent, error: parentError } = await supabase
        .from('accounts')
        .select('id')
        .eq('org_id', input.orgId)
        .eq('id', input.parentId)
        .maybeSingle();
      if (parentError) throw parentError;
      if (!parent) throw new Error('The parent account does not belong to this organization.');
    }

    // Check if code already exists for this org
    const { data: existing, error: searchError } = await supabase
      .from('accounts')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('code', input.code)
      .limit(1);
      
    if (searchError) throw searchError;
      
    if (existing && existing.length > 0) {
      throw new Error(`Account code ${input.code} already exists.`);
    }

    const { data: newAccount, error: insertError } = await supabase
      .from('accounts')
      .insert({
        org_id: input.orgId,
        code: input.code,
        name: input.name,
        type: input.type,
        subtype: input.subtype || null,
        parent_id: input.parentId || null,
        currency,
        is_active: true
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    if (input.createdBy) {
      await AuditService.logEvent({
        orgId: input.orgId,
        userId: input.createdBy,
        action: 'CREATE',
        resourceType: 'ACCOUNT',
        resourceId: newAccount.id,
        details: { code: input.code, name: input.name, type: input.type }
      });
    }

    return newAccount.id;
  }

  static async getAccountByCode(orgId: string, code: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('org_id', orgId)
      .eq('code', code)
      .maybeSingle();

    // A failed query is an error, not a missing account.
    if (error) throw error;
    return data;
  }

  /**
   * Creates many accounts in one insert. One round trip per account (each an
   * existence check, an insert and an audit row) pushed a large import past
   * the Worker's subrequest limit, the same failure fixed for company setup.
   * Rows with a missing code or name, an unknown type, a bad currency or a
   * code already in use are counted as failed and skipped.
   */
  static async bulkCreateAccounts(orgId: string, accounts: Omit<AccountInput, 'orgId'>[], userId?: string): Promise<{ success: number, failed: number, accountIds: string[] }> {
    const supabase = getSupabase();
    const [{ data: organization, error: organizationError }, existing] = await Promise.all([
      supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
      fetchAllRows<{ code: string }>((from, to) => supabase
        .from('accounts')
        .select('code')
        .eq('org_id', orgId)
        .order('code')
        .range(from, to)),
    ]);
    if (organizationError) throw organizationError;
    const baseCurrency = String(organization.base_currency || 'KES').toUpperCase();

    const takenCodes = new Set(existing.map((row) => row.code));
    const rows: Record<string, unknown>[] = [];
    let failed = 0;
    for (const account of accounts) {
      const code = String(account?.code ?? '').trim();
      const name = String(account?.name ?? '').trim();
      const currency = String(account?.currency || baseCurrency).trim().toUpperCase();
      if (!code || !name || !ACCOUNT_TYPES.has(account?.type) || !/^[A-Z]{3}$/.test(currency) || takenCodes.has(code)) {
        failed++;
        continue;
      }
      takenCodes.add(code);
      rows.push({
        org_id: orgId,
        code,
        name,
        type: account.type,
        subtype: account.subtype || null,
        currency,
        is_active: true,
      });
    }

    if (rows.length === 0) return { success: 0, failed, accountIds: [] };

    const { data: created, error } = await supabase
      .from('accounts')
      .insert(rows)
      .select('id, code, name, type');
    if (error) throw error;

    if (userId) {
      await AuditService.logEvents((created || []).map((row: any) => ({
        orgId,
        userId,
        action: 'CREATE' as const,
        resourceType: 'ACCOUNT' as const,
        resourceId: row.id,
        details: { code: row.code, name: row.name, type: row.type },
      })));
    }

    return { success: created?.length || 0, failed, accountIds: (created || []).map((row: any) => row.id) };
  }

  static async bulkDeleteAccounts(orgId: string, accountIds: string[], userId?: string) {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('org_id', orgId)
      .in('id', accountIds);

    if (error) throw error;

    if (userId) {
      await AuditService.logEvents(accountIds.map((id) => ({
        orgId,
        userId,
        action: 'DELETE' as const,
        resourceType: 'ACCOUNT' as const,
        resourceId: id,
        details: { message: 'Undo bulk operation' },
      })));
    }
  }

  static async getAccounts(orgId: string) {
    const supabase = getSupabase();
    const [accounts, totals] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('accounts')
        .select('*')
        .eq('org_id', orgId)
        .order('code')
        .order('id')
        .range(from, to)),
      this.getAccountTotals(orgId),
    ]);

    // Convert snake_case to camelCase for the frontend
    return accounts.map(row => ({
      id: row.id,
      orgId: row.org_id,
      code: row.code,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      parentId: row.parent_id,
      isActive: row.is_active,
      currency: row.currency,
      createdAt: row.created_at,
      balanceCents: normalBalance(row.type, totals.get(row.id))
    }));
  }

  /**
   * Summed debits and credits per account from posted journal lines, in
   * cents, optionally limited to entries dated from..to (inclusive,
   * YYYY-MM-DD). Postgres does the adding up (account_balance_totals), so the
   * answer is one row per account however long the ledger is.
   */
  static async getAccountTotals(orgId: string, range: { from?: string; to?: string } = {}): Promise<Map<string, AccountTotals>> {
    const supabase = getSupabase();
    const rows = await fetchAllRows<{ account_id: string; debit_cents: number | string | null; credit_cents: number | string | null }>(
      (from, to) => supabase
        .rpc('account_balance_totals', {
          p_org_id: orgId,
          p_from: range.from || null,
          p_to: range.to || null,
        })
        .range(from, to),
    );

    const totals = new Map<string, AccountTotals>();
    for (const row of rows) {
      totals.set(row.account_id, {
        debitCents: Math.round(Number(row.debit_cents) || 0),
        creditCents: Math.round(Number(row.credit_cents) || 0),
      });
    }
    return totals;
  }

  /**
   * Computes each account's current balance in cents from posted journal
   * lines, in the account's normal-balance direction (debit for
   * ASSET/COGS/EXPENSE, credit for LIABILITY/EQUITY/INCOME).
   */
  static async getAccountBalances(orgId: string, range: { from?: string; to?: string } = {}): Promise<Map<string, number>> {
    const supabase = getSupabase();
    const [totals, accounts] = await Promise.all([
      this.getAccountTotals(orgId, range),
      fetchAllRows<{ id: string; type: string }>((from, to) => supabase
        .from('accounts')
        .select('id, type')
        .eq('org_id', orgId)
        .order('id')
        .range(from, to)),
    ]);

    return new Map(accounts.map((account) => [account.id, normalBalance(account.type, totals.get(account.id))]));
  }
}
