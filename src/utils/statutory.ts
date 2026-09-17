import { differenceInCalendarDays } from 'date-fns';

/**
 * Kenyan statutory deadlines for the month in hand, in one place so Home and
 * Tax can never disagree.
 *
 * PAYE, NSSF and SHIF are due by the 9th, VAT by the 20th, and the Housing Levy
 * by the ninth working day. A date that lands on a weekend moves to the next
 * working day (product owner's rule, 17 September 2026). Public holidays are
 * not yet in the calendar, which the Housing Levy rule line says.
 */
export interface StatutoryDeadline {
  id: 'paye' | 'levy' | 'vat';
  label: string;
  rule: string;
  due: Date;
  view: string;
}

const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;

function nextWorkingDay(date: Date) {
  const moved = new Date(date);
  while (isWeekend(moved)) moved.setDate(moved.getDate() + 1);
  return moved;
}

function ninthWorkingDay(year: number, month: number) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(year, month, d);
    if (!isWeekend(date)) count++;
    if (count === 9) return date;
  }
  return new Date(year, month, 13);
}

export function statutoryDeadlines(today: Date = new Date()): StatutoryDeadline[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const start = new Date(y, m, today.getDate());

  const monthly = (id: 'paye' | 'vat', label: string, day: number, view: string): StatutoryDeadline => {
    let nominal = new Date(y, m, day);
    if (differenceInCalendarDays(nextWorkingDay(nominal), start) < 0) nominal = new Date(y, m + 1, day);
    const due = nextWorkingDay(nominal);
    const ordinal = day === 9 ? '9th' : '20th';
    const moved = due.getTime() !== nominal.getTime();
    return {
      id,
      label,
      due,
      view,
      rule: moved ? `The ${ordinal} is a ${nominal.getDay() === 0 ? 'Sunday' : 'Saturday'}, so due the next working day` : `Due by the ${ordinal}`,
    };
  };

  const levyThisMonth = ninthWorkingDay(y, m);
  const levy = differenceInCalendarDays(levyThisMonth, start) >= 0 ? levyThisMonth : ninthWorkingDay(y, m + 1);

  return [
    monthly('paye', 'PAYE, NSSF and SHIF returns', 9, 'Payroll'),
    { id: 'levy' as const, label: 'Housing Levy', rule: '9th working day, before public holidays', due: levy, view: 'Payroll' },
    monthly('vat', 'VAT return', 20, 'Tax'),
  ].sort((a, b) => a.due.getTime() - b.due.getTime());
}

/**
 * When the payroll returns for one pay period fall due: PAYE, NSSF and SHIF by
 * the 9th of the following month, the Housing Levy by that month's ninth
 * working day, each moved off a weekend as above.
 */
export function payrollReturnsDue(periodMonth: Date) {
  const y = periodMonth.getFullYear();
  const m = periodMonth.getMonth() + 1;
  const nominal = new Date(y, m, 9);
  return { paye: nextWorkingDay(nominal), levy: ninthWorkingDay(y, m) };
}

export function dueIn(due: Date, today: Date = new Date()) {
  const days = differenceInCalendarDays(due, today);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
