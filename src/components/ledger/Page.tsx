import React, { useEffect, useRef } from 'react';

/** Shared page headings, tabs, and actions. */

export const buttonClass = {
  /** The one filled action on a page. */
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md bg-primary text-on-primary text-[14px] font-semibold shadow-sm transition-colors duration-[120ms] ease-[var(--motion-ease)] hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed',
  /** Everything else that is still a button. */
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md border border-border-strong bg-surface text-text text-[14px] font-medium shadow-sm transition-colors duration-[120ms] ease-[var(--motion-ease)] hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed',
  /** A text action inside a row or a sentence. */
  quiet:
    'inline-flex items-center justify-center gap-1 min-h-9 px-2 rounded-md text-[14px] font-medium text-primary-ink transition-colors duration-[120ms] ease-[var(--motion-ease)] hover:bg-primary-soft disabled:opacity-50',
  ghost:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-[14px] font-medium text-text-2 transition-colors duration-[120ms] ease-[var(--motion-ease)] hover:bg-hover hover:text-text disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md bg-negative text-white text-[14px] font-semibold transition-colors duration-[120ms] ease-[var(--motion-ease)] hover:opacity-90 disabled:opacity-50',
} as const;

export function PageHeading({
  title,
  note,
  actions,
  tourId,
}: {
  title: string;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  tourId?: string;
}) {
  return (
    <header data-tour={tourId} className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="ll-heading text-[22px] leading-7 text-text">{title}</h1>
        {note && <p className="mt-2 text-[14px] leading-5 text-text-2">{note}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function IndexTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { id: T; name: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const selectedTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex snap-x scroll-px-4 gap-6 overflow-x-auto border-b border-border pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            ref={selected ? selectedTabRef : undefined}
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`-mb-px shrink-0 snap-start border-b-2 px-1 pb-2 pt-3 text-[14px] transition-colors duration-150 ${
              selected ? 'border-primary font-semibold text-primary-ink' : 'border-transparent text-text-2 hover:text-text'
            }`}
          >
            {tab.name}
            {tab.count !== undefined && <span className="ml-1.5 text-graphite-500 font-normal">({tab.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A one-line note about the state of a list, printed rather than boxed. */
export function PageNote({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px] text-text-2">{children}</p>;
}

/** Ruled placeholder rows that hold the shape of the table about to load. */
export function SkeletonRows({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
          <div className="h-3 w-20 bg-paper-200" />
          <div className="h-3 flex-1 bg-paper-200" />
          <div className="h-3 w-24 bg-paper-200" />
        </div>
      ))}
    </div>
  );
}

/** What this list will hold once there is something in it, and how to start. */
export function EmptyNote({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="py-6 max-w-xl text-[14px] leading-relaxed text-graphite-600">
      <p>{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A request that failed, named plainly, with a way to try again. */
export function LoadProblem({ what, path, onRetry }: { what: string; path: string; onRetry?: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13.5px]">
      <span className="text-ledger-red font-semibold">Could not load {what}.</span>
      <span className="text-graphite-600">GET {path} did not complete.</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonClass.quiet}>
          Try again
        </button>
      )}
    </p>
  );
}

/** A labelled figure in a ruled row: label on the left, figure on the right. */
export function LedgerRow({ label, children, total = false, strong = false }: { label: React.ReactNode; children: React.ReactNode; total?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 text-[13.5px] ${total ? 'll-total mt-px' : 'border-b border-feint'}`}>
      <span className={total || strong ? 'font-semibold text-ink-900' : 'text-ink-900'}>{label}</span>
      <span className={total || strong ? 'font-semibold' : ''}>{children}</span>
    </div>
  );
}
