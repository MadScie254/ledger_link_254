import { useState } from 'react';
import { useAppStore } from '../../store';
import { Mark } from '../ledger/Mark';
import { Dialog } from '../ledger/Dialog';
import { PageHeading, buttonClass } from '../ledger/Page';

const integrations = [
  { name: 'M-Pesa Business', desc: 'Bring paybill and till payments into Banking as statement lines.', requires: 'Not built yet. When it is, it will need a Safaricom Daraja API app (consumer key and secret) and a registered paybill or till.', built: false },
  { name: 'KRA eTIMS', desc: 'Submit each invoice to KRA and receive its signature.', requires: 'A KRA-issued OSCU or VSCU device registration tied to your PIN. Every invoice is already logged and queued; it cannot be submitted without those device credentials.', built: true },
  { name: 'WhatsApp Business', desc: 'Send invoices and payment reminders on WhatsApp.', requires: 'Not built yet.', built: false },
  { name: 'Stripe', desc: 'Accept international card payments against invoices.', requires: 'Not built yet.', built: false },
  { name: 'Google Workspace', desc: 'Collect receipts from Gmail and Drive.', requires: 'Not built yet.', built: false },
  { name: 'Shopify', desc: 'Import daily sales summaries and stock levels.', requires: 'Not built yet.', built: false },
];

export function AppsView() {
  const { setActiveView } = useAppStore();
  const [infoFor, setInfoFor] = useState<(typeof integrations)[number] | null>(null);

  return (
    <div className="max-w-4xl space-y-5 pb-16">
      <PageHeading
        tourId="apps-overview"
        title="Integrations"
        note="Only the KRA eTIMS queue exists in Ledger Link today. The other connections are planned and not built, so none of them can be switched on."
      />

      <ul className="border-t border-feint-strong">
        {integrations.map((app) => (
          <li key={app.name} className="flex flex-col gap-2 border-b border-feint py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-ink-900">{app.name}</p>
              <p className="mt-0.5 text-[13px] text-graphite-600">{app.desc}</p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {app.built ? (
                <>
                  <Mark kind="query" label="Queue built, not submitting" className="text-[12.5px]" />
                  <button type="button" onClick={() => setInfoFor(app)} className={buttonClass.quiet}>
                    What it needs
                  </button>
                  <button type="button" onClick={() => setActiveView('Tax')} className={buttonClass.quiet}>
                    See the queue
                  </button>
                </>
              ) : (
                <span className="text-[12.5px] text-graphite-600">Not built</span>
              )}
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
        <p className="mt-3 text-[13px] text-graphite-600">The registration is completed with KRA; it cannot be switched on from inside Ledger Link.</p>
      </Dialog>
    </div>
  );
}
