import type { Edition } from './editions.ts';

/**
 * One line in the Reports contents page. Most reports open inline, inside
 * Reports itself, identified by `id` (the key ProfitAndLossView and friends
 * switch on). A few belong to a view that already lives elsewhere in the
 * edition's own sidebar (the law client account, the church treasurer's
 * report); those carry `navigate` instead, and Reports hands off to that
 * view rather than rendering it inline.
 */
export type ReportEntry =
  | { id: string; name: string; desc: string; navigate?: undefined }
  | { navigate: string; name: string; desc: string; id?: undefined };

export interface ReportSection {
  section: string;
  reports: ReportEntry[];
}

/** The reports every edition gets: the general-purpose books. */
export const BASE_REPORT_CONTENTS: ReportSection[] = [
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
      { id: 'Input VAT at risk', name: 'Input VAT at risk', desc: 'Posted purchase VAT with no supplier CU number or exemption reason, by month and supplier.' },
    ],
  },
];

/** The compliance report a law firm (Mizani) needs that a general business does not. */
const LAW_REPORT_SECTION: ReportSection = {
  section: 'Client account',
  reports: [
    {
      navigate: 'Law / Client account',
      name: 'Client account reconciliation',
      desc: 'Bank statement, cash book and matter ledgers for client money, side by side, signed on the date they agree. Required by the Law Society of Kenya.',
    },
  ],
};

/** The fund reports a church (Kundi) needs that a general business does not. */
const CHURCH_REPORT_SECTION: ReportSection = {
  section: 'Treasurer and funds',
  reports: [
    {
      navigate: "Church / Treasurer's report",
      name: "Treasurer's report",
      desc: 'Giving, spending and money on hand for the month, ready to read to the church council.',
    },
    {
      navigate: 'Church / Fund balances',
      name: 'Fund balances',
      desc: 'Opening, income, expense and closing balance for every fund, restricted and general, checked against the ledger.',
    },
  ],
};

/**
 * The Reports contents page for an edition: the base books, plus whatever
 * that edition's own compliance reports add. Business gets only the base
 * books; Mizani (law) and Kundi (church) each add their own section.
 */
export function reportContentsFor(edition: Edition | null | undefined): ReportSection[] {
  if (edition === 'law') return [...BASE_REPORT_CONTENTS, LAW_REPORT_SECTION];
  if (edition === 'church') return [...BASE_REPORT_CONTENTS, CHURCH_REPORT_SECTION];
  return BASE_REPORT_CONTENTS;
}
