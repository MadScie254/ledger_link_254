export type BudgetPeriod = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function utcDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/** Month index (0-11) of the financial year's first month; January when unknown. */
export function fiscalYearStartMonth(value: string | null | undefined): number {
  const index = MONTH_NAMES.indexOf((value || '').trim().toLowerCase());
  return index === -1 ? 0 : index;
}

/**
 * The dates a budget measures spending over, as of `today` (YYYY-MM-DD):
 * this calendar month, this quarter of the financial year, or this financial
 * year. Quarters and years start in the company's financial-year month.
 */
export function budgetPeriodRange(
  period: BudgetPeriod,
  today: string,
  fiscalYearStart?: string | null,
): { from: string; to: string } {
  const match = today.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error('The budget date must use YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;

  if (period === 'MONTHLY') {
    return { from: utcDate(year, month, 1), to: utcDate(year, month + 1, 0) };
  }

  const startMonth = fiscalYearStartMonth(fiscalYearStart);
  const monthsIntoYear = (month - startMonth + 12) % 12;
  const length = period === 'QUARTERLY' ? 3 : 12;
  const monthsIntoPeriod = period === 'QUARTERLY' ? monthsIntoYear % 3 : monthsIntoYear;
  // Date.UTC rolls negative or overflowing months into the right year.
  const firstMonth = month - monthsIntoPeriod;
  return { from: utcDate(year, firstMonth, 1), to: utcDate(year, firstMonth + length, 0) };
}
