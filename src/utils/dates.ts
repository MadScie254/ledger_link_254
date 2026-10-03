/**
 * Calendar dates as the business sees them. Postings, voids and aging use the
 * organization's own day, not the server's: between midnight and 03:00 in
 * Nairobi the server's UTC date is still yesterday.
 */

export const DEFAULT_TIME_ZONE = 'Africa/Nairobi';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** True when the zone is one the runtime knows, such as Africa/Nairobi. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  const zone = timeZone && isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDaysIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
