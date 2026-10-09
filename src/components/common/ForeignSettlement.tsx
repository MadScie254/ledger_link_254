import { centsFromAmountText } from '../../utils/salesOrders';
import { baseAtRate, bookedShareCents, realizedFxCents, type ForeignBalance } from '../../utils/foreignPayments';
import { Amount } from '../ledger/Amount';
import { Field } from '../ledger/Dialog';

export interface Settlement {
  /** Amount settled in the document's currency, as typed. */
  foreign: string;
  /** The day's rate, base units per foreign unit (KES per USD), as typed. */
  rate: string;
  /** What it came to in the base currency, as typed. */
  base: string;
}

/** What is still owed on a foreign-currency invoice or bill, or null for a base-currency one. */
export function foreignBalanceOf(document: any, baseCurrency: string): ForeignBalance | null {
  if (!document || String(document.currency || baseCurrency).toUpperCase() === baseCurrency.toUpperCase()) return null;
  const bookedRate = Number(document.exchangeRate) || 0;
  if (bookedRate <= 0) return null;
  const baseDueCents = Number(document.amountDueCents) || 0;
  const payments = (document.payments || []) as any[];
  const foreignDueCents = document.foreignAmountCents != null && Array.isArray(document.payments)
    ? Number(document.foreignAmountCents) - payments.filter((payment) => !payment.reversedAt)
      .reduce((sum, payment) => sum + (Number(payment.foreignAmountCents) || 0), 0)
    : Math.round(baseDueCents * bookedRate);
  return { foreignDueCents: Math.max(foreignDueCents, 0), baseDueCents, bookedRate };
}

export function settlementCents(value: Settlement): { foreignCents: number; baseCents: number; problem: string | null } {
  const foreignCents = centsFromAmountText(value.foreign);
  const baseCents = centsFromAmountText(value.base);
  if (!foreignCents) return { foreignCents: 0, baseCents: 0, problem: 'Enter how much of the document this settles, in its currency.' };
  if (!baseCents) return { foreignCents: 0, baseCents: 0, problem: 'Enter what it came to in the base currency on the day.' };
  return { foreignCents, baseCents, problem: null };
}

/**
 * Settling a foreign-currency document at the day's rate: the amount in its
 * currency, the rate, and what that came to in the base currency (worked
 * out from the rate, or typed from the bank's advice). Shows the exchange
 * gain or loss before anything posts.
 */
export function ForeignSettlementFields({ value, onChange, balance, currency, baseCurrency, side }: {
  value: Settlement; onChange: (value: Settlement) => void; balance: ForeignBalance;
  currency: string; baseCurrency: string; side: 'invoice' | 'bill';
}) {
  const recompute = (next: Settlement) => {
    const foreignCents = centsFromAmountText(next.foreign);
    const rate = Number(next.rate);
    return foreignCents && rate > 0 ? { ...next, base: (baseAtRate(foreignCents, rate) / 100).toFixed(2) } : next;
  };
  const foreignCents = centsFromAmountText(value.foreign) || 0;
  const baseCents = centsFromAmountText(value.base) || 0;
  const booked = foreignCents ? bookedShareCents(balance, foreignCents) : 0;
  const fx = foreignCents && baseCents ? realizedFxCents(side, booked, baseCents) : 0;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-graphite-600">
        {currency} <Amount cents={balance.foreignDueCents} currency={currency} size="xs" tone="ink" /> still owing, booked at {baseCurrency} {(1 / balance.bookedRate).toFixed(4)} to the {currency}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`${side === 'invoice' ? 'Settled' : 'Paid'} (${currency})`}>
          <input inputMode="decimal" value={value.foreign} onChange={(e) => onChange(recompute({ ...value, foreign: e.target.value }))} name="foreignAmount" />
        </Field>
        <Field label={`Rate on the day (${baseCurrency} per ${currency})`}>
          <input inputMode="decimal" value={value.rate} onChange={(e) => onChange(recompute({ ...value, rate: e.target.value }))} name="dayRate" />
        </Field>
        <Field label={`${side === 'invoice' ? 'Came to' : 'Cost'} (${baseCurrency})`} hint="From the rate, or as the bank advice shows.">
          <input inputMode="decimal" value={value.base} onChange={(e) => onChange({ ...value, base: e.target.value })} name="baseAmount" />
        </Field>
      </div>
      {foreignCents > 0 && baseCents > 0 && (
        <p className="text-[13px] text-ink-900">
          Booked at <Amount cents={booked} currency={baseCurrency} />.{' '}
          {fx === 0 ? 'No exchange difference.' : <>Exchange {fx > 0 ? 'gain' : 'loss'} of <Amount cents={Math.abs(fx)} currency={baseCurrency} />, posted to 8100.</>}
        </p>
      )}
    </div>
  );
}
