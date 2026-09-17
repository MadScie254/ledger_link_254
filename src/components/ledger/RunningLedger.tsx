import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Amount } from './Amount';

export interface LedgerLine {
  id: string;
  date: string;
  sourceType?: string;
  memo?: string;
  debit?: number;
  credit?: number;
}

/**
 * An account ledger that behaves like a page of the book as you turn it.
 *
 * The balance brought forward stays pinned under the column heads and the
 * balance carried forward stays pinned at the foot. Both are recomputed for
 * the rows actually in view, so wherever the reader stops, the page opens on
 * the balance it inherited and closes on the balance it hands on.
 *
 * Lines must be the account's complete history; the running balance starts
 * from nil at the first line. Balances read Dr or Cr, as a bookkeeper writes
 * them, rather than as signed numbers.
 */
function Balance({ cents, currency }: { cents: number; currency: string }) {
  if (Math.round(cents) === 0) {
    return <Amount cents={0} currency={currency} tone="ink" />;
  }
  const side = cents > 0 ? 'Dr' : 'Cr';
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <Amount cents={Math.abs(cents)} currency={currency} tone="ink" />
      <span className="w-5 text-left text-[11.5px] text-graphite-600" aria-label={side === 'Dr' ? 'debit' : 'credit'}>{side}</span>
    </span>
  );
}

export function RunningLedger({ lines, currency, accountLabel }: { lines: LedgerLine[]; currency: string; accountLabel: string }) {
  const rows = [...lines]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .reduce<(LedgerLine & { balance: number })[]>((acc, line) => {
      const previous = acc.length ? acc[acc.length - 1].balance : 0;
      acc.push({ ...line, balance: previous + Number(line.debit || 0) - Number(line.credit || 0) });
      return acc;
    }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableRowElement>(null);
  const footRef = useRef<HTMLTableRowElement>(null);
  const bfRef = useRef<HTMLTableRowElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [headHeight, setHeadHeight] = useState(32);
  const [pinned, setPinned] = useState({ top: 64, bottom: 40 });
  const [view, setView] = useState({ first: 0, last: Math.max(0, rows.length - 1) });

  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box || rows.length === 0) return;
    // A row counts as on the page when its text is: its midpoint sits between
    // the pinned rows. Counting by edges would either take the balance from a
    // line hidden under the brought-forward row, or drop a line the reader can
    // plainly see, and either way brought forward plus the first line would
    // stop equalling that line's balance. Rows also snap to rest under the
    // pinned line (see scroll-snap below), so a half-covered row is rare.
    const covered = box.scrollTop + (headRef.current?.offsetHeight || 0) + (bfRef.current?.offsetHeight || 0);
    const bottom = box.scrollTop + box.clientHeight - (footRef.current?.offsetHeight || 0);
    let first = 0;
    let last = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const el = rowRefs.current[i];
      if (el && el.offsetTop + el.offsetHeight / 2 >= covered) {
        first = i;
        break;
      }
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const el = rowRefs.current[i];
      if (el && el.offsetTop + el.offsetHeight / 2 <= bottom) {
        last = i;
        break;
      }
    }
    setView((prev) => (prev.first === first && prev.last === Math.max(first, last) ? prev : { first, last: Math.max(first, last) }));
  }, [rows.length]);

  useLayoutEffect(() => {
    const head = headRef.current?.offsetHeight || 32;
    setHeadHeight(head);
    setPinned({ top: head + (bfRef.current?.offsetHeight || 32), bottom: footRef.current?.offsetHeight || 40 });
    measure();
  }, [measure, lines]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [measure]);

  const broughtForward = view.first > 0 ? rows[view.first - 1].balance : 0;
  const carriedForward = rows[view.last]?.balance ?? 0;
  const atStart = view.first === 0;
  const atEnd = view.last === rows.length - 1;

  const pinnedCell = 'sticky z-10 bg-paper-100 py-2';

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="region"
      aria-label={`Ledger for ${accountLabel}. Scroll to move through the lines; the balances brought and carried forward follow the lines in view.`}
      className="relative max-h-[min(70vh,42rem)] overflow-auto snap-y snap-proximity border-y border-feint-strong focus-visible:outline-offset-[-2px]"
      style={{ scrollPaddingTop: pinned.top, scrollPaddingBottom: pinned.bottom }}
    >
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">
          {accountLabel}, {rows.length} lines, figures in {currency}
        </caption>
        <thead>
          <tr ref={headRef}>
            <th scope="col" className="sticky top-0 z-20 bg-paper-100 pl-1 pr-4 text-left">Date</th>
            <th scope="col" className="sticky top-0 z-20 bg-paper-100 pr-4 text-left">Particulars</th>
            <th scope="col" className="sticky top-0 z-20 bg-paper-100 pr-4 text-right">Debit</th>
            <th scope="col" className="sticky top-0 z-20 bg-paper-100 pr-4 text-right">Credit</th>
            <th scope="col" className="sticky top-0 z-20 bg-paper-100 pr-1 text-right">Balance</th>
          </tr>
          <tr ref={bfRef} aria-live="polite">
            <td colSpan={4} className={`${pinnedCell} pl-1 border-b border-feint-strong font-serif text-graphite-600`} style={{ top: headHeight }}>
              {atStart ? 'Opening balance' : `Brought forward from ${format(new Date(rows[view.first - 1].date), 'dd/MM/yyyy')}`}
            </td>
            <td className={`${pinnedCell} pr-1 text-right border-b border-feint-strong`} style={{ top: headHeight }}>
              <Balance cents={broughtForward} currency={currency} />
            </td>
          </tr>
        </thead>
        <tbody>
          {rows.map((line, i) => (
            <tr key={line.id} ref={(el) => { rowRefs.current[i] = el; }} className="snap-start">
              <td className="pl-1 pr-4 whitespace-nowrap text-graphite-600">{format(new Date(line.date), 'dd/MM/yyyy')}</td>
              <td className="pr-4">
                <span className="text-ink-900">{line.memo || 'Journal entry'}</span>
                {line.sourceType && <span className="ml-2 text-[11.5px] text-graphite-500">{line.sourceType.charAt(0) + line.sourceType.slice(1).toLowerCase()}</span>}
              </td>
              <td className="pr-4 text-right whitespace-nowrap">
                {line.debit ? <Amount cents={Number(line.debit)} currency={currency} /> : <span className="text-graphite-400">–</span>}
              </td>
              <td className="pr-4 text-right whitespace-nowrap">
                {line.credit ? <Amount cents={Number(line.credit)} currency={currency} /> : <span className="text-graphite-400">–</span>}
              </td>
              <td className="pr-1 text-right"><Balance cents={line.balance} currency={currency} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr ref={footRef} aria-live="polite">
            <th scope="row" colSpan={4} className={`${pinnedCell} bottom-0 pl-1 text-left font-semibold text-ink-900 border-t border-ledger-red`}>
              {atEnd ? 'Closing balance' : `Carried forward from ${format(new Date(rows[view.last].date), 'dd/MM/yyyy')}`}
            </th>
            <td className={`${pinnedCell} bottom-0 pr-1 text-right border-t border-ledger-red`}>
              <span className="inline-block border-b-[3px] border-double border-ledger-red pb-0.5 font-semibold">
                <Balance cents={carriedForward} currency={currency} />
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
