import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { AccountService } from './accounts';
import {
  ledgerSurplusCents, monthRange, nairobiToday, reconcileFunds, sundayOnOrBefore, treasurerReport,
  type FundBalance, type TreasurerLine,
} from '../utils/churchReports';

const toFund = (row: any): FundBalance => ({
  fundId: row.fund_id, code: row.code, name: row.name, restricted: Boolean(row.restricted), isActive: Boolean(row.is_active),
  openingCents: Number(row.opening_cents) || 0, incomeCents: Number(row.income_cents) || 0,
  expenseCents: Number(row.expense_cents) || 0, closingCents: Number(row.closing_cents) || 0,
});

export class ChurchReportService {
  static async fundRows(orgId: string, from: string, to: string): Promise<FundBalance[]> {
    const { data, error } = await getSupabase().rpc('fund_balances', { p_org_id: orgId, p_from: from, p_to: to });
    if (error) throw error;
    return (data ?? []).map(toFund);
  }

  /** What is waiting: M-Pesa receipts in the queue and counted cash not yet banked. */
  static async waiting(orgId: string) {
    const supabase = getSupabase();
    const [receipts, collections] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase.from('mpesa_receipts').select('amount_cents')
        .eq('org_id', orgId).eq('status', 'UNMATCHED').order('id').range(from, to)),
      fetchAllRows<any>((from, to) => supabase.from('collections').select('status,total_cents')
        .eq('org_id', orgId).in('status', ['AWAITING_SECOND_COUNT', 'COUNTED']).order('id').range(from, to)),
    ]);
    const sum = (rows: any[]) => rows.reduce((total, row) => total + (Number(row.amount_cents ?? row.total_cents) || 0), 0);
    const counted = collections.filter((row) => row.status === 'COUNTED');
    const awaiting = collections.filter((row) => row.status === 'AWAITING_SECOND_COUNT');
    return {
      unmatchedCount: receipts.length,
      unmatchedCents: sum(receipts),
      cashNotBankedCents: sum(counted),
      countsNotBanked: counted.length,
      awaitingSecondCount: awaiting.length,
      awaitingSecondCountCents: sum(awaiting),
    };
  }

  /** The monthly treasurer's report for YYYY-MM. */
  static async treasurer(orgId: string, month: string) {
    const range = monthRange(month);
    if (!range) throw new UserError('Choose a month as YYYY-MM.');
    const supabase = getSupabase();
    const [lines, funds, waiting] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase.rpc('church_treasurer_lines', { p_org_id: orgId, p_from: range.from, p_to: range.to })
        .range(from, to)),
      ChurchReportService.fundRows(orgId, range.from, range.to),
      ChurchReportService.waiting(orgId),
    ]);
    const mapped: TreasurerLine[] = lines.map((line) => ({
      kind: line.kind, fundId: line.fund_id, accountId: line.account_id, accountCode: line.account_code,
      accountName: line.account_name, amountCents: Number(line.amount_cents) || 0,
    }));
    return {
      month,
      ...treasurerReport(range, mapped, funds, waiting),
      funds,
      awaitingSecondCount: waiting.awaitingSecondCount,
    };
  }

  /**
   * Fund balances for a period, and whether they come to the ledger: the
   * funds' closing total against the surplus in the trial balance to the
   * same day, and their movement against the period's income less expenses.
   */
  static async fundBalances(orgId: string, from: string, to: string) {
    if (from > to) throw new UserError('The period starts after it ends.');
    const supabase = getSupabase();
    const [funds, toDate, period, accounts] = await Promise.all([
      ChurchReportService.fundRows(orgId, from, to),
      AccountService.getAccountTotals(orgId, { to }),
      AccountService.getAccountTotals(orgId, { from, to }),
      fetchAllRows<{ id: string; type: string }>((start, end) => supabase.from('accounts').select('id,type')
        .eq('org_id', orgId).order('id').range(start, end)),
    ]);
    const typed = (totals: Map<string, { debitCents: number; creditCents: number }>) =>
      accounts.map((account) => ({ type: account.type, ...(totals.get(account.id) ?? { debitCents: 0, creditCents: 0 }) }));
    return {
      from, to, funds,
      reconciliation: reconcileFunds(funds, {
        surplusToDateCents: ledgerSurplusCents(typed(toDate)),
        periodSurplusCents: ledgerSurplusCents(typed(period)),
      }),
    };
  }

  /** The church Home: this Sunday's giving, the month so far by fund, the queue and cash not banked. */
  static async dashboard(orgId: string, today = nairobiToday()) {
    const supabase = getSupabase();
    const sunday = sundayOnOrBefore(today);
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = sunday < monthStart ? sunday : monthStart;
    const [gifts, funds, waiting] = await Promise.all([
      fetchAllRows<any>((start, end) => supabase.from('contributions').select('fund_id,amount_cents,method,received_on')
        .eq('org_id', orgId).gte('received_on', from).lte('received_on', today).order('id').range(start, end)),
      ChurchReportService.fundRows(orgId, monthStart, today),
      ChurchReportService.waiting(orgId),
    ]);
    const sundayGifts = gifts.filter((gift) => gift.received_on === sunday);
    const byMethod: Record<string, number> = {};
    for (const gift of sundayGifts) byMethod[gift.method] = (byMethod[gift.method] || 0) + Number(gift.amount_cents);
    const monthGifts = gifts.filter((gift) => gift.received_on >= monthStart);
    const byFund = new Map<string, number>();
    for (const gift of monthGifts) byFund.set(gift.fund_id, (byFund.get(gift.fund_id) || 0) + Number(gift.amount_cents));
    return {
      today, sunday, monthStart,
      sundayGivingCents: sundayGifts.reduce((sum, gift) => sum + Number(gift.amount_cents), 0),
      sundayByMethod: byMethod,
      monthByFund: funds.map((fund) => ({ fundId: fund.fundId, code: fund.code, name: fund.name, restricted: fund.restricted, givingCents: byFund.get(fund.fundId) || 0 })),
      monthGivingCents: monthGifts.reduce((sum, gift) => sum + Number(gift.amount_cents), 0),
      ...waiting,
    };
  }
}
