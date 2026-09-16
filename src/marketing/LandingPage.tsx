import { Link } from '../router';
import { DemoBalanceSheet } from './DemoBalanceSheet';

/**
 * FORWARD-LOOKING COPY — read before pointing a domain at this.
 *
 * The prose below describes the product as specified, not as it stands today.
 * These claims are written in the present tense but are not shipped yet:
 *
 *   - statutory rate tables with an effective-from date   (section 3.4)
 *   - one atomic journal batch per payroll run            (section 3.4)
 *   - CSV and OFX bank import with saved column mappings  (section 3.3)
 *   - unrealised FX posted to its own account             (partially built)
 *
 * The balance sheet beside them is real and queried live. /for-accountants
 * names its own gaps explicitly; do the same here once these land, or soften
 * the tense until they do. Shipping this page publicly before sections 3.3 and
 * 3.4 merge would make it advertising for software that does not exist.
 */

export function LandingPage() {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-4 pt-14 pb-12">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-14 items-start">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">
              Double-entry accounting · Nairobi
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-medium leading-tight tracking-tight">
              Your books, your bank feed and your KRA filings in one ledger that actually
              reconciles.
            </h1>
            <p className="mt-5 text-base text-slate-500 leading-relaxed">
              Ledger Link is an accounting system built for businesses that collect money on
              M-Pesa, pay PAYE, NSSF, SHIF and Housing Levy every month, and file VAT against a
              KRA PIN. Every figure on this page comes out of a running tenant.
            </p>

            <div className="mt-7 flex items-baseline gap-5">
              <Link
                to="/signup"
                className="border border-ink-900 bg-ink-900 text-paper-100 px-4 py-2 text-sm hover:bg-ink-900/90 transition-colors duration-100"
                style={{ borderRadius: '2px' }}
              >
                Open an account
              </Link>
              <Link to="/pricing" className="text-sm text-slate-500 hover:text-ink-900 transition-colors duration-100">
                See what it costs
              </Link>
            </div>
          </div>

          <DemoBalanceSheet />
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-4">
        <div className="border-t border-ink-900/10" />
      </div>

      <section className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="max-w-2xl space-y-5 text-[15px] leading-relaxed text-slate-500">
          <h2 className="font-serif text-2xl font-medium text-ink-900 tracking-tight">
            Why you would move off what you have
          </h2>

          <p>
            If you are running Sage, QuickBooks or Xero in Kenya, you already know where the
            friction is. None of them reconcile an M-Pesa till natively. You export a statement
            from the Safaricom portal, reshape it in Excel, import it as a bank feed, and then
            spend the first week of every month matching paybill references to invoice numbers by
            eye. The accounting is fine. The plumbing between the accounting and the way your
            customers actually pay you is missing, and it has been missing for a decade.
          </p>

          <p>
            Payroll is the second gap. QuickBooks Online does not compute Kenyan PAYE bands, NSSF
            tier I and tier II, SHIF at 2.75 percent with the 300 shilling floor, or the 1.5
            percent Housing Levy on each side. So you keep a parallel payroll spreadsheet, run it
            by hand, and post a summary journal into the accounting system afterwards. That
            journal is where errors live, because nothing validates it against the payslips it
            claims to summarise.
          </p>

          <p>
            Ledger Link computes those statutory deductions from rate tables that carry an
            effective-from date, so a run can be back-dated against last quarter&rsquo;s rates when
            KRA changes them mid-year. Each run posts one atomic journal batch: gross salary
            expense debited, net pay payable credited, and every statutory liability credited to
            its own account. If any leg of that batch fails, the whole run rolls back. There is no
            such thing as a half-posted payroll.
          </p>

          <p>
            Underneath all of it is a double-entry ledger that is enforced in Postgres rather than
            in application code. Journal entries are posted through a database function that
            refuses an unbalanced entry, refuses a line carrying both a debit and a credit, and
            refuses a caller who is not a member of the organization. A bug in the frontend cannot
            produce books that do not balance, because the frontend is not what decides.
          </p>

          <p>
            Multi-currency is handled the way an auditor expects rather than the way a converter
            widget does. Invoices are held at the rate on the date they were issued, revaluation
            posts unrealised FX to its own account, and the gain or loss is visible as a line
            rather than folded silently into revenue. Businesses invoicing in USD, UGX, TZS or RWF
            out of a KES base get a trial balance that a Kenyan auditor will sign.
          </p>

          <p>
            The honest part: this is a young product and there is a list of things it does not do
            yet. Bank feeds for KCB, Equity, Co-op and Absa are CSV and OFX imports with a saved
            column mapping, not live API connections, because those banks do not publish an API we
            can build against. eTIMS invoices are generated, logged and queued, but submitting them
            needs your own OSCU or VSCU device credentials. Where something is not connected, the
            interface says so rather than showing a button that does nothing.
          </p>
        </div>

        <div className="mt-10 flex items-baseline gap-5">
          <Link
            to="/why-kenya"
            className="text-sm text-focus-blue-500 hover:text-ink-900 transition-colors duration-100"
          >
            What being built for Kenya actually changes
          </Link>
          <Link
            to="/for-accountants"
            className="text-sm text-focus-blue-500 hover:text-ink-900 transition-colors duration-100"
          >
            If you are the accountant, not the owner
          </Link>
        </div>
      </section>
    </>
  );
}
