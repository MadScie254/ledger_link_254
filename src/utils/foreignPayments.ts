/**
 * A foreign-currency invoice or bill settled at the day's rate: the share
 * of its balance cleared at the rate it was booked, and the exchange gain
 * or loss against what the money came to in the base currency. Matches
 * receive_invoice_payment_at_rate and pay_bill_at_rate
 * (20261009000800_realized_fx.sql). Rates are foreign units per base unit,
 * as documents store them.
 */
export interface ForeignBalance {
  /** What is still owed in the document's currency, in cents. */
  foreignDueCents: number;
  /** The same, in the base currency at the booked rate. */
  baseDueCents: number;
  /** The booked rate: foreign units per base unit. */
  bookedRate: number;
}

/** The base-currency share cleared by settling foreignCents. */
export function bookedShareCents(balance: ForeignBalance, foreignCents: number): number {
  if (foreignCents >= balance.foreignDueCents) return balance.baseDueCents;
  return Math.min(Math.round(foreignCents / balance.bookedRate), balance.baseDueCents);
}

/**
 * The exchange result in base cents: positive is a gain. On an invoice,
 * receiving more than the booked share is a gain; on a bill, paying less is.
 */
export function realizedFxCents(side: 'invoice' | 'bill', bookedCents: number, baseCents: number): number {
  return side === 'invoice' ? baseCents - bookedCents : bookedCents - baseCents;
}

/** Base cents for foreign cents at a day's rate given as base units per foreign unit (KES per USD). */
export function baseAtRate(foreignCents: number, basePerForeign: number): number {
  return Math.round(foreignCents * basePerForeign);
}
