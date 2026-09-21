/**
 * The marks an auditor makes in the margin, drawn as pen strokes.
 *
 *   tick     green  agreed: reconciled, paid, verified
 *   query    pencil waiting on someone: needs attention
 *   circled  red    an exception: overdue, failed, out of balance
 *
 * A mark never stands alone as the only signal; pass `label` to print the
 * word beside it, or keep the word in the surrounding row.
 */
type MarkKind = 'tick' | 'query' | 'circled';

const TONE: Record<MarkKind, string> = {
  tick: 'text-auditor-green',
  query: 'text-graphite-600',
  circled: 'text-ledger-red',
};

interface MarkProps {
  kind: MarkKind;
  /** Printed beside the mark. When omitted the mark is read by its kind. */
  label?: string;
  /** Draw the stroke once, as if the pen just made it. */
  draw?: boolean;
  className?: string;
}

const SPOKEN: Record<MarkKind, string> = {
  tick: 'Agreed',
  query: 'Needs attention',
  circled: 'Exception',
};

export function Mark({ kind, label, draw = false, className = '' }: MarkProps) {
  const stroke = draw ? 'll-pen' : '';

  return (
    <span className={`inline-flex items-center gap-1.5 ${TONE[kind]} ${className}`}>
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        role={label ? undefined : 'img'}
        aria-hidden={label ? true : undefined}
        aria-label={label ? undefined : SPOKEN[kind]}
      >
        {kind === 'tick' && <path className={stroke} pathLength={1} d="M2.2 8.8 L6 12.6 L13.8 3.4" />}
        {kind === 'query' && (
          <>
            <path className={stroke} pathLength={1} d="M5.3 5.4 C5.3 3.6 6.6 2.6 8.1 2.6 C9.7 2.6 10.9 3.7 10.9 5.1 C10.9 6.4 10 7 9.1 7.6 C8.4 8.1 8 8.6 8 9.6 L8 10.2" />
            <circle cx="8" cy="13.2" r="0.6" fill="currentColor" stroke="none" />
          </>
        )}
        {kind === 'circled' && <path className={stroke} pathLength={1} d="M13.4 5.2 C12.3 2.9 9.9 1.9 7.4 2.3 C4.3 2.8 2.2 5.5 2.6 8.6 C3 11.6 5.8 13.8 8.8 13.4 C11.8 13 13.9 10.3 13.5 7.3" />}
      </svg>
      {label && <span className="text-[12px] leading-tight">{label}</span>}
    </span>
  );
}
