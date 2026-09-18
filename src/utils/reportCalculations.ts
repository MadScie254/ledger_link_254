export type ReportAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';

export interface ReportAccount {
  code: string;
  name: string;
  type: ReportAccountType;
  subtype?: string | null;
}

export interface ReportJournalEntry {
  id: string;
  sourceType?: string | null;
}

export interface ReportLedgerLine {
  debit: number | string | null;
  credit: number | string | null;
  account: ReportAccount;
  journalEntry?: ReportJournalEntry | null;
}

export interface ReportAmountLine {
  name: string;
  amountCents: number;
}

export interface ReportDateRange {
  start: string;
  end: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const NON_CURRENT_SUBTYPES = [
  'NON CURRENT',
  'FIXED ASSET',
  'PROPERTY',
  'PLANT',
  'EQUIPMENT',
  'INTANGIBLE',
  'LONG TERM ASSET',
  'ACCUMULATED DEPRECIATION',
];

const CASH_SUBTYPES = ['CASH', 'BANK', 'CASH EQUIVALENT', 'MOBILE MONEY'];
const FINANCING_LIABILITY_SUBTYPES = ['NON CURRENT', 'LONG TERM', 'LOAN', 'BORROWING', 'LEASE'];

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function monthRange(year: number, monthIndex: number): ReportDateRange {
  return {
    start: dateOnly(utcDate(year, monthIndex, 1)),
    end: dateOnly(utcDate(year, monthIndex + 1, 0)),
  };
}

function normalizeMetadata(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function numericCode(code: string): number | null {
  const match = code.trim().match(/^\d+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function cents(value: number | string | null): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function debitMinusCredit(line: ReportLedgerLine): number {
  return cents(line.debit) - cents(line.credit);
}

function rounded(value: number): number {
  return Math.round(value);
}

function addToMap(map: Map<string, { code: string; amountCents: number }>, account: ReportAccount, amount: number): void {
  const key = `${account.code}\u0000${account.name}`;
  const existing = map.get(key);
  if (existing) {
    existing.amountCents += amount;
  } else {
    map.set(key, { code: account.code, amountCents: amount });
  }
}

function accountMapRows(map: Map<string, { code: string; amountCents: number }>): ReportAmountLine[] {
  return [...map.entries()]
    .map(([key, value]) => ({
      code: value.code,
      name: key.split('\u0000')[1],
      amountCents: rounded(value.amountCents),
    }))
    .filter((row) => row.amountCents !== 0)
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name))
    .map(({ name, amountCents }) => ({ name, amountCents }));
}

/** Resolve the labels emitted by the report controls, plus YYYY-MM API periods. */
export function resolveReportDateRange(label: string, now: Date = new Date()): ReportDateRange {
  const value = label.trim();
  const normalized = value.toLowerCase().replace(/\s+/g, ' ');
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (normalized === 'this month') return monthRange(year, month);

  if (normalized === 'this quarter') {
    const quarterStart = Math.floor(month / 3) * 3;
    return {
      start: dateOnly(utcDate(year, quarterStart, 1)),
      end: dateOnly(utcDate(year, quarterStart + 3, 0)),
    };
  }

  if (normalized === 'this year-to-date' || normalized === 'this year to date') {
    return { start: `${year}-01-01`, end: dateOnly(now) };
  }

  if (normalized === 'last year' || normalized === 'last financial year') {
    return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
  }

  const isoMonth = value.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) {
    const parsedMonth = Number(isoMonth[2]);
    if (parsedMonth >= 1 && parsedMonth <= 12) return monthRange(Number(isoMonth[1]), parsedMonth - 1);
  }

  const namedMonth = value.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (namedMonth) {
    const monthIndex = MONTHS.indexOf(namedMonth[1].toLowerCase() as (typeof MONTHS)[number]);
    if (monthIndex >= 0) return monthRange(Number(namedMonth[2]), monthIndex);
  }

  const quarter = value.match(/^Q([1-4])\s+(\d{4})$/i);
  if (quarter) {
    const quarterStart = (Number(quarter[1]) - 1) * 3;
    const quarterYear = Number(quarter[2]);
    return {
      start: dateOnly(utcDate(quarterYear, quarterStart, 1)),
      end: dateOnly(utcDate(quarterYear, quarterStart + 3, 0)),
    };
  }

  throw new Error(`Unsupported report period: ${label}`);
}

export function normalizeAsOfDate(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match) throw new Error('The balance-sheet date must use YYYY-MM-DD.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = utcDate(year, month - 1, day);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('The balance-sheet date is invalid.');
  }
  return dateOnly(parsed);
}

