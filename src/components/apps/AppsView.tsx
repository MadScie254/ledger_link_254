export function AppsView() {
  const integrations = [
    { name: 'M-Pesa Business', desc: 'Sync paybills and tills automatically.', status: 'Connected', active: true },
    { name: 'KRA eTIMS', desc: 'Type C API integration for automated tax invoices.', status: 'Configure', active: false },
    { name: 'WhatsApp Business', desc: 'Send invoices and reminders via WhatsApp.', status: 'Connect', active: false },
    { name: 'Stripe', desc: 'Accept international credit card payments.', status: 'Connect', active: false },
    { name: 'Google Workspace', desc: 'Sync receipts from Gmail and Drive.', status: 'Connect', active: false },
    { name: 'Shopify', desc: 'Import daily sales summaries and inventory.', status: 'Connect', active: false },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Apps & Integrations</h1>
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map(app => (
          <div key={app.name} className="bg-paper-100 border border-ink-900/10 rounded-sm p-6 flex flex-col h-full shadow-sm">
             <div className="flex justify-between items-start mb-4">
               <h3 className="text-lg font-medium text-ink-900">{app.name}</h3>
               {app.active && (
                 <span className="w-2 h-2 rounded-full bg-ledger-green-700 mt-2"></span>
               )}
             </div>
             <p className="text-sm text-slate-500 flex-1 mb-6">{app.desc}</p>
             <button className={`w-full py-2 text-sm font-medium rounded-sm border transition-colors ${
               app.active 
                 ? 'bg-paper-50 border-ink-900/10 text-ink-900 hover:bg-paper-100' 
                 : 'bg-paper-100 border-ink-900/20 text-ink-900 hover:bg-ink-900 hover:text-white'
             }`}>
               {app.status}
             </button>
          </div>
        ))}
      </div>
    </div>
  );
}
