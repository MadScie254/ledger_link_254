import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';

const ACCOUNT_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE']);
const CREDIT_NORMAL_TYPES = new Set(['LIABILITY', 'EQUITY', 'INCOME']);

/**
 * Accounts the posting workflows look up by code: they cannot be switched
 * off, and receivables and VAT can never be money accounts.
 */
export const SYSTEM_ACCOUNT_CODES = new Set(['1000', '1100', '1150', '2000', '2100', '2110', '2120', '2130', '2140', '6100', '6110']);
const NEVER_MONEY_CODES = new Set(['1100', '1150']);

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
  parentId?: string | null;
  currency?: string;
  isBankAccount?: boolean;
  description?: string;
}

export interface AccountUpdate {
  name?: string;
  subtype?: string | null;
  description?: string | null;
  isActive?: boolean;
  isBankAccount?: boolean;
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
    if (!/^[A-Z]{3}$/.test(currency)) throw new UserError('Account currency must be a three-letter ISO code.');
    if (input.isBankAccount && input.type !== 'ASSET') {
      throw new UserError('Only an asset account can hold money (bank, cash or M-Pesa).');
    }
    if (input.isBankAccount && NEVER_MONEY_CODES.has(input.code)) {
      throw new UserError('Receivables and recoverable VAT cannot be money accounts.');
    }

    if (input.parentId) {
      const { data: parent, error: parentError } = await supabase
        .from('accounts')
        .select('id')
        .eq('org_id', input.orgId)
        .eq('id', input.parentId)
        .maybeSingle();
      if (parentError) throw parentError;
      if (!parent) throw new UserError('The parent account does not belong to this organization.');
    }

    // The (org_id, code) unique constraint is the authority; this check only
    // gives the usual case a clearer message.
    const { data: existing, error: searchError } = await supabase
      .from('accounts')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('code', input.code)
      .limit(1);
    if (searchError) throw searchError;
    if (existing && existing.length > 0) throw new UserError(`Account code ${input.code} already exists.`, 409);

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
        is_active: true,
        is_bank_account: Boolean(input.isBankAccount),
        description: input.description || null,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    return newAccount.id;
  }

  /**
   * Renames, switches off or on, or marks an account as holding money. The
   * accounts the posting workflows depend on cannot be switched off, and an
   * account's code and type are fixed once created (its history is posted
   * under them).
   */
  static async updateAccount(orgId: string, accountId: string, input: AccountUpdate): Promise<void> {
    const supabase = getSupabase();
    const { data: account, error } = await supabase
      .from('accounts')
      .select('id, code, type, is_active')
      .eq('org_id', orgId)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!account) throw new UserError('Account not found in this organization.', 404);
    if (input.isActive === false && SYSTEM_ACCOUNT_CODES.has(account.code)) {
      throw new UserError(`Account ${account.code} is used by invoices, bills, payments or payroll and stays active.`);
    }
    if (input.isBankAccount && (account.type !== 'ASSET' || NEVER_MONEY_CODES.has(account.code))) {
      throw new UserError('Only an asset account other than receivables or recoverable VAT can hold money.');
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.subtype !== undefined) updateData.subtype = input.subtype;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.isActive !== undefined) updateData.is_active = input.isActive;
    if (input.isBankAccount !== undefined) updateData.is_bank_account = input.isBankAccount;
    if (Object.keys(updateData).length === 0) return;

    const { error: updateError } = await supabase
      .from('accounts')
      .update(updateData)
      .eq('org_id', orgId)
      .eq('id', accountId);
    if (updateError) throw updateError;
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
   * Creates many accounts in one insert, tagged with one import batch so the
   * import can be undone, and only the import. Rows with a missing code or
   * name, an unknown type, a bad currency or a code already in use are
   * counted as failed and skipped.
   */
  static async bulkCreateAccounts(orgId: string, accounts: Array<Partial<Omit<AccountInput, 'orgId'>>>): Promise<{ success: number; failed: number; accountIds: string[]; batchId: string | null }> {
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

    const batchId = crypto.randomUUID();
    const takenCodes = new Set(existing.map((row) => row.code));
    const rows: Record<string, unknown>[] = [];
    let failed = 0;
    for (const account of accounts) {
      const code = String(account?.code ?? '').trim();
      const name = String(account?.name ?? '').trim();
      const currency = String(account?.currency || baseCurrency).trim().toUpperCase();
      if (!code || !name || !ACCOUNT_TYPES.has(String(account?.type)) || !/^[A-Z]{3}$/.test(currency) || takenCodes.has(code)) {
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
        import_batch_id: batchId,
      });
    }

    if (rows.length === 0) return { success: 0, failed, accountIds: [], batchId: null };

    const { data: created, error } = await supabase
      .from('accounts')
      .insert(rows)
      .select('id');
    if (error) throw error;
    return { success: created?.length || 0, failed, accountIds: (created || []).map((row: any) => row.id), batchId };
  }

  /**
   * Undoes one import: deletes the accounts it created, unless something has
   * been posted to them since (the ledger's foreign keys refuse that).
   */
  static async undoImport(orgId: string, batchId: string): Promise<number> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('accounts')
      .delete()
      .eq('org_id', orgId)
      .eq('import_batch_id', batchId)
      .select('id');
    if (error) throw error;
    return data?.length || 0;
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

    return accounts.map(row => ({
      id: row.id,
      orgId: row.org_id,
      code: row.code,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      description: row.description ?? null,
      parentId: row.parent_id,
      isActive: row.is_active,
      isBankAccount: Boolean(row.is_bank_account),
      isSystem: SYSTEM_ACCOUNT_CODES.has(row.code),
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
