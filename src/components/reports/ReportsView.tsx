import { useState } from 'react';
import { useAppStore } from '../../store';
import { Info } from 'lucide-react';
import { ProfitAndLossView } from './ProfitAndLossView';
import { BalanceSheetView } from './BalanceSheetView';
import { CashFlowView } from './CashFlowView';
import { TrialBalanceView } from './TrialBalanceView';
import { TaxSummaryView } from './TaxSummaryView';
import { ARAgingView, APAgingView } from './ARAgingView';
import { GeneralLedgerView } from './GeneralLedgerView';

const tabs = ['Standard reports', 'Custom report builder', 'Management report packs', 'Scheduled/emailed reports'];

const standardReports = [
  { name: 'Profit & Loss', desc: 'Shows your income and expenses to determine your net profit.', category: 'Business Overview' },
  { name: 'Balance Sheet', desc: 'Lists what you own (assets), what you owe (liabilities), and what you invested (equity).', category: 'Business Overview' },
  { name: 'Statement of Cash Flows', desc: 'Shows the cash flowing in and out of your business across operating, investing and financing.', category: 'Business Overview' },
  { name: 'Tax Summary (KRA VAT & eTIMS)', desc: 'Official Kenya Revenue Authority VAT Return schedule, eTIMS invoice breakdown, and net liability.', category: 'Tax & Compliance' },
  { name: 'Trial Balance', desc: 'Summarizes the debit and credit balances of each account on your chart of accounts with equality verification.', category: 'Accountant' },
  { name: 'A/R Aging Summary', desc: 'Unpaid customer invoices, grouped by days past due.', category: 'Who owes you' },
  { name: 'A/P Aging Summary', desc: 'Unpaid vendor bills, grouped by days past due.', category: 'What you owe' },
  { name: 'General Ledger', desc: 'The beginning balance, transactions, and total for each account in your chart of accounts.', category: 'Accountant' },
];

