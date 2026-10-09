import { Amount } from './Amount';

interface PreviewLine { description: string; amountCents: number }

/** Live, client-side review of the document being entered. */
export function DocumentReview({ title, partyLabel, party, date, lines, subtotalCents, taxCents, totalCents, currency, totalLabel = 'Total' }: {
  title: string;
  partyLabel: string;
  party: string;
  date: string;
  lines: PreviewLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  totalLabel?: string;
}) {
  return (
    <aside className="space-y-4" aria-label="Document review">
      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm" aria-live="polite">
        <h3 className="text-[15px] font-semibold text-text">Totals</h3>
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="flex justify-between gap-3 text-text-2"><dt>Subtotal</dt><dd><Amount cents={subtotalCents} currency={currency} size="xs" tone="ink" /></dd></div>
          <div className="flex justify-between gap-3 text-text-2"><dt>VAT</dt><dd><Amount cents={taxCents} currency={currency} size="xs" tone="ink" /></dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3 text-text"><dt className="font-semibold">{totalLabel}</dt><dd><Amount cents={totalCents} currency={currency} tone="ink" /></dd></div>
        </dl>
      </section>
      <section className="rounded-xl border border-border bg-surface-2 p-4">
        <h3 className="text-[13px] font-semibold text-text">Document preview</h3>
        <p className="mt-0.5 text-[12px] text-text-3">Updates as you enter details. The saved PDF may include company details and numbering.</p>
        <div className="mt-3 min-h-60 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="font-display text-[18px] font-bold text-text">{title}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-b border-border pb-4 text-[12px]">
            <div><dt className="text-text-3">{partyLabel}</dt><dd className="mt-1 font-medium text-text">{party || 'Choose a name'}</dd></div>
            <div><dt className="text-text-3">Date</dt><dd className="mt-1 font-medium text-text">{date || 'Choose a date'}</dd></div>
          </dl>
          <ul className="divide-y divide-border text-[12px]">
            {lines.filter((line) => line.description || line.amountCents).map((line, index) => (
              <li key={index} className="flex justify-between gap-3 py-2.5"><span className="min-w-0 break-words text-text">{line.description || 'Untitled line'}</span><Amount cents={line.amountCents} currency={currency} size="xs" tone="ink" /></li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between gap-3 border-t border-border-strong pt-3 text-[13px] font-semibold text-text"><span>{totalLabel}</span><Amount cents={totalCents} currency={currency} size="sm" tone="ink" /></div>
        </div>
      </section>
    </aside>
  );
}
