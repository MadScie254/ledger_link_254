/**
 * The Ask box. The model never writes queries and never answers from
 * memory: it picks one of the fixed questions below, the Worker runs that
 * question against the books, and the model then explains the rows it was
 * given. The rows are shown under the answer, so every figure can be checked.
 */

export type AskEdition = 'business' | 'law' | 'church';

export type QuestionParam =
  | { kind: 'period'; default: string }
  | { kind: 'month'; default: 'this_month' | 'last_month' }
  | { kind: 'int'; min: number; max: number; default: number };

export interface QuestionSpec {
  /** What the model reads when choosing. */
  description: string;
  params: Record<string, QuestionParam>;
  editions: AskEdition[];
  /** The heading shown above the rows. */
  title: string;
}

const ALL: AskEdition[] = ['business', 'law', 'church'];
const period = (fallback = 'this_month'): QuestionParam => ({ kind: 'period', default: fallback });
const limit = (fallback = 10): QuestionParam => ({ kind: 'int', min: 1, max: 25, default: fallback });

export const QUESTIONS = {
  profit_and_loss: {
    title: 'Profit and loss',
    description: 'Income, cost of sales, expenses and profit for a period, by account. Use for profit, how the business is doing, income or spending totals.',
    params: { period: period() },
    editions: ALL,
  },
  compare_months: {
    title: 'Month against the month before',
    description: 'A month against the month before it: income, expenses and profit, and the accounts that changed most. Use for comparisons, trends, what changed, up or down.',
    params: { month: { kind: 'month', default: 'this_month' } },
    editions: ALL,
  },
  expenses_by_account: {
    title: 'Spending by account',
    description: 'Where money was spent in a period: expense and cost-of-sales accounts, largest first.',
    params: { period: period(), limit: limit(12) },
    editions: ALL,
  },
  cash_position: {
    title: 'Money in bank, M-Pesa and cash',
    description: 'Balances of the bank, M-Pesa and cash accounts today. Use for how much money there is.',
    params: {},
    editions: ALL,
  },
  who_owes_us: {
    title: 'Who owes us',
    description: 'Customers or clients with unpaid invoices or fee notes, with how much is overdue and for how long.',
    params: { limit: limit() },
    editions: ALL,
  },
  overdue_invoices: {
    title: 'Overdue invoices',
    description: 'Unpaid invoices or fee notes past their due date. Optional min_days: only those at least this many days late (0-365, default 1).',
    params: { min_days: { kind: 'int', min: 0, max: 365, default: 1 }, limit: limit(15) },
    editions: ALL,
  },
  what_we_owe: {
    title: 'What we owe suppliers',
    description: 'Suppliers with unpaid bills, with how much is overdue.',
    params: { limit: limit() },
    editions: ALL,
  },
  top_customers: {
    title: 'Sales by customer',
    description: 'Customers ranked by sales in a period.',
    params: { period: period(), limit: limit() },
    editions: ['business', 'law'],
  },
  top_items: {
    title: 'Sales by item',
    description: 'Products and services ranked by sales in a period.',
    params: { period: period(), limit: limit() },
    editions: ['business'],
  },
  top_suppliers: {
    title: 'Spending by supplier',
    description: 'Suppliers ranked by what was bought from them in a period.',
    params: { period: period(), limit: limit() },
    editions: ALL,
  },
  vat_position: {
    title: 'VAT for the period',
    description: 'Output VAT on sales, input VAT on purchases and the VAT payable to KRA for a period.',
    params: { period: period() },
    editions: ['business', 'law'],
  },
  work_in_progress: {
    title: 'Unbilled work by matter',
    description: 'Billable time and office disbursements not yet on a fee note, by matter.',
    params: { limit: limit(15) },
    editions: ['law'],
  },
  client_money: {
    title: 'Client money',
    description: 'Client money held, the client bank account and whether the matter ledgers agree, today.',
    params: {},
    editions: ['law'],
  },
  fund_balances: {
    title: 'Fund balances',
    description: 'Each fund: opening balance, income, expenses and closing balance for a period. Use for funds, tithes, offerings, building fund.',
    params: { period: period() },
    editions: ['church'],
  },
  giving_by_fund: {
    title: 'Giving by fund',
    description: 'Income received into each fund in a month, by account, with M-Pesa receipts still waiting to be matched.',
    params: { month: { kind: 'month', default: 'this_month' } },
    editions: ['church'],
  },
} satisfies Record<string, QuestionSpec>;