export function ReportsView() {
  const { displayCurrency, setDisplayCurrency } = useAppStore();
  const [activeTab, setActiveTab] = useState('Standard reports');
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [notBuiltMessage, setNotBuiltMessage] = useState<string | null>(null);
  
  // Group reports by category
  const groupedReports = standardReports.reduce((acc, report) => {
    if (!acc[report.category]) acc[report.category] = [];
    acc[report.category].push(report);
    return acc;
  }, {} as Record<string, typeof standardReports>);

  if (activeReport === 'Profit & Loss') {
    return <ProfitAndLossView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'Balance Sheet') {
    return <BalanceSheetView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'Statement of Cash Flows') {
    return <CashFlowView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'Trial Balance') {
    return <TrialBalanceView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'Tax Summary (KRA VAT & eTIMS)') {
    return <TaxSummaryView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'A/R Aging Summary') {
    return <ARAgingView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'A/P Aging Summary') {
    return <APAgingView onBack={() => setActiveReport(null)} />;
  }

  if (activeReport === 'General Ledger') {
    return <GeneralLedgerView onBack={() => setActiveReport(null)} />;
  }

  return (
    <div>
      <section className="surface-card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div>
          <p className="page-kicker">Financial intelligence</p>
          <h1 className="mt-2 text-3xl tracking-[-0.03em] font-serif font-semibold text-ink-900">Reports</h1>
          <p className="mt-1.5 text-sm text-slate-500">Clear statements, built for decisions and a clean audit trail.</p>
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-slate-500 font-semibold">Display currency</label>
          <select 
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="bg-paper-50 border border-ink-900/15 text-ink-900 text-xs rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-focus-blue-500"
          >
            <option value="KES">KES - Kenyan Shilling</option>
            <option value="USD">USD - US Dollar</option>
            <option value="EUR">EUR - Euro</option>
            <option value="GBP">GBP - British Pound</option>
            <option value="UGX">UGX - Ugandan Shilling</option>
            <option value="TZS">TZS - Tanzanian Shilling</option>
          </select>
        </div>
      </section>
      <div className="ledger-divider mb-6"></div>

      {/* Sub-navigation */}
      <div className="flex gap-1.5 rounded-2xl border border-ink-900/8 bg-paper-100/70 p-1.5 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-semibold transition-colors rounded-xl whitespace-nowrap ${
              activeTab === tab
                ? 'bg-focus-blue-500 text-white shadow-sm'
                : 'text-slate-500 hover:bg-paper-50 hover:text-ink-900'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Standard reports' && (
        <div className="space-y-8">
          {Object.entries(groupedReports).map(([category, reports]) => (
            <div key={category}>
              <h2 className="text-[11px] font-bold text-ink-900 uppercase tracking-[0.12em] mb-4 border-b border-ink-900/10 pb-2">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reports.map(report => (
                  <div 
                    key={report.name} 
                    onClick={() => setActiveReport(report.name)}
                    className="surface-card group p-5 cursor-pointer flex flex-col h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-focus-blue-500/40 hover:shadow-lg"
                  >
                    <h3 className="text-base font-semibold text-focus-blue-500 group-hover:text-ink-900 transition-colors mb-2">
                      {report.name}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed flex-1">
                      {report.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'Custom report builder' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Custom Report Builder</h3>
           <p className="text-slate-500 mb-6">Design tailored financial reports with custom dimension tagging and multi-period comparatives.</p>
           <button
             onClick={() => setNotBuiltMessage('The custom report builder (arbitrary dimension tagging and multi-period comparatives) is not built yet. For now, use the eight Standard Reports, each with real PDF/Excel export.')}
             className="bg-sidebar-bg text-sidebar-ink px-6 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors"
           >
             Create Custom Report
           </button>
        </div>
      )}

      {activeTab === 'Management report packs' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <div className="flex justify-between items-center mb-6">
             <div>
               <h3 className="text-lg font-medium text-ink-900">Management Packs</h3>
               <p className="text-sm text-slate-500">Curated collections of reports (Cover page, Executive Summary, P&L, Balance Sheet) exported as a single PDF.</p>
             </div>
             <button
               onClick={() => setNotBuiltMessage('Custom, named report packs are not built yet. The one pack below (P&L + Balance Sheet) works today — open Standard Reports for the full, real set.')}
               className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors"
             >
               Build New Pack
             </button>
           </div>

           <div className="border border-ink-900/10 rounded-sm p-4 bg-paper-50 flex items-center justify-between">
              <div>
                <p className="font-semibold text-ink-900">Monthly Board Reporting Pack</p>
                <p className="text-xs text-slate-500 mt-1">Contains: P&L, Balance Sheet (real data — open each from Standard Reports for the full report and export)</p>
              </div>
              <button
                onClick={() => setActiveTab('Standard reports')}
                className="text-sm font-medium text-focus-blue-500 border border-focus-blue-500/30 px-3 py-1.5 rounded-sm hover:bg-paper-100 transition-colors"
              >
                Open Reports
              </button>
           </div>
        </div>
      )}

      {activeTab === 'Scheduled/emailed reports' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Scheduled Delivery</h3>
           <p className="text-slate-500 mb-6">Automate your reporting. Set up standard reports or management packs to be emailed to stakeholders weekly or monthly.</p>
           <button
             onClick={() => setNotBuiltMessage('Scheduled email delivery needs a transactional email service (SMTP/SES/Postmark, etc.) wired into the server, which is not configured in this project yet.')}
             className="bg-sidebar-bg text-sidebar-ink px-6 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors"
           >
             + New Schedule
           </button>
        </div>
      )}

      {notBuiltMessage && (
        <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-xs z-50 flex items-center justify-center p-4" onClick={() => setNotBuiltMessage(null)}>
          <div className="bg-paper-100 rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start space-x-3 mb-4">
              <Info className="w-5 h-5 text-focus-blue-500 shrink-0 mt-0.5" />
              <p className="text-sm text-ink-900">{notBuiltMessage}</p>
            </div>
            <button
              onClick={() => setNotBuiltMessage(null)}
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
