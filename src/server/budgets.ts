import { getSupabase } from './supabase';
import { AccountService } from './accounts';
import { fetchAllRows } from './pagination';
import { budgetPeriodRange, type BudgetPeriod } from '../utils/budgetPeriods';

export interface BudgetInput {
  orgId: string;
  accountId: string;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  limitCents: number;
  createdBy?: string;
}

export class BudgetService {
  static async getBudgets(orgId: string) {
    const supabase = getSupabase();
    const [data, organization] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('budgets')
        .select('id, account_id, period, limit_cents, accounts!inner(name, code)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true })
        .order('id')
        .range(from, to)),
      supabase.from('organizations').select('fiscal_year_start').eq('id', orgId).maybeSingle(),
    ]);
    if (organization.error) throw organization.error;

    // Each budget measures spending within its own period (this month, this
    // quarter or this financial year), not the account's all-time balance.
    const today = new Date().toISOString().slice(0, 10);
    const periods = [...new Set<BudgetPeriod>(data.map((row: any) => row.period))];
    const ranges = new Map(periods.map((period) => [period, budgetPeriodRange(period, today, organization.data?.fiscal_year_start)]));
    const balancesByPeriod = new Map(await Promise.all(
      periods.map(async (period) => [period, await AccountService.getAccountBalances(orgId, ranges.get(period)!)] as const),
    ));

    return data.map((row: any) => ({
      id: row.id,
      accountId: row.account_id,
      categoryName: row.accounts?.name || 'Unknown Account',
      accountCode: row.accounts?.code,
      period: row.period,
      periodStart: ranges.get(row.period)?.from,
      periodEnd: ranges.get(row.period)?.to,
      limitCents: row.limit_cents,
      // EXPENSE accounts have a debit normal balance, which getAccountBalances
      // returns as a positive number for money spent.
      spentCents: Math.max(balancesByPeriod.get(row.period)?.get(row.account_id) || 0, 0)
    }));
  }

  static async createBudget(input: BudgetInput): Promise<string> {
    const supabase = getSupabase();
    if (input.limitCents < 0) throw new Error('Budget limit cannot be negative.');

    const { data, error } = await supabase
      .from('budgets')
      .insert({
        org_id: input.orgId,
        account_id: input.accountId,
        period: input.period,
        limit_cents: input.limitCents,
        created_by: input.createdBy || null
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('A budget already exists for this account and period.');
      }
      throw error;
    }

    return data.id;
  }

  static async updateBudget(orgId: string, id: string, limitCents: number): Promise<void> {
    const supabase = getSupabase();
    if (limitCents < 0) throw new Error('Budget limit cannot be negative.');

    const { error } = await supabase
      .from('budgets')
      .update({ limit_cents: limitCents })
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;
  }

  static async deleteBudget(orgId: string, id: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) throw error;
  }
}
