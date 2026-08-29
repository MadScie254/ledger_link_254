import { useState } from 'react';
import { useAppStore } from '../../store';
import { ProfitAndLossView } from './ProfitAndLossView';
import { BalanceSheetView } from './BalanceSheetView';
import { CashFlowView } from './CashFlowView';
import { TrialBalanceView } from './TrialBalanceView';
import { TaxSummaryView } from './TaxSummaryView';

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

  if (activeReport) {
    return (
      <div className="max-w-6xl mx-auto">
        <button 
          onClick={() => setActiveReport(null)}
          className="text-sm font-medium text-focus-blue-500 hover:text-ink-900 mb-6 inline-flex items-center"
        >
          &larr; Back to Reports
        </button>
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-16 text-center">
          <h3 className="text-xl font-medium text-ink-900 mb-2">{activeReport}</h3>
          <p className="text-slate-500 mb-6">This report template is configured but awaiting direct ledger aggregation.</p>
          <button className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
            Generate Export (Excel)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-2 flex justify-between items-center">
        <h1 className="text-2xl font-serif text-ink-900">Reports</h1>
        <div className="flex items-center space-x-2">
          <label className="text-sm text-slate-500 font-medium">Currency:</label>
          <select 
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-focus-blue-500"
          >
            <option value="KES">KES - Kenyan Shilling</option>
            <option value="USD">USD - US Dollar</option>
            <option value="EUR">EUR - Euro</option>
            <option value="GBP">GBP - British Pound</option>
            <option value="UGX">UGX - Ugandan Shilling</option>
            <option value="TZS">TZS - Tanzanian Shilling</option>
          </select>
        </div>
      </div>
      <div className="ledger-divider mb-6"></div>

      {/* Sub-navigation */}
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

      {activeTab === 'Standard reports' && (
        <div className="space-y-8">
          {Object.entries(groupedReports).map(([category, reports]) => (
            <div key={category}>
              <h2 className="text-sm font-bold text-ink-900 uppercase tracking-wider mb-4 border-b border-ink-900/10 pb-2">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reports.map(report => (
                  <div 
                    key={report.name} 
                    onClick={() => setActiveReport(report.name)}
                    className="group bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-4 shadow-sm hover:shadow transition-shadow hover:border-focus-blue-500/50 cursor-pointer flex flex-col h-full"
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
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Custom Report Builder</h3>
           <p className="text-slate-500 mb-6">Design tailored financial reports with custom dimension tagging and multi-period comparatives.</p>
           <button className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
             Create Custom Report
           </button>
        </div>
      )}

      {activeTab === 'Management report packs' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <div className="flex justify-between items-center mb-6">
             <div>
               <h3 className="text-lg font-medium text-ink-900">Management Packs</h3>
               <p className="text-sm text-slate-500">Curated collections of reports (Cover page, Executive Summary, P&L, Balance Sheet) exported as a single PDF.</p>
             </div>
             <button className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
               Build New Pack
             </button>
           </div>
           
           <div className="border border-ink-900/10 rounded-sm p-4 bg-paper-50 flex items-center justify-between">
              <div>
                <p className="font-semibold text-ink-900">Monthly Board Reporting Pack</p>
                <p className="text-xs text-slate-500 mt-1">Contains: Executive Summary, P&L, Balance Sheet, Cashflow</p>
              </div>
              <button className="text-sm font-medium text-focus-blue-500 border border-focus-blue-500/30 px-3 py-1.5 rounded-sm hover:bg-white dark:bg-[#111827] transition-colors">
                Export PDF
              </button>
           </div>
        </div>
      )}

      {activeTab === 'Scheduled/emailed reports' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Scheduled Delivery</h3>
           <p className="text-slate-500 mb-6">Automate your reporting. Set up standard reports or management packs to be emailed to stakeholders weekly or monthly.</p>
           <button className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
             + New Schedule
           </button>
        </div>
      )}
    </div>
  );
}
