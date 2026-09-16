import type { ReactNode } from 'react';
import { Link, usePathname } from '../router';

const NAV = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/why-kenya', label: 'Why Kenya' },
  { to: '/for-accountants', label: 'For accountants' },
  { to: '/security', label: 'Security' },
  { to: '/contact', label: 'Contact' },
];

/**
 * Rotated weekly rather than randomly, so the page is stable across a reload
 * and across two people looking at it in the same meeting.
 */
const PACIOLI = [
  'A person should not go to sleep at night until the debits equal the credits.',
  'Of things that are written, the first is the memorandum, the second the journal, the third the ledger.',
  'He who does business without knowing all about it sees his money go like flies.',
  'Where there is no order, there is confusion.',
];

function weekOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

export function MarketingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const quote = PACIOLI[weekOfYear(new Date()) % PACIOLI.length];

  return (
    <div className="min-h-screen bg-paper-50 text-ink-900 flex flex-col">
      <header className="border-b border-ink-900/10">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 flex items-baseline justify-between gap-6">
          <Link to="/" className="font-serif text-lg font-medium tracking-tight shrink-0">
            Ledger Link
          </Link>

          <nav className="hidden md:flex items-baseline gap-6 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={
                  pathname === item.to
                    ? 'text-ink-900 border-b border-brass-500 pb-0.5'
                    : 'text-slate-500 hover:text-ink-900 transition-colors duration-100'
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-baseline gap-4 text-sm shrink-0">
            <Link to="/login" className="text-slate-500 hover:text-ink-900 transition-colors duration-100">
              Sign in
            </Link>
            <Link
              to="/signup"
              className="border border-ink-900/20 px-3 py-1.5 text-ink-900 hover:border-ink-900/40 transition-colors duration-100"
              style={{ borderRadius: '2px' }}
            >
              Open an account
            </Link>
          </div>
        </div>

        <nav className="md:hidden border-t border-ink-900/10 overflow-x-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-2 flex gap-5 text-sm whitespace-nowrap">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={pathname === item.to ? 'text-ink-900' : 'text-slate-500'}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-ink-900/10 mt-16">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 grid gap-8 md:grid-cols-3 text-sm">
          <div>
            <p className="font-serif text-base font-medium mb-3">Ledger Link</p>
            <p className="text-slate-500 leading-relaxed">
              Kalson Towers, Crescent Lane
              <br />
              Off Parklands Road, Nairobi
              <br />
              Kenya
            </p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Compliance</p>
            <p className="text-slate-500 leading-relaxed">
              Invoices produced by Ledger Link carry the fields required by the Kenya Revenue
              Authority for tax invoices under the VAT Act. eTIMS submission requires your own
              OSCU or VSCU device registration against your KRA PIN.
            </p>
            <p className="text-slate-500 leading-relaxed mt-3">
              Registered with the Office of the Data Protection Commissioner
              {/* Replace once the ODPC certificate is issued. */}
              <span className="font-mono text-slate-500"> — registration no. pending</span>.
            </p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Pages</p>
            <ul className="space-y-1.5">
              {NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-slate-500 hover:text-ink-900 transition-colors duration-100">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-ink-900/10">
          <div className="mx-auto w-full max-w-5xl px-4 py-5 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3">
            <p className="font-serif italic text-sm text-slate-500" style={{ fontVariant: 'small-caps' }}>
              {quote}
              <span className="not-italic"> — Luca Pacioli, 1494</span>
            </p>
            <p className="text-xs text-slate-500 shrink-0">© {new Date().getFullYear()} Ledger Link</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
