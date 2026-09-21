import React from 'react';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useAppStore } from '../../store';
import { convertAmount } from '../../utils/currency';
import { Amount } from './Amount';
import { PageHeading, SkeletonRows, LoadProblem, buttonClass } from './Page';

/**
 * Figures on a report are kept in the base currency. When the reader chooses
 * another display currency on the Reports page, they are translated here, in
 * one place, and the currency label on every figure follows. Nothing converts
 * silently inside a figure component.
 */
export function useStatementFigures() {
  const { displayCurrency, activeCompany } = useAppStore();
  const base = activeCompany?.baseCurrency || 'KES';
  const currency = displayCurrency || base;
  const shown = (cents: number) => (currency === base ? cents : convertAmount(cents, base, currency));
  return { currency, base, shown, translated: currency !== base };
}

export function StatementPage({
  title,
  period,
  onBack,
  controls,
  onCsv,
  onPdf,
  loading,
  problem,
  children,
}: {
  title: string;
  period: string;
  onBack: () => void;
  controls?: React.ReactNode;
  onCsv?: () => void;
  onPdf?: () => void;
  loading?: boolean;
  problem?: { what: string; path: string; onRetry?: () => void } | null;
  children: React.ReactNode;
}) {
  const { activeCompany } = useAppStore();
  const { currency, base, translated } = useStatementFigures();

  return (
    <div className="space-y-5 pb-16">
      <button type="button" onClick={onBack} className={`${buttonClass.quiet} no-print`}>
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Reports
      </button>

      <PageHeading
        title={title}
        note={
          <>
            {activeCompany?.legalName || activeCompany?.name || 'Your organization'} · {period} · Figures in {currency}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 no-print">
            {controls}
            {onCsv && (
              <button type="button" onClick={onCsv} className={buttonClass.secondary}>
                CSV
              </button>
            )}
            <button type="button" onClick={() => window.print()} className={buttonClass.secondary}>
              <Printer className="w-4 h-4" aria-hidden="true" /> Print
            </button>
            {onPdf && (
              <button type="button" onClick={onPdf} className={buttonClass.primary}>
                <Download className="w-4 h-4" aria-hidden="true" /> Export PDF
              </button>
            )}
          </div>
        }
      />

      {translated && (
        <p className="text-[13px] text-ledger-red">
          Translated from {base} at the latest stored rate, not the rate on each transaction’s date.
        </p>
      )}

      {problem ? (
        <LoadProblem what={problem.what} path={problem.path} onRetry={problem.onRetry} />
      ) : loading ? (
        <SkeletonRows label={`Loading ${title.toLowerCase()}`} rows={10} />
      ) : (
        <div className="max-w-3xl">{children}</div>
      )}
    </div>
  );
}

export function StatementSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 first:mt-2" aria-label={title}>
      <h2 className="ll-heading border-b border-feint-strong pb-1.5 text-[17px] text-ink-900">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

export function StatementLine({
  label,
  cents,
  onOpen,
  muted = false,
}: {
  label: React.ReactNode;
  cents: number;
  onOpen?: () => void;
  muted?: boolean;
}) {
  const { currency, shown } = useStatementFigures();
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2 pl-3 text-[13.5px]">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="min-w-0 text-left text-ink-900 underline decoration-feint-strong underline-offset-[3px] hover:decoration-current">
          {label}
        </button>
      ) : (
        <span className={`min-w-0 ${muted ? 'text-graphite-600' : 'text-ink-900'}`}>{label}</span>
      )}
      <Amount cents={shown(cents)} currency={currency} tone="result" className="shrink-0" />
    </div>
  );
}

export function StatementSubtotal({ label, cents }: { label: string; cents: number }) {
  const { currency, shown } = useStatementFigures();
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-ink-900 py-2 text-[13.5px]">
      <span className="font-semibold text-ink-900">{label}</span>
      <Amount cents={shown(cents)} currency={currency} tone="result" className="shrink-0 font-semibold" />
    </div>
  );
}

export function StatementResult({ label, cents }: { label: string; cents: number }) {
  const { currency, shown } = useStatementFigures();
  return (
    <div className="ll-total mt-4 flex items-baseline justify-between gap-4 py-2.5 text-[15px]">
      <span className="font-semibold text-ink-900">{label}</span>
      <Amount cents={shown(cents)} currency={currency} tone="result" size="lg" className="shrink-0 font-semibold" />
    </div>
  );
}
