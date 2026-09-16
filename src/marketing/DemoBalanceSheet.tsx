import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

interface Line {
  name: string;
  amountCents: number;
}

interface DemoBalanceSheetData {
  organization: { name: string; baseCurrency: string };
  asOfDate: string;
  currentAssets: Line[];
  nonCurrentAssets: Line[];
  currentLiabilities: Line[];
  equity: Line[];
}

/** KES with no decimals — a balance sheet at this scale does not need shillings. */
function kes(cents: number) {
  return new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(cents / 100);
}

const sum = (lines: Line[]) => lines.reduce((total, line) => total + line.amountCents, 0);

function Row({ label, amount, indent = false }: { label: string; amount: number; indent?: boolean }) {
  return (
    <tr>
      <td className={`py-1 text-slate-500 ${indent ? 'pl-3' : ''}`}>{label}</td>
      <td className="py-1 text-right font-mono text-ink-900 tabular-nums">{kes(amount)}</td>
    </tr>
  );
}

function Total({ label, amount, rule = false }: { label: string; amount: number; rule?: boolean }) {
  const border = rule ? 'border-t border-ink-900/10' : '';
  return (
    <tr>
      <td className={`py-1.5 text-ink-900 ${border}`}>{label}</td>
      <td className={`py-1.5 text-right font-mono text-ink-900 tabular-nums ${border}`}>{kes(amount)}</td>
    </tr>
  );
}

function SectionHead({ children }: { children: string }) {
  return (
    <tr>
      <td colSpan={2} className="pt-4 pb-1 text-[10px] uppercase tracking-widest text-slate-500">
        {children}
      </td>
    </tr>
  );
}

export function DemoBalanceSheet() {
  const { data, isLoading, isError } = useQuery<DemoBalanceSheetData>({
    queryKey: ['demo-balance-sheet'],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const response = await fetch('/api/public/demo-balance-sheet');
      if (!response.ok) throw new Error('Demo books unavailable');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="border border-ink-900/10 p-5" style={{ borderRadius: '2px' }}>
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="h-3 bg-ink-900/5" />
          ))}
        </div>
        <p className="sr-only">Loading the demo balance sheet.</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="border border-ink-900/10 p-5 text-sm text-slate-500" style={{ borderRadius: '2px' }}>
        The demo books are not reachable right now. Everything else on this page still applies.
      </div>
    );
  }

  const totalAssets = sum(data.currentAssets) + sum(data.nonCurrentAssets);
  const totalLiabilities = sum(data.currentLiabilities);
  const totalEquity = sum(data.equity);
  const balances = totalAssets === totalLiabilities + totalEquity;

  return (
    <div className="border border-ink-900/10" style={{ borderRadius: '2px' }}>
      <div className="px-5 py-4 border-b border-ink-900/10">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">Balance sheet</p>
        <p className="font-serif text-base font-medium mt-1">{data.organization.name}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          As at {format(new Date(data.asOfDate), 'd MMMM yyyy')} · {data.organization.baseCurrency}
        </p>
      </div>

      <div className="px-5 pb-5">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Balance sheet for {data.organization.name} as at {data.asOfDate}
          </caption>
          <tbody>
            <SectionHead>Current assets</SectionHead>
            {data.currentAssets.map((line) => (
              <Row key={line.name} label={line.name} amount={line.amountCents} indent />
            ))}

            {data.nonCurrentAssets.length > 0 && (
              <>
                <SectionHead>Non-current assets</SectionHead>
                {data.nonCurrentAssets.map((line) => (
                  <Row key={line.name} label={line.name} amount={line.amountCents} indent />
                ))}
              </>
            )}
            <Total label="Total assets" amount={totalAssets} rule />

            <SectionHead>Current liabilities</SectionHead>
            {data.currentLiabilities.map((line) => (
              <Row key={line.name} label={line.name} amount={line.amountCents} indent />
            ))}
            <Total label="Total liabilities" amount={totalLiabilities} rule />

            <SectionHead>Equity</SectionHead>
            {data.equity.map((line) => (
              <Row key={line.name} label={line.name} amount={line.amountCents} indent />
            ))}
            <Total label="Total liabilities and equity" amount={totalLiabilities + totalEquity} rule />
          </tbody>
        </table>

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-ink-900/10">
          <span
            aria-hidden="true"
            className={`inline-block shrink-0 ${balances ? 'bg-ledger-green-700' : 'bg-rust-700'}`}
            style={{ width: '6px', height: '6px' }}
          />
          <span className="text-xs text-slate-500">
            {balances
              ? 'Balanced. Posted from twelve journal entries in a live tenant, not a screenshot.'
              : 'Out of balance. This is a real query against real books, and it is telling you something.'}
          </span>
        </div>
      </div>
    </div>
  );
}
