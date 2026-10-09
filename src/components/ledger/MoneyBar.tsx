import { Amount } from './Amount';

export interface MoneySegment {
  id: string;
  label: string;
  cents: number;
  count: number;
  color: string;
}

/** A money summary whose segments and chips select the same list filter. */
export function MoneyBar({ segments, active, onChange, currency, label }: {
  segments: MoneySegment[];
  active: string;
  onChange: (id: string) => void;
  currency: string;
  label: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.cents), 0);
  return (
    <section aria-label={label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-text">{label}</h2>
        <span className="text-xs text-text-2">Choose a segment to filter</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-neutral-soft" role="group" aria-label={`${label} segments`}>
        {segments.map((segment) => segment.cents > 0 && <button key={segment.id} type="button" onClick={() => onChange(active === segment.id ? 'ALL' : segment.id)} aria-label={`Show ${segment.label.toLowerCase()}`} aria-pressed={active === segment.id} title={segment.label} style={{ width: `${(segment.cents / total) * 100}%`, background: segment.color }} className="h-full min-w-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text" />)}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
        {segments.map((segment) => <div key={segment.id} className="flex items-center gap-1.5"><dt className="text-text-2">{segment.label}</dt><dd><Amount cents={segment.cents} currency={currency} size="xs" tone="ink" /></dd></div>)}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter chips">
        <button type="button" aria-pressed={active === 'ALL'} onClick={() => onChange('ALL')} className={`rounded-full border px-3 py-1 text-xs font-medium ${active === 'ALL' ? 'border-primary bg-primary-soft text-primary-ink' : 'border-border text-text-2 hover:bg-hover'}`}>All</button>
        {segments.map((segment) => <button key={segment.id} type="button" aria-pressed={active === segment.id} onClick={() => onChange(active === segment.id ? 'ALL' : segment.id)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${active === segment.id ? 'border-primary bg-primary-soft text-primary-ink' : 'border-border text-text-2 hover:bg-hover'}`}><span className="size-2 rounded-full" style={{ background: segment.color }} />{segment.label}<span className="tabular-nums">{segment.count}</span></button>)}
      </div>
      {active !== 'ALL' && <p className="mt-3 text-xs text-text-2">Showing {segments.find((segment) => segment.id === active)?.label.toLowerCase()} · <Amount cents={segments.find((segment) => segment.id === active)?.cents || 0} currency={currency} size="xs" tone="ink" /></p>}
    </section>
  );
}
