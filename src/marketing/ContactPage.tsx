import { Link } from '../router';

/**
 * Deliberately no contact form. A form needs an endpoint, a queue and someone
 * reading it; until those exist a form is a message that goes nowhere, which is
 * worse than an address. Revisit when section 3.9 brings real form handling.
 */
export function ContactPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14">
      <h1 className="font-serif text-3xl font-medium tracking-tight">Contact</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-500">
        Ledger Link is a small team in Nairobi. Mail reaches a person rather than a ticket queue,
        and is usually answered within one working day.
      </p>

      <dl className="mt-10 border-t border-ink-900/10 max-w-2xl">
        <div className="border-b border-ink-900/10 py-5 grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-8">
          <dt className="text-[10px] uppercase tracking-widest text-slate-500 sm:pt-1">Sales</dt>
          <dd>
            <a
              href="mailto:sales@ledgerlink.co.ke"
              className="text-focus-blue-500 hover:text-ink-900 transition-colors duration-100"
            >
              sales@ledgerlink.co.ke
            </a>
            <p className="text-sm text-slate-500 mt-1">
              Pricing, migration from Sage, QuickBooks or Xero, and multi-entity setups.
            </p>
          </dd>
        </div>

        <div className="border-b border-ink-900/10 py-5 grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-8">
          <dt className="text-[10px] uppercase tracking-widest text-slate-500 sm:pt-1">Support</dt>
          <dd>
            <a
              href="mailto:support@ledgerlink.co.ke"
              className="text-focus-blue-500 hover:text-ink-900 transition-colors duration-100"
            >
              support@ledgerlink.co.ke
            </a>
            <p className="text-sm text-slate-500 mt-1">
              Existing accounts. Include your organization name and, where it applies, the journal
              entry or invoice number involved.
            </p>
          </dd>
        </div>

        <div className="border-b border-ink-900/10 py-5 grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-8">
          <dt className="text-[10px] uppercase tracking-widest text-slate-500 sm:pt-1">
            Data protection
          </dt>
          <dd>
            <a
              href="mailto:privacy@ledgerlink.co.ke"
              className="text-focus-blue-500 hover:text-ink-900 transition-colors duration-100"
            >
              privacy@ledgerlink.co.ke
            </a>
            <p className="text-sm text-slate-500 mt-1">
              Access, correction and deletion requests under the Data Protection Act, 2019.
            </p>
          </dd>
        </div>

        <div className="border-b border-ink-900/10 py-5 grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-8">
          <dt className="text-[10px] uppercase tracking-widest text-slate-500 sm:pt-1">Office</dt>
          <dd className="text-sm text-slate-500 leading-relaxed">
            Kalson Towers, Crescent Lane
            <br />
            Off Parklands Road
            <br />
            Nairobi, Kenya
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-[15px] text-slate-500">
        If you are ready to start rather than ask,{' '}
        <Link to="/signup" className="text-focus-blue-500 hover:text-ink-900 transition-colors duration-100">
          open an account
        </Link>
        .
      </p>
    </section>
  );
}
