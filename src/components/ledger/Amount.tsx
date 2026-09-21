/**
 * A figure as it is written into a counter book: shillings, a printed red
 * rule, cents. Negatives are bracketed, zero is a dash, and the currency is
 * never repeated on the figure itself; the column or label above carries it.
 *
 * Amounts are shown in the cents they arrive in. Nothing here converts
 * currency, so a figure never silently changes value with a display setting.
 */
const SIZE_CLASSES = {
  xs: 'text-[11px]',
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-[20px] sm:text-[22px]',
  xl: 'text-[21px] sm:text-[26px] xl:text-[32px]',
} as const;

type Tone =
  /** Ballpoint blue: a figure entered into the book. The default. */
  | 'figure'
  /** Printed ink: labels, totals carried from elsewhere. */
  | 'ink'
  /** Profit and loss: a negative reads as a loss in stationery red. */
  | 'result'
  /** An error figure, such as books out of balance: red whatever its sign. */
  | 'alert';

interface AmountProps {
  cents: number;
  /** Used only for the accessible label. */
  currency?: string;
  size?: keyof typeof SIZE_CLASSES;
  tone?: Tone;
  className?: string;
}

const groupShillings = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

export function splitCents(cents: number) {
  const rounded = Math.round(Number.isFinite(cents) ? cents : 0);
  const negative = rounded < 0;
  const absolute = Math.abs(rounded);
  return {
    negative,
    zero: absolute === 0,
    shillings: groupShillings.format(Math.floor(absolute / 100)),
    cents: String(absolute % 100).padStart(2, '0'),
  };
}

export function Amount({ cents, currency = 'KES', size = 'md', tone = 'figure', className = '' }: AmountProps) {
  const parts = splitCents(cents);
  const spoken = parts.zero
    ? `${currency} nil`
    : `${parts.negative ? 'minus ' : ''}${currency} ${parts.shillings}.${parts.cents}`;

  const color =
    tone === 'ink'
      ? 'text-ink-900'
      : tone === 'alert'
        ? 'text-ledger-red'
      : tone === 'result' && parts.negative
        ? 'text-ledger-red'
        : tone === 'result'
          ? 'text-ink-900'
          : 'text-ink-blue';

  if (parts.zero) {
    return (
      <span className={`ll-figure ${SIZE_CLASSES[size]} text-graphite-500 ${className}`}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }

  return (
    <span className={`ll-figure inline-flex items-baseline whitespace-nowrap leading-none ${SIZE_CLASSES[size]} ${color} ${className}`}>
      <span aria-hidden="true" className="inline-flex items-baseline">
        {parts.negative && <span className="mr-[0.08em]">(</span>}
        <span>{parts.shillings}</span>
        <span className="ml-[0.14em] self-stretch w-px bg-ledger-red opacity-80" />
        <span className="ml-[0.16em]">{parts.cents}</span>
        {parts.negative && <span className="ml-[0.08em]">)</span>}
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
