import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { formatCurrency } from '../../utils/currency';

const tabs = ['VAT / Tax center', 'eTIMS / KRA bridge', 'Filing calendar'];

function daysUntil(dayOfMonth: number): number {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (target < now) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth);
  }
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function TaxView() {
  const [activeTab, setActiveTab] = useState('VAT / Tax center');
  const [showKraInfo, setShowKraInfo] = useState(false);
  const { currentOrgId, setActiveView } = useAppStore();

  const currentPeriod = new Date().toISOString().substring(0, 7);
  const { data, isLoading } = useQuery({
    queryKey: ['reports_tax_summary', currentOrgId, currentPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/reports/tax-summary?period=${encodeURIComponent(currentPeriod)}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch tax summary');
      return res.json();
    }
  });

  const outputVat = data?.outputVat?.taxAmountCents ?? 0;
  const inputVat = data?.inputVat?.taxAmountCents ?? 0;
  const netVat = data?.netVatPayableCents ?? (outputVat - inputVat);
  const etimsVerified = data?.etimsVerifiedCount ?? 0;
  const etimsPending = data?.etimsPendingCount ?? 0;
  const payeDays = daysUntil(9);
  const vatDays = daysUntil(20);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Tax & Compliance</h1>
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? 'border-brass-500 text-ink-900'
                : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'VAT / Tax center' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-paper-100 border border-ink-900/10 p-6 rounded-sm shadow-sm">
              <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Output VAT (Sales)</h3>
              <p className="text-3xl font-serif text-ink-900 tabular-currency">{isLoading ? '...' : formatCurrency(outputVat)}</p>
              <p className="text-xs text-slate-400 mt-2">This calendar month, from posted invoices</p>
            </div>
            <div className="bg-paper-100 border border-ink-900/10 p-6 rounded-sm shadow-sm">
              <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Input VAT (Purchases)</h3>
              <p className="text-3xl font-serif text-ink-900 tabular-currency">{isLoading ? '...' : formatCurrency(inputVat)}</p>
              <p className="text-xs text-slate-400 mt-2">This calendar month, from posted bills</p>
            </div>
            <div className="bg-sidebar-bg text-sidebar-ink p-6 rounded-sm shadow-sm">
              <h3 className="text-sm font-medium text-white/70 uppercase tracking-wider mb-2">Net VAT Payable</h3>
              <p className="text-3xl font-serif tabular-currency">{isLoading ? '...' : formatCurrency(netVat)}</p>
              <p className="text-xs text-white/50 mt-2 font-medium">Due by 20th of next month</p>
            </div>
          </div>

          <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8">
            <div className="flex items-center justify-between border-b border-ink-900/10 pb-6 mb-6">
              <div>
                <h3 className="text-lg font-medium text-ink-900">Recent Tax Transactions</h3>
                <p className="text-sm text-slate-500">Auto-calculated from your ledger.</p>
              </div>
              <button
                onClick={() => setActiveView('Reports')}
                className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors"
              >
                Generate Return
              </button>
            </div>
            <div className="text-center text-slate-500 py-8">
              For the full VAT return with PDF/Excel export, open Reports → Tax Summary.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'eTIMS / KRA bridge' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-2xl">
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-12 h-12 bg-rust-700/10 rounded-full flex items-center justify-center border border-rust-700/20">
              <span className="text-rust-700 font-bold font-serif">KRA</span>
            </div>
            <div>
              <h3 className="text-xl font-medium text-ink-900">eTIMS Integration</h3>
              <p className="text-sm text-slate-500">Sync invoices directly to the Kenya Revenue Authority.</p>
            </div>
          </div>

          <div className="bg-paper-50 border border-ink-900/10 p-4 rounded-sm mb-6 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-ink-900">Status</p>
              <p className="text-xs text-rust-700 font-medium">
                {etimsVerified + etimsPending === 0
                  ? 'Not connected'
                  : `${etimsVerified} verified / ${etimsPending} pending KRA connection`}
              </p>
            </div>
            <button
              onClick={() => setShowKraInfo(true)}
              className="bg-paper-100 border border-ink-900/20 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors"
            >
              Configure Connection
            </button>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            Connect your KRA Type C API credentials to automatically transmit electronic tax invoices when a sale is finalized in the system.
          </p>

          {showKraInfo && (
            <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-xs z-50 flex items-center justify-center p-4">
              <div className="bg-paper-100 rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-md p-6">
                <h4 className="text-lg font-serif text-ink-900 mb-3">Connecting to KRA eTIMS</h4>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">
                  Live eTIMS submission requires a KRA-issued Type C OSCU/VSCU device registration
                  and API credentials tied to your organization's PIN. This isn't something that can
                  be switched on from here — it needs your own KRA iTax account and device
                  registration completed with the Kenya Revenue Authority first.
                </p>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">
                  Every invoice you create is already logged and queued for submission (status:
                  "Not Configured") so nothing is lost — once real credentials are added to the
                  server configuration, queued invoices can be submitted.
                </p>
                <button
                  onClick={() => setShowKraInfo(false)}
                  className="w-full bg-sidebar-bg text-sidebar-ink py-2.5 rounded-sm font-medium hover:bg-sidebar-bg/90 transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'Filing calendar' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <h3 className="text-lg font-medium text-ink-900 mb-6">Upcoming Statutory Deadlines</h3>
           <div className="space-y-4">
             <div className="flex items-center justify-between p-4 border-l-4 border-rust-700 bg-paper-50 shadow-sm rounded-r-sm">
                <div>
                   <p className="font-semibold text-ink-900">PAYE & Statutory Deductions</p>
                   <p className="text-sm text-slate-500">Due by 9th of every month</p>
                </div>
                <span className="text-sm font-bold text-rust-700">In {payeDays} Day{payeDays === 1 ? '' : 's'}</span>
             </div>
             <div className="flex items-center justify-between p-4 border-l-4 border-brass-500 bg-paper-50 shadow-sm rounded-r-sm">
                <div>
                   <p className="font-semibold text-ink-900">VAT (Value Added Tax)</p>
                   <p className="text-sm text-slate-500">Due by 20th of every month</p>
                </div>
                <span className="text-sm font-bold text-ink-900">In {vatDays} Day{vatDays === 1 ? '' : 's'}</span>
             </div>
           </div>
        </div>
      )}
    </div>
  );
}
