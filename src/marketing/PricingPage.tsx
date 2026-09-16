import { Link } from '../router';

const PLANS = [
  {
    name: 'Duka',
    price: 1500,
    forWhom: 'A single shop or service business doing its own books.',
    includes: [
      'One organization, one user',
      'One M-Pesa till or paybill',
      'Up to 300 transactions a month',
      'VAT return and trial balance exports',
    ],
  },
  {
    name: 'Business',
    price: 4500,
    forWhom: 'A company with staff on payroll and an external accountant.',
    includes: [
      'One organization, up to five users',
      'Unlimited transactions and till accounts',
      'Payroll for up to 25 employees, with P10, NSSF and SHIF exports',
      'Multi-currency invoicing and FX revaluation',
    ],
  },
  {
    name: 'Practice',
    price: 12000,
    forWhom: 'An accountant or firm carrying several clients.',
    includes: [
      'Unlimited client organizations under one login',
      'Per-client roles and a full audit trail',
      'Payroll for up to 250 employees across all clients',
      'Bulk trial balance and journal exports',
    ],
  },
];

export function PricingPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14">
      <h1 className="font-serif text-3xl font-medium tracking-tight">Pricing</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-500">
        Billed monthly in Kenyan shillings, exclusive of VAT. There is no annual lock-in and no
        setup fee. You can export your full ledger as CSV at any time, including after you stop
        paying, because they are your books.
      </p>

      <div className="mt-10 border-t border-ink-900/10">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className="border-b border-ink-900/10 py-6 grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:gap-8 items-baseline"
          >
            <div>
              <h2 className="font-serif text-xl font-medium">{plan.name}</h2>
              <p className="text-xs text-slate-500 mt-1">{plan.forWhom}</p>
            </div>

            <ul className="space-y-1.5 text-sm text-slate-500">
              {plan.includes.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className="inline-block shrink-0 bg-ledger-green-700 translate-y-[0.45rem]"
                    style={{ width: '6px', height: '6px' }}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <p className="font-mono text-lg text-ink-900 tabular-nums whitespace-nowrap sm:text-right">
              KES {new Intl.NumberFormat('en-KE').format(plan.price)}
              <span className="text-xs text-slate-500"> /month</span>
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 max-w-2xl space-y-4 text-[15px] leading-relaxed text-slate-500">
        <p>
          Prices are charged in KES. Invoicing your own customers in USD, UGX, TZS or RWF is
          included on every plan above Duka, held at the rate on the issue date, with unrealised
          FX posted to its own account rather than folded into revenue.
        </p>
        <p>
          Payroll employee counts are the number of people on a run, not the number of employee
          records you keep. Someone who left in March does not count against April.
        </p>
      </div>

      <div className="mt-8">
        <Link
          to="/signup"
          className="inline-block border border-ink-900 bg-ink-900 text-paper-100 px-4 py-2 text-sm hover:bg-ink-900/90 transition-colors duration-100"
          style={{ borderRadius: '2px' }}
        >
          Open an account
        </Link>
      </div>
    </section>
  );
}
