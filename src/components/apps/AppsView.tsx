import { useState } from 'react';
import { useAppStore } from '../../store';
import { Info } from 'lucide-react';

const integrations = [
  { name: 'M-Pesa Business', desc: 'Sync paybills and tills automatically.', requires: 'a Safaricom Daraja API app (consumer key/secret) and a registered paybill/till.' },
  { name: 'KRA eTIMS', desc: 'Type C API integration for automated tax invoices.', requires: 'a KRA-issued OSCU/VSCU device registration tied to your PIN. Every invoice is already logged and queued (see Tax & Compliance) — it just can\'t submit to KRA without real device credentials.' },
  { name: 'WhatsApp Business', desc: 'Send invoices and reminders via WhatsApp.', requires: 'a Meta WhatsApp Business Platform account and API token.' },
  { name: 'Stripe', desc: 'Accept international credit card payments.', requires: 'a Stripe account and API keys.' },
  { name: 'Google Workspace', desc: 'Sync receipts from Gmail and Drive.', requires: 'a Google Cloud OAuth app authorized for your Workspace domain.' },
  { name: 'Shopify', desc: 'Import daily sales summaries and inventory.', requires: 'a Shopify Admin API access token for your store.' },
];

export function AppsView() {
  const { setActiveView } = useAppStore();
  const [infoFor, setInfoFor] = useState<typeof integrations[number] | null>(null);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Apps & Integrations</h1>
      </div>
      <div className="ledger-divider mb-6"></div>
      <p className="text-sm text-slate-500 mb-6">
        None of these are connected yet — each needs a real account and API credentials with the
        provider, which only you can set up. Click one to see exactly what's required.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map(app => (
          <div key={app.name} className="bg-paper-100 border border-ink-900/10 rounded-sm p-6 flex flex-col h-full shadow-sm">
             <div className="flex justify-between items-start mb-4">
               <h3 className="text-lg font-medium text-ink-900">{app.name}</h3>
             </div>
             <p className="text-sm text-slate-500 flex-1 mb-6">{app.desc}</p>
             <button
               onClick={() => app.name === 'KRA eTIMS' ? setActiveView('Tax') : setInfoFor(app)}
               className="w-full py-2 text-sm font-medium rounded-sm border transition-colors bg-paper-100 border-ink-900/20 text-ink-900 hover:bg-sidebar-bg hover:text-sidebar-ink hover:border-sidebar-bg"
             >
               {app.name === 'KRA eTIMS' ? 'View Status' : 'Connect'}
             </button>
          </div>
        ))}
      </div>

      {infoFor && (
        <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-xs z-50 flex items-center justify-center p-4" onClick={() => setInfoFor(null)}>
          <div className="bg-paper-100 rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start space-x-3 mb-4">
              <Info className="w-5 h-5 text-focus-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-ink-900 mb-1">Connecting {infoFor.name}</p>
                <p className="text-sm text-slate-600">This requires {infoFor.requires} It can't be switched on from inside the app.</p>
              </div>
            </div>
            <button
              onClick={() => setInfoFor(null)}
              className="w-full bg-sidebar-bg text-sidebar-ink py-2.5 rounded-sm font-medium hover:bg-sidebar-bg/90 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