export type QuestionName = keyof typeof QUESTIONS;

/** How a question is named in a sentence: lower case, except an opening abbreviation such as VAT. */
export function topicName(name: QuestionName): string {
  const title = QUESTIONS[name].title;
  return /^[A-Z]{2}/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

export function questionsFor(edition: AskEdition): QuestionName[] {
  return (Object.keys(QUESTIONS) as QuestionName[]).filter((name) => (QUESTIONS[name].editions as AskEdition[]).includes(edition));
}

// --- Periods --------------------------------------------------------------------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface ResolvedPeriod {
  /** What the report services accept (resolveReportDateRange). */
  range: string;
  from: string;
  to: string;
  /** How the period is named in the answer. */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function monthPeriod(year: number, month: number): ResolvedPeriod {
  return { range: `${year}-${pad(month)}`, from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay(year, month))}`, label: `${MONTH_NAMES[month - 1]} ${year}` };
}

function quarterPeriod(year: number, quarter: number): ResolvedPeriod {
  const first = (quarter - 1) * 3 + 1;
  return { range: `Q${quarter} ${year}`, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(first + 2)}-${pad(lastDay(year, first + 2))}`, label: `Q${quarter} ${year}` };
}

/**
 * A period the model chose, against today's date in the organization's
 * time zone (YYYY-MM-DD). Null when it is not one this app reports on.
 */
export function resolvePeriod(value: unknown, today: string): ResolvedPeriod | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  if (v === 'this_month') return { ...monthPeriod(year, month), label: `${MONTH_NAMES[month - 1]} ${year} so far` };
  if (v === 'last_month') return month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
  if (v === 'this_quarter') return { ...quarterPeriod(year, quarter), label: `Q${quarter} ${year} so far` };
  if (v === 'last_quarter') return quarter === 1 ? quarterPeriod(year - 1, 4) : quarterPeriod(year, quarter - 1);
  if (v === 'this_year') return { range: 'this year-to-date', from: `${year}-01-01`, to: today, label: `1 January to ${Number(today.slice(8, 10))} ${MONTH_NAMES[month - 1]} ${year}` };
  if (v === 'last_year') return { range: 'last year', from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: String(year - 1) };
  const isoMonth = /^(\d{4})_(\d{2})$/.exec(v);
  if (isoMonth) {
    const y = Number(isoMonth[1]);
    const m = Number(isoMonth[2]);
    if (m >= 1 && m <= 12 && y >= 2000 && `${y}-${pad(m)}` <= today.slice(0, 7)) return monthPeriod(y, m);
    return null;
  }
  const quarterFirst = /^q([1-4])_(\d{4})$/.exec(v);
  const yearFirst = /^(\d{4})_q([1-4])$/.exec(v);
  if (quarterFirst || yearFirst) {
    const q = Number(quarterFirst ? quarterFirst[1] : yearFirst![2]);
    const y = Number(quarterFirst ? quarterFirst[2] : yearFirst![1]);
    if (y >= 2000 && (y < year || (y === year && q <= quarter))) return quarterPeriod(y, q);
  }
  return null;
}

/** A month the model chose, as YYYY-MM, or null. */
export function resolveMonth(value: unknown, today: string): string | null {
  const resolved = resolvePeriod(value, today);
  return resolved && /^\d{4}-\d{2}$/.test(resolved.range) ? resolved.range : null;
}

