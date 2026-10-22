import { useState } from 'react';
import { useAppStore } from '../../store';
import { Mark } from '../ledger/Mark';
import { Dialog } from '../ledger/Dialog';
import { PageHeading, buttonClass } from '../ledger/Page';

interface Integration {
  name: string;
  desc: string;
  /** What switching it on takes, shown in the dialog. */
  requires: string;
  /** Who completes the setup, shown under it. */
  completedBy?: string;
  /** Built connections say what they do today; the rest are not built. */
  state: 'mpesa' | 'etims' | 'unbuilt';
}

const integrations: Integration[] = [
  {
    name: 'M-Pesa Business',
    desc: 'Paybill and till payments arrive through Safaricom\'s Daraja C2B API as M-Pesa statement lines. A payment whose account number is an open invoice\'s number settles that invoice; the rest wait in Banking. With the paybill\'s M-Pesa Express passkey, an invoice can ask the customer\'s phone to pay.',
    requires: 'An owner or admin enters the paybill or till number, the Daraja app\'s consumer key and secret and the account payments land in, in Settings, Integrations, then registers the URLs with Safaricom. Live payments need the Daraja app taken live for that paybill or till on the Daraja portal. Without Daraja, M-Pesa statements exported as CSV import in Banking, Import statement.',
    completedBy: 'Going live is done with Safaricom on the Daraja portal; the rest is set up in Settings, Integrations.',
    state: 'mpesa',
  },
  {
    name: 'KRA eTIMS',
    desc: 'Submit each invoice to KRA and receive its signature.',
    requires: 'A KRA-issued OSCU or VSCU device registration tied to your PIN. Every invoice is already logged and queued; it cannot be submitted without those device credentials.',
    completedBy: 'The registration is completed with KRA; it cannot be switched on from inside Ledger Link.',
    state: 'etims',
  },
  { name: 'WhatsApp Business', desc: 'Send invoices and payment reminders on WhatsApp.', requires: 'Not built yet.', state: 'unbuilt' },
  { name: 'Stripe', desc: 'Accept international card payments against invoices.', requires: 'Not built yet.', state: 'unbuilt' },
  { name: 'Google Workspace', desc: 'Collect receipts from Gmail and Drive.', requires: 'Not built yet.', state: 'unbuilt' },
  { name: 'Shopify', desc: 'Import daily sales summaries and stock levels.', requires: 'Not built yet.', state: 'unbuilt' },
];

export function AppsView() {
  const { setActiveView, setSettingsTabIntent, activeCompany } = useAppStore();
  const [infoFor, setInfoFor] = useState<Integration | null>(null);
  const canSetUp = activeCompany?.role === 'owner' || activeCompany?.role === 'admin';

  return (
    <div className="max-w-4xl space-y-5 pb-16">
      <PageHeading
        tourId="apps-overview"
        title="Integrations"
        note="M-Pesa payments and the KRA eTIMS queue exist in Ledger Link today. The other connections are planned and not built, so none of them can be switched on."
      />

      <ul className="border-t border-feint-strong">
        {integrations.map((app) => (
          <li key={app.name} className="flex flex-col gap-2 border-b border-feint py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-ink-900">{app.name}</p>
              <p className="mt-0.5 text-[13px] text-graphite-600">{app.desc}</p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {app.state === 'mpesa' && (
                <>
                  <Mark kind="tick" label="Built" className="text-[12.5px]" />
                  <button type="button" onClick={() => setInfoFor(app)} className={buttonClass.quiet}>
                    What it needs
                  </button>
                  {canSetUp ? (
                    <button type="button" onClick={() => { setSettingsTabIntent('integrations'); setActiveView('Settings'); }} className={buttonClass.quiet}>
                      Set up
                    </button>
                  ) : (
                    <span className="text-[12.5px] text-graphite-600">An owner or admin sets it up</span>
                  )}
                </>
              )}
              {app.state === 'etims' && (
                <>
                  <Mark kind="query" label="Queue built, not submitting" className="text-[12.5px]" />
                  <button type="button" onClick={() => setInfoFor(app)} className={buttonClass.quiet}>
                    What it needs
                  </button>
                  <button type="button" onClick={() => setActiveView('Tax')} className={buttonClass.quiet}>
                    See the queue
                  </button>
                </>
              )}
              {app.state === 'unbuilt' && <span className="text-[12.5px] text-graphite-600">Not built</span>}
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={!!infoFor}
        onClose={() => setInfoFor(null)}
        title={infoFor ? `Connecting ${infoFor.name}` : ''}
        width="sm"
        footer={
          <button type="button" onClick={() => setInfoFor(null)} className={buttonClass.primary}>
            Close
          </button>
        }
      >
        <p className="text-[14px] leading-relaxed text-ink-900">{infoFor?.requires}</p>
        {infoFor?.completedBy && <p className="mt-3 text-[13px] text-graphite-600">{infoFor.completedBy}</p>}
      </Dialog>
    </div>
  );
}
