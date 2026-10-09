import { DEFAULT_TIME_ZONE } from './dates.ts';

const pad = (value: number) => String(value).padStart(2, '0');

/** The wall-clock parts of an instant in a time zone. */
function partsIn(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Minutes the zone is ahead of UTC at an instant: 180 for Nairobi. */
function offsetMinutes(utcMs: number, timeZone: string) {
  const p = partsIn(new Date(utcMs), timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs) / 60000);
}

/**
 * A court time typed as the firm's wall clock ("2026-10-15T09:00") as an
 * ISO timestamp with that zone's offset ("2026-10-15T09:00:00+03:00").
 */
export function zonedLocalToIso(local: string, timeZone: string | null | undefined = DEFAULT_TIME_ZONE): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error('Enter the date and time.');
  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  const zone = timeZone || DEFAULT_TIME_ZONE;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Twice, so a time near a daylight-saving change takes that day's offset.
  const offset = offsetMinutes(naive - offsetMinutes(naive, zone) * 60000, zone);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${local.slice(0, 10)}T${local.slice(11, 16)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** An instant as the firm's wall clock: date (YYYY-MM-DD) and time (HH:mm). */
export function zonedParts(iso: string, timeZone: string | null | undefined = DEFAULT_TIME_ZONE) {
  const p = partsIn(new Date(iso), timeZone || DEFAULT_TIME_ZONE);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** "15/10/2026 09:00" in the firm's zone. */
export function printedDateTime(iso: string, timeZone?: string | null): string {
  const { date, time } = zonedParts(iso, timeZone);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`;
}
