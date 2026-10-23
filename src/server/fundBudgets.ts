import { budgetPeriodRange, fiscalYearStartMonth } from '../utils/budgetPeriods';
import { UserError } from './errors';
import { ChurchReportService } from './churchReports';
import { getSupabase } from './supabase';

interface FundBudgetInput { incomeTargetCents: number; expenseLimitCents: number }

async function period(orgId: string, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError('Choose a financial year from 2000 to 2100.');
  const { data, error } = await getSupabase().from('organizations')
    .select('edition,fiscal_year_start').eq('id', orgId).maybeSingle();
  if (error) throw error;
  if (data?.edition !== 'church') throw new UserError('Fund budgets belong to a Kundi church organization.', 403);
  const month = fiscalYearStartMonth(data.fiscal_year_start) + 1;
  return budgetPeriodRange('YEARLY', `${year}-${String(month).padStart(2, '0')}-15`, data.fiscal_year_start);
}

export class FundBudgetService {
  static async list(orgId: string, year: number, asOf?: string) {
    const range = await period(orgId, year);
    if (asOf && (asOf < range.from || asOf > range.to)) throw new UserError('The report date must fall within this financial year.');
    const supabase = getSupabase();
    const [funds, budgets] = await Promise.all([
      ChurchReportService.fundRows(orgId, range.from, asOf || range.to),
      supabase.from('church_fund_budgets').select('id,fund_id,income_target_cents,expense_limit_cents')
        .eq('org_id', orgId).eq('period_start', range.from).eq('period_end', range.to),
    ]);
    if (budgets.error) throw budgets.error;
    const byFund = new Map((budgets.data ?? []).map((row) => [row.fund_id, row]));
    return {
      year, periodStart: range.from, periodEnd: range.to, asOf: asOf || range.to,
      funds: funds.map((fund) => {
        const budget = byFund.get(fund.fundId);
        const incomeTargetCents = Number(budget?.income_target_cents ?? 0);
        const expenseLimitCents = Number(budget?.expense_limit_cents ?? 0);
        return { ...fund, budgetId: budget?.id ?? null, incomeTargetCents, expenseLimitCents,
          incomeVarianceCents: fund.incomeCents - incomeTargetCents,
          expenseRemainingCents: expenseLimitCents - fund.expenseCents };
      }),
    };
  }

  static async save(orgId: string, actor: string, fundId: string, year: number, input: FundBudgetInput) {
    const range = await period(orgId, year);
    if (![input.incomeTargetCents, input.expenseLimitCents].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) {
      throw new UserError('Fund budget amounts must be whole, non-negative cents.');
    }
    const supabase = getSupabase();
    const [membership, fund] = await Promise.all([
      supabase.from('memberships').select('role').eq('org_id', orgId).eq('user_id', actor).maybeSingle(),
      supabase.from('funds').select('id,is_active').eq('org_id', orgId).eq('id', fundId).maybeSingle(),
    ]);
    if (membership.error) throw membership.error;
    if (!['owner', 'admin'].includes(membership.data?.role ?? '')) throw new UserError('Only an owner or admin can set a fund budget.', 403);
    if (fund.error) throw fund.error;
    if (!fund.data) throw new UserError('Fund not found in this church.', 404);
    if (!fund.data.is_active) throw new UserError('A closed fund cannot receive a new budget.', 409);
    const values = { income_target_cents: input.incomeTargetCents, expense_limit_cents: input.expenseLimitCents };
    const existing = await supabase.from('church_fund_budgets').select('id')
      .eq('org_id', orgId).eq('fund_id', fundId).eq('period_start', range.from).maybeSingle();
    if (existing.error) throw existing.error;
    const saved = existing.data
      ? await supabase.from('church_fund_budgets').update(values).eq('org_id', orgId).eq('id', existing.data.id).select('id').single()
      : await supabase.from('church_fund_budgets').insert({ org_id: orgId, fund_id: fundId,
        period_start: range.from, period_end: range.to, created_by: actor, ...values }).select('id').single();
    if (saved.error) throw saved.error;
    const audit = await supabase.from('audit_logs').insert({ org_id: orgId, user_id: actor,
      action: existing.data ? 'UPDATE' : 'CREATE', resource_type: 'CHURCH_FUND_BUDGET', resource_id: saved.data.id,
      details: { fundId, periodStart: range.from, periodEnd: range.to, ...input } });
    if (audit.error) throw audit.error;
    return { id: saved.data.id, periodStart: range.from, periodEnd: range.to };
  }
}
