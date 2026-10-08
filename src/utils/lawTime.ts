/** Round once, exactly as Postgres round(numeric) does for positive amounts. */
export function lawTimeAmountCents(hours: number, rateCents: number): number {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24
    || !Number.isInteger(rateCents) || rateCents < 0
    || !Number.isSafeInteger(rateCents)) {
    throw new Error('Enter valid hours and a whole-cent hourly rate.');
  }
  const amount = Math.round(hours * rateCents);
  if (!Number.isSafeInteger(amount)) throw new Error('The time amount is too large.');
  return amount;
}
