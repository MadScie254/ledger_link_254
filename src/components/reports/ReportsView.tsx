import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store';
import { ProfitAndLossView } from './ProfitAndLossView';
import { BalanceSheetView } from './BalanceSheetView';
import { CashFlowView } from './CashFlowView';
import { TrialBalanceView } from './TrialBalanceView';
import { TaxSummaryView } from './TaxSummaryView';
import { ARAgingView, APAgingView } from './ARAgingView';
import { GeneralLedgerView } from './GeneralLedgerView';
import {
  ExpensesBySupplierView,
  MonthlyProfitAndLossView,
  PartyStatementView,
  ProfitAndLossByTagView,
  SalesByCustomerView,
  SalesByItemView,
} from './BusinessReports';
import { PageHeading } from '../ledger/Page';

/**
 * The contents page of the book's reports. Report ids are the keys the
 * statement views are opened by; names are what the reader sees.
 */
const CONTENTS = [
  {
    section: 'The business at a glance',
    reports: [
      { id: 'Profit & Loss', name: 'Profit and loss', desc: 'Income less cost of sales and expenses, down to net profit.' },
      { id: 'Balance Sheet', name: 'Balance sheet', desc: 'What the business owns, what it owes, and the equity between them.' },
      { id: 'Statement of Cash Flows', name: 'Cash flow statement', desc: 'Cash in and out across operating, investing and financing.' },
      { id: 'Profit & Loss by Month', name: 'Profit and loss by month', desc: 'Each income, cost and expense account, a column for every month.' },
      { id: 'Profit & Loss by Class', name: 'Profit and loss by class', desc: 'A column for each line of business or department.' },
      { id: 'Profit & Loss by Location', name: 'Profit and loss by location', desc: 'A column for each branch, shop or site.' },
    ],
  },
  {
    section: 'Sales and spending',
    reports: [
      { id: 'Sales by Customer', name: 'Sales by customer', desc: 'Invoiced, paid on the spot and credited, for each customer.' },
      { id: 'Sales by Item', name: 'Sales by item', desc: 'Quantity and value sold of each stock item, less returns.' },
      { id: 'Expenses by Supplier', name: 'Spending by supplier', desc: 'Bills and expenses for each supplier, less their credits.' },
    ],
  },
  {
    section: 'Who owes whom',
    reports: [
      { id: 'A/R Aging Summary', name: 'Receivables by age', desc: 'Unpaid customer invoices, grouped by days past due.' },
      { id: 'A/P Aging Summary', name: 'Payables by age', desc: 'Unpaid supplier bills, grouped by days past due.' },
      { id: 'Customer Statement', name: 'Customer statement', desc: 'One customer’s account for a period, with a running balance, ready to send as a PDF.' },
      { id: 'Supplier Statement', name: 'Supplier statement', desc: 'One supplier’s account for a period, to check against the statement they send.' },
    ],
  },
  {
    section: 'For the accountant',
    reports: [
      { id: 'Trial Balance', name: 'Trial balance', desc: 'Every account’s debit or credit balance, with the totals that must agree.' },
      { id: 'General Ledger', name: 'General ledger', desc: 'Every line posted to one account, with balances brought and carried forward.' },
    ],
  },
  {
    section: 'Tax',
    reports: [
      { id: 'Tax Summary (KRA VAT & eTIMS)', name: 'VAT and eTIMS summary', desc: 'Output and input VAT for the period, the net due to KRA, and the eTIMS invoice queue.' },
    ],
  },
];

export function ReportsView() {
  const { displayCurrency, setDisplayCurrency, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const back = () => setActiveReport(null);

  switch (activeReport) {
    case 'Profit & Loss':
      return <ProfitAndLossView onBack={back} />;
    case 'Balance Sheet':
      return <BalanceSheetView onBack={back} />;
    case 'Statement of Cash Flows':
      return <CashFlowView onBack={back} />;
    case 'Trial Balance':
      return <TrialBalanceView onBack={back} />;
    case 'Tax Summary (KRA VAT & eTIMS)':
      return <TaxSummaryView onBack={back} />;
    case 'A/R Aging Summary':
      return <ARAgingView onBack={back} />;
    case 'A/P Aging Summary':
      return <APAgingView onBack={back} />;
    case 'General Ledger':
      return <GeneralLedgerView onBack={back} />;
    case 'Profit & Loss by Month':
      return <MonthlyProfitAndLossView onBack={back} />;
    case 'Profit & Loss by Class':
      return <ProfitAndLossByTagView onBack={back} kind="CLASS" />;
    case 'Profit & Loss by Location':
      return <ProfitAndLossByTagView onBack={back} kind="LOCATION" />;
    case 'Sales by Customer':
      return <SalesByCustomerView onBack={back} />;
    case 'Sales by Item':
      return <SalesByItemView onBack={back} />;
    case 'Expenses by Supplier':
      return <ExpensesBySupplierView onBack={back} />;
    case 'Customer Statement':
      return <PartyStatementView onBack={back} partyType="CUSTOMER" />;
    case 'Supplier Statement':
      return <PartyStatementView onBack={back} partyType="VENDOR" />;
  }

  return (
    <div className="space-y-6 pb-16">
      <PageHeading
        tourId="reports-overview"
        title="Reports"
        note={<>Financial statements and schedules, each with PDF and CSV export</>}
        actions={
          <label className="flex items-center gap-2 text-[13px] text-graphite-600">
            <span>Show figures in</span>
            <select
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value)}
              className="h-9 px-2.5 text-[13.5px] border border-field rounded-sm bg-paper-100 text-ink-900"
            >
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="UGX">UGX</option>
              <option value="TZS">TZS</option>
            </select>
          </label>
        }
      />

      {displayCurrency !== baseCurrency && (
        <p className="border-b border-feint pb-2.5 text-[13px] text-ledger-red">
          The books are kept in {baseCurrency}. Figures in these reports are translated to {displayCurrency} at the latest stored rate, not the rate on each transaction’s date.
        </p>
      )}

      <nav aria-label="Reports" className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
        {CONTENTS.map((group) => (
          <section key={group.section} aria-labelledby={`contents-${group.section}`}>
            <h2 id={`contents-${group.section}`} className="ll-printed border-b border-feint-strong pb-2 text-[11.5px] text-graphite-600">
              {group.section}
            </h2>
            <ul>
              {group.reports.map((report) => (
                <li key={report.id} className="border-b border-feint">
                  <button type="button" onClick={() => setActiveReport(report.id)} className="group flex w-full items-start justify-between gap-4 py-3 text-left">
                    <span className="min-w-0">
                      <span className="block text-[15px] text-ink-900 group-hover:underline underline-offset-[3px]">{report.name}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-graphite-600">{report.desc}</span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-graphite-500 group-hover:text-ink-900" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}