/** The month before YYYY-MM. */
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${year - 1}-12` : `${year}-${pad(m - 1)}`;
}

export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// --- Choosing a question ---------------------------------------------------------------------

export type PlannedArgs = { period?: ResolvedPeriod; month?: string; limit?: number; min_days?: number };
export type AnswerLanguage = 'en' | 'sw';
export interface Plan { question: QuestionName; args: PlannedArgs; language: AnswerLanguage }

/** The prompt that asks the model to choose one question. */
export function planPrompt(edition: AskEdition, today: string): string {
  const list = questionsFor(edition).map((name) => {
    const spec = QUESTIONS[name] as QuestionSpec;
    const params = Object.keys(spec.params);
    return `- ${name}: ${spec.description}${params.length ? ` Parameters: ${params.join(', ')}.` : ''}`;
  }).join('\n');
  return [
    'You route a question about an organization\'s books to ONE of the fixed questions below. You do not answer it.',
    'Reply with JSON only: {"question": "<name>", "args": {...}, "language": "en" or "sw"}. Use only the parameters listed for that question; leave out any you are unsure of. language is "sw" when the question is in Kiswahili.',
    `Today is ${today}. A period is one of: this_month, last_month, this_quarter, last_quarter, this_year, last_year, a month as YYYY-MM, or a quarter as Q1_2026. A month is this_month, last_month or YYYY-MM.`,
    'The question may be in English or Kiswahili. If none of the questions can answer it, reply {"question": "none"}.',
    'Questions:',
    list,
  ].join('\n');
}

/** The model's choice, checked against the list; null when it chose nothing usable. */
export function parsePlan(reply: Record<string, unknown> | null, edition: AskEdition, today: string): Plan | null {
  if (!reply || typeof reply.question !== 'string') return null;
  const name = reply.question as QuestionName;
  if (!Object.hasOwn(QUESTIONS, name) || !questionsFor(edition).includes(name)) return null;
  const spec = QUESTIONS[name] as QuestionSpec;
  const raw = reply.args && typeof reply.args === 'object' && !Array.isArray(reply.args) ? reply.args as Record<string, unknown> : {};
  const args: PlannedArgs = {};
  for (const [key, param] of Object.entries(spec.params)) {
    const given = raw[key];
    if (param.kind === 'period') {
      args.period = resolvePeriod(given, today) ?? resolvePeriod(param.default, today)!;
    } else if (param.kind === 'month') {
      args.month = resolveMonth(given, today) ?? resolveMonth(param.default, today)!;
    } else {
      const number = typeof given === 'number' ? given : Number(given);
      const value = Number.isInteger(number) && number >= param.min && number <= param.max ? number : param.default;
      if (key === 'limit') args.limit = value;
      if (key === 'min_days') args.min_days = value;
    }
  }
  return { question: name, args, language: reply.language === 'sw' ? 'sw' : 'en' };
}

// --- Explaining the rows ---------------------------------------------------------------------

export interface QuestionResult {
  title: string;
  /** The period or day the figures are for, in words. */
  scope: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  /** Figures the explanation may quote, already in words, e.g. "Net profit: KES 120,000.00". */
  facts: string[];
}

/** The instructions for explaining the rows, in the language the question was asked in. */
export function answerPrompt(language: AnswerLanguage): string {
  return [
    'You explain figures from an organization\'s books to its owner or accountant, in two to four plain sentences.',
    'Use only the figures given. Do not add causes, advice or numbers that are not there, and do not round them differently.',
    'Write every amount with its currency code, as the totals do, for example KES 1,200.00.',
    'If the rows are empty, say there is nothing recorded for that period.',
    language === 'sw'
      ? 'Answer in natural Kiswahili. Where you need them, use these words: overdue "imepita tarehe ya kulipwa", debt "deni", income "mapato", expenses "matumizi". Keep names exactly as written.'
      : 'Answer in English.',
    'No exclamation marks, no headings, no bullet points.',
  ].join(' ');
}

const MAX_ROWS_FOR_MODEL = 25;

/** What the model is given to explain: the question, the facts and the rows. */
export function answerInput(question: string, result: QuestionResult): string {
  const rows = result.rows.slice(0, MAX_ROWS_FOR_MODEL).map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(' | '));
  return [
    `Question: ${question}`,
    `Report: ${result.title}, ${result.scope}`,
    ...(result.facts.length ? ['Totals:', ...result.facts.map((fact) => `- ${fact}`)] : []),
    `Columns: ${result.columns.join(' | ')}`,
    rows.length ? `Rows:\n${rows.join('\n')}` : 'Rows: none',
  ].join('\n');
}

/** The questions the Ask box offers to start with. */
export const STARTER_QUESTIONS: Record<AskEdition, string[]> = {
  business: [
    'How is the business doing this month?',
    'How did this month compare with last month?',
    'Which customers owe us money, and how overdue are they?',
    'What do we owe suppliers right now?',
    'Where did most of our money go this quarter?',
  ],
  law: [
    'How much unbilled work do we have, by matter?',
    'Which clients owe us on fee notes?',
    'How much client money are we holding, and do the ledgers agree?',
    'How did this month compare with last month?',
  ],
  church: [
    'How much came into each fund this month?',
    'What are the fund balances this year?',
    'How did this month compare with last month?',
    'What did we spend most on this quarter?',
  ],
};
