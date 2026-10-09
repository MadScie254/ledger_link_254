/** Amounts retain their cents and currency; negative figures use red brackets. */
const SIZE_CLASSES = {
  xs: 'text-[11px]',
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-[24px] leading-7 font-bold',
  xl: 'text-[24px] leading-7 font-bold sm:text-[28px] sm:leading-[34px] sm:font-extrabold',
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

/** A figure as plain text, such as 1,250.00, for places a styled Amount cannot go (an option label). */
export function figureText(cents: number) {
  const parts = splitCents(cents);
  return `${parts.negative ? '-' : ''}${parts.shillings}.${parts.cents}`;
}

export function Amount({ cents, currency = 'KES', size = 'md', tone = 'figure', className = '' }: AmountProps) {
  const parts = splitCents(cents);
  const spoken = parts.zero
    ? `${currency} nil`
    : `${parts.negative ? 'minus ' : ''}${currency} ${parts.shillings}.${parts.cents}`;

  const color = parts.negative || tone === 'alert' ? 'text-negative' : 'text-text';

  if (parts.zero) {
    return (
      <span className={`ll-figure inline-block text-right ${SIZE_CLASSES[size]} text-text-3 ${className}`}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }

  return (
    <span className={`ll-figure inline-flex items-baseline justify-end whitespace-nowrap ${SIZE_CLASSES[size]} ${color} ${className}`}>
      <span aria-hidden="true" className="inline-flex items-baseline">
        {parts.negative && <span className="mr-[0.08em]">(</span>}
        <span>{parts.shillings}</span>
        <span>.</span>
        <span>{parts.cents}</span>
        {parts.negative && <span className="ml-[0.08em]">)</span>}
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
