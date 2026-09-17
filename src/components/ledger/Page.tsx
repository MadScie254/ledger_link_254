import React from 'react';

/**
 * The shared furniture of a page in the book: its heading ruled heavy below,
 * printed index tabs, and one vocabulary of buttons. Every view uses these so
 * a heading, a tab or a primary action never looks different from one page to
 * the next. One filled primary per page.
 */

export const buttonClass = {
  /** The one filled action on a page. */
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-sm bg-oxblood-fill text-white text-[13.5px] font-semibold hover:bg-[var(--oxblood-fill-hover)] disabled:opacity-50 disabled:cursor-not-allowed',
  /** Everything else that is still a button. */
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-sm border border-field bg-paper-100 text-ink-900 text-[13.5px] hover:border-ink-900 disabled:opacity-50 disabled:cursor-not-allowed',
  /** A text action inside a row or a sentence. */
  quiet:
    'inline-flex items-center gap-1 text-[13px] text-oxblood underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor_40%,transparent)] hover:decoration-current disabled:opacity-50 disabled:no-underline',
} as const;

export function PageHeading({
  title,
  note,
  actions,
}: {
  title: string;
  note?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b-2 border-ink-900 pb-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="ll-heading text-[28px] sm:text-[34px] leading-[0.98] text-ink-900">{title}</h1>
        {note && <p className="mt-2 text-[13px] text-graphite-600">{note}</p>}
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
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-6 overflow-x-auto border-b border-feint-strong max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,#000_82%,transparent)]"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`-mb-px shrink-0 border-b-2 pb-2 pt-3 text-[14px] ${
              selected ? 'border-oxblood font-semibold text-ink-900' : 'border-transparent text-graphite-600 hover:text-ink-900'
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
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px] text-graphite-600 border-b border-feint">{children}</p>;
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