export function isNonCurrentAsset(account: ReportAccount): boolean {
  if (account.type !== 'ASSET') return false;
  const subtype = normalizeMetadata(account.subtype);
  if (NON_CURRENT_SUBTYPES.some((value) => subtype.includes(value))) return true;

  const code = numericCode(account.code);
  return code !== null && code >= 1500 && code < 2000;
}

export function isCashAccount(account: ReportAccount): boolean {
  if (account.type !== 'ASSET') return false;
  const subtype = normalizeMetadata(account.subtype);
  if (CASH_SUBTYPES.some((value) => subtype.includes(value))) return true;

  const code = numericCode(account.code);
  return code !== null && code >= 1000 && code < 1100;
}

function isFinancingLiability(account: ReportAccount): boolean {
  if (account.type !== 'LIABILITY') return false;
  const subtype = normalizeMetadata(account.subtype);
  if (FINANCING_LIABILITY_SUBTYPES.some((value) => subtype.includes(value))) return true;

  const code = numericCode(account.code);
  return code !== null && code >= 2500 && code < 3000;
}

export function aggregateProfitAndLoss(lines: ReportLedgerLine[]): {
  income: ReportAmountLine[];
  costOfSales: ReportAmountLine[];
  expenses: ReportAmountLine[];
} {
  const income = new Map<string, { code: string; amountCents: number }>();
  const costOfSales = new Map<string, { code: string; amountCents: number }>();
  const expenses = new Map<string, { code: string; amountCents: number }>();

  for (const line of lines) {
    const normalDebitBalance = debitMinusCredit(line);
    if (line.account.type === 'INCOME') addToMap(income, line.account, -normalDebitBalance);
    if (line.account.type === 'COGS') addToMap(costOfSales, line.account, normalDebitBalance);
    if (line.account.type === 'EXPENSE') addToMap(expenses, line.account, normalDebitBalance);
  }

  return {
    income: accountMapRows(income),
    costOfSales: accountMapRows(costOfSales),
    expenses: accountMapRows(expenses),
  };
}

export function aggregateBalanceSheet(lines: ReportLedgerLine[]): {
  currentAssets: ReportAmountLine[];
  nonCurrentAssets: ReportAmountLine[];
  currentLiabilities: ReportAmountLine[];
  equity: ReportAmountLine[];
} {
  const currentAssets = new Map<string, { code: string; amountCents: number }>();
  const nonCurrentAssets = new Map<string, { code: string; amountCents: number }>();
  const liabilities = new Map<string, { code: string; amountCents: number }>();
  const equity = new Map<string, { code: string; amountCents: number }>();
  let unclosedEarnings = 0;

  for (const line of lines) {
    const normalDebitBalance = debitMinusCredit(line);
    if (line.account.type === 'ASSET') {
      addToMap(isNonCurrentAsset(line.account) ? nonCurrentAssets : currentAssets, line.account, normalDebitBalance);
    } else if (line.account.type === 'LIABILITY') {
      addToMap(liabilities, line.account, -normalDebitBalance);
    } else if (line.account.type === 'EQUITY') {
      addToMap(equity, line.account, -normalDebitBalance);
    } else if (line.account.type === 'INCOME') {
      unclosedEarnings -= normalDebitBalance;
    } else if (line.account.type === 'COGS' || line.account.type === 'EXPENSE') {
      unclosedEarnings -= normalDebitBalance;
    }
  }

  const equityRows = accountMapRows(equity);
  if (rounded(unclosedEarnings) !== 0) {
    equityRows.push({ name: 'Current-period earnings (unclosed)', amountCents: rounded(unclosedEarnings) });
  }

  return {
    currentAssets: accountMapRows(currentAssets),
    nonCurrentAssets: accountMapRows(nonCurrentAssets),
    currentLiabilities: accountMapRows(liabilities),
    equity: equityRows,
  };
}

type CashFlowSection = 'operating' | 'investing' | 'financing';

function counterpartSection(account: ReportAccount): CashFlowSection {
  if (account.type === 'ASSET' && isNonCurrentAsset(account)) return 'investing';
  if (account.type === 'EQUITY' || isFinancingLiability(account)) return 'financing';
  return 'operating';
}

function entrySection(lines: ReportLedgerLine[]): CashFlowSection {
  const scores: Record<CashFlowSection, number> = { operating: 0, investing: 0, financing: 0 };
  for (const line of lines) {
    if (isCashAccount(line.account)) continue;
    scores[counterpartSection(line.account)] += Math.abs(debitMinusCredit(line));
  }

  if (scores.investing >= scores.financing && scores.investing > scores.operating) return 'investing';
  if (scores.financing > scores.investing && scores.financing > scores.operating) return 'financing';
  return 'operating';
}

