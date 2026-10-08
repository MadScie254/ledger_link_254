/**
 * The treasurer's report and fund balances, put together from the ledger
 * figures Postgres adds up (church_treasurer_lines, fund_balances). Funds
 * are the church's own view of the ledger: every income and expense line is
 * tagged to one, so the funds together must come to the ledger's surplus.
 */

export interface TreasurerLine {
  kind: 'INCOME' | 'EXPENSE' | 'MONEY';
  fundId: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  amountCents: number;
}

export interface FundBalance {
  fundId: string;
  code: string;
  name: string;
  restricted: boolean;
  isActive: boolean;
  openingCents: number;
  incomeCents: number;
  expenseCents: number;
  closingCents: number;
}

export interface FundSection {
  fundId: string;
  code: string;
  name: string;
  restricted: boolean;
  totalCents: number;
  accounts: Array<{ accountId: string; code: string; name: string; amountCents: number }>;
}

export interface TreasurerReport {
  from: string;
  to: string;
  openingCents: number;
  incomeCents: number;
  expenseCents: number;
  closingCents: number;
  incomeByFund: FundSection[];
  expensesByFund: FundSection[];
  money: Array<{ accountId: string; code: string; name: string; balanceCents: number }>;
  moneyTotalCents: number;
  unmatchedCount: number;
  unmatchedCents: number;
  cashNotBankedCents: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10" as its first and last day, or null when it is not a month. */
export function monthRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12 || year < 1900 || year > 2200) return null;
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${match[1]}-${match[2]}-01`, to: `${match[1]}-${match[2]}-${pad(last)}` };
}

/** The month a date falls in, as YYYY-MM. */
export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

/** The Sunday on or before a date: "this Sunday" for the dashboard. */
export function sundayOnOrBefore(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Today's date in Nairobi, YYYY-MM-DD. */
export function nairobiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function sections(lines: TreasurerLine[], kind: 'INCOME' | 'EXPENSE', funds: FundBalance[]): FundSection[] {
  const byFund = new Map<string, FundSection>();
  const fundById = new Map(funds.map((fund) => [fund.fundId, fund]));
  for (const line of lines) {
    if (line.kind !== kind || !line.amountCents) continue;
    const key = line.fundId ?? 'none';
    const fund = line.fundId ? fundById.get(line.fundId) : undefined;
    let section = byFund.get(key);
    if (!section) {
      section = {
        fundId: key, code: fund?.code ?? '', name: fund?.name ?? 'No fund', restricted: Boolean(fund?.restricted),
        totalCents: 0, accounts: [],
      };
      byFund.set(key, section);
    }
    section.totalCents += line.amountCents;
    section.accounts.push({ accountId: line.accountId, code: line.accountCode, name: line.accountName, amountCents: line.amountCents });
  }
  const order = new Map(funds.map((fund, index) => [fund.fundId, index]));
  return [...byFund.values()]
    .map((section) => ({ ...section, accounts: section.accounts.sort((a, b) => a.code.localeCompare(b.code)) }))
    .sort((a, b) => (order.get(a.fundId) ?? 999) - (order.get(b.fundId) ?? 999) || a.name.localeCompare(b.name));
}

export function treasurerReport(
  range: { from: string; to: string },
  lines: TreasurerLine[],
  funds: FundBalance[],
  extras: { unmatchedCount: number; unmatchedCents: number; cashNotBankedCents: number },
): TreasurerReport {
  const incomeByFund = sections(lines, 'INCOME', funds);
  const expensesByFund = sections(lines, 'EXPENSE', funds);
  const incomeCents = incomeByFund.reduce((sum, section) => sum + section.totalCents, 0);
  const expenseCents = expensesByFund.reduce((sum, section) => sum + section.totalCents, 0);
  const openingCents = funds.reduce((sum, fund) => sum + fund.openingCents, 0);
  const money = lines.filter((line) => line.kind === 'MONEY')
    .map((line) => ({ accountId: line.accountId, code: line.accountCode, name: line.accountName, balanceCents: line.amountCents }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    ...range,
    openingCents,
    incomeCents,
    expenseCents,
    closingCents: openingCents + incomeCents - expenseCents,
    incomeByFund,
    expensesByFund,
    money,
    moneyTotalCents: money.reduce((sum, account) => sum + account.balanceCents, 0),
    ...extras,
  };
}

export interface AccountTotal {
  type: string;
  debitCents: number;
  creditCents: number;
}

/** Income less expenses and cost of sales, in cents, from account totals. */
export function ledgerSurplusCents(totals: AccountTotal[]): number {
  return totals.reduce((sum, total) => {
    if (total.type === 'INCOME') return sum + total.creditCents - total.debitCents;
    if (total.type === 'EXPENSE' || total.type === 'COGS') return sum - (total.debitCents - total.creditCents);
    return sum;
  }, 0);
}

/**
 * Whether the funds come to the ledger: their closing balances together
 * against the surplus the trial balance shows up to the same day, and the
 * period's movement against the period's income less expenses.
 */
export function reconcileFunds(funds: FundBalance[], ledger: { surplusToDateCents: number; periodSurplusCents: number }) {
  const fundsClosingCents = funds.reduce((sum, fund) => sum + fund.closingCents, 0);
  const fundsPeriodCents = funds.reduce((sum, fund) => sum + fund.incomeCents - fund.expenseCents, 0);
  return {
    fundsClosingCents,
    ledgerSurplusCents: ledger.surplusToDateCents,
    closingDifferenceCents: fundsClosingCents - ledger.surplusToDateCents,
    fundsPeriodCents,
    ledgerPeriodCents: ledger.periodSurplusCents,
    periodDifferenceCents: fundsPeriodCents - ledger.periodSurplusCents,
    reconciles: fundsClosingCents === ledger.surplusToDateCents && fundsPeriodCents === ledger.periodSurplusCents,
  };
}
