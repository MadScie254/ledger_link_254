/**
 * The cash count sheet: Kenyan notes and coins counted after a service, and
 * the total they come to. The database adds the same counts up again
 * (private.count_total_cents) and refuses a total that does not match.
 */

export interface Denomination {
  /** Face value in shillings. */
  value: number;
  kind: 'note' | 'coin';
}

export const DENOMINATIONS: Denomination[] = [
  { value: 1000, kind: 'note' }, { value: 500, kind: 'note' }, { value: 200, kind: 'note' },
  { value: 100, kind: 'note' }, { value: 50, kind: 'note' },
  { value: 20, kind: 'coin' }, { value: 10, kind: 'coin' }, { value: 5, kind: 'coin' }, { value: 1, kind: 'coin' },
];

export type Counts = Record<string, number>;

/** How many of each note or coin, from what was typed; blanks are nothing. */
export function readCounts(typed: Record<string, string | number | undefined>): { counts: Counts; problem: string | null } {
  const counts: Counts = {};
  for (const { value } of DENOMINATIONS) {
    const text = String(typed[String(value)] ?? '').trim();
    if (!text) continue;
    if (!/^\d{1,6}$/.test(text)) return { counts: {}, problem: `Count the KES ${value} ${value >= 50 ? 'notes' : 'coins'} in whole numbers.` };
    const count = Number(text);
    if (count > 0) counts[String(value)] = count;
  }
  return { counts, problem: null };
}

/** The counts as cents. */
export function countTotalCents(counts: Counts): number {
  return DENOMINATIONS.reduce((sum, { value }) => sum + (counts[String(value)] || 0) * value * 100, 0);
}

/** The sentence a banking shows: what reached the bank against what was counted. */
export function bankingVariance(countedCents: number, bankedCents: number): { varianceCents: number; sentence: string } {
  const varianceCents = bankedCents - countedCents;
  const kes = (cents: number) => `KES ${(Math.abs(cents) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (varianceCents === 0) return { varianceCents, sentence: 'The bank received what was counted.' };
  return varianceCents < 0
    ? { varianceCents, sentence: `The bank received ${kes(varianceCents)} less than was counted. The shortfall posts to bank charges (6400).` }
    : { varianceCents, sentence: `The bank received ${kes(varianceCents)} more than was counted. The surplus posts against bank charges (6400).` };
}