function entryLabel(lines: ReportLedgerLine[], section: CashFlowSection): string {
  const names = [...new Set(
    lines
      .filter((line) => !isCashAccount(line.account) && counterpartSection(line.account) === section)
      .map((line) => line.account.name),
  )].sort();
  return names.length > 0 ? names.join(', ') : 'Other cash movement';
}

/**
 * Builds an indirect cash-flow statement. Operating cash starts with net
 * income and working-capital changes, then reconciles to actual cash-account
 * movements. Investing and financing are classified from the dominant
 * non-cash counterpart on each cash-bearing journal entry.
 */
export function aggregateCashFlow(
  periodLines: ReportLedgerLine[],
  openingLines: ReportLedgerLine[],
): {
  operating: ReportAmountLine[];
  investing: ReportAmountLine[];
  financing: ReportAmountLine[];
  beginningCashCents: number;
} {
  const pnl = aggregateProfitAndLoss(periodLines);
  const total = (rows: ReportAmountLine[]) => rows.reduce((sum, row) => sum + row.amountCents, 0);
  const netIncome = total(pnl.income) - total(pnl.costOfSales) - total(pnl.expenses);

  const workingCapital = new Map<string, { code: string; amountCents: number }>();
  for (const line of periodLines) {
    const account = line.account;
    if (account.type === 'ASSET' && !isCashAccount(account) && !isNonCurrentAsset(account)) {
      addToMap(workingCapital, account, -debitMinusCredit(line));
    } else if (account.type === 'LIABILITY' && !isFinancingLiability(account)) {
      addToMap(workingCapital, account, -debitMinusCredit(line));
    }
  }

  const entries = new Map<string, ReportLedgerLine[]>();
  periodLines.forEach((line, index) => {
    const entryId = line.journalEntry?.id || `ungrouped-${index}`;
    const entryLines = entries.get(entryId);
    if (entryLines) entryLines.push(line);
    else entries.set(entryId, [line]);
  });

  let operatingCash = 0;
  const investing = new Map<string, number>();
  const financing = new Map<string, number>();

  for (const entryLines of entries.values()) {
    const cashMovement = rounded(entryLines.reduce(
      (sum, line) => sum + (isCashAccount(line.account) ? debitMinusCredit(line) : 0),
      0,
    ));
    if (cashMovement === 0) continue;

    const section = entrySection(entryLines);
    if (section === 'operating') {
      operatingCash += cashMovement;
    } else {
      const label = entryLabel(entryLines, section);
      const map = section === 'investing' ? investing : financing;
      map.set(label, (map.get(label) || 0) + cashMovement);
    }
  }

  const operating: ReportAmountLine[] = [];
  if (netIncome !== 0) operating.push({ name: 'Net income', amountCents: netIncome });
  const workingCapitalRows = accountMapRows(workingCapital).map((row) => ({
    name: `Change in ${row.name}`,
    amountCents: row.amountCents,
  }));
  operating.push(...workingCapitalRows);

  const calculatedOperating = operating.reduce((sum, row) => sum + row.amountCents, 0);
  const reconciliation = rounded(operatingCash - calculatedOperating);
  if (reconciliation !== 0) {
    operating.push({ name: 'Non-cash and other operating adjustments', amountCents: reconciliation });
  }

  const cashRows = (map: Map<string, number>): ReportAmountLine[] => [...map.entries()]
    .map(([name, amountCents]) => ({ name, amountCents: rounded(amountCents) }))
    .filter((row) => row.amountCents !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const beginningCashCents = rounded(openingLines.reduce(
    (sum, line) => sum + (isCashAccount(line.account) ? debitMinusCredit(line) : 0),
    0,
  ));

  return {
    operating,
    investing: cashRows(investing),
    financing: cashRows(financing),
    beginningCashCents,
  };
}

export function aggregateTaxRows(
  invoices: Array<{ subtotal_cents: number | string | null; tax_cents: number | string | null }>,
  bills: Array<{ subtotal_cents: number | string | null; tax_cents: number | string | null }>,
): {
  standardRatedSalesCents: number;
  outputVatCents: number;
  claimablePurchasesCents: number;
  inputVatCents: number;
} {
  return {
    standardRatedSalesCents: rounded(invoices.reduce((sum, row) => sum + cents(row.subtotal_cents), 0)),
    outputVatCents: rounded(invoices.reduce((sum, row) => sum + cents(row.tax_cents), 0)),
    claimablePurchasesCents: rounded(bills.reduce((sum, row) => sum + cents(row.subtotal_cents), 0)),
    inputVatCents: rounded(bills.reduce((sum, row) => sum + cents(row.tax_cents), 0)),
  };
}
