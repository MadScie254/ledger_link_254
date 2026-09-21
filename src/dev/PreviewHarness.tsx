/**
 * Development-only preview of signed-in screens, for design review without an
 * account. Mounted from main.tsx behind `import.meta.env.MODE === 'development'`, so production
 * builds drop this file and its fixtures entirely.
 *
 *   /__preview?view=Home%20/%20Dashboard&theme=dark
 *   /__preview/lock
 *   /__preview/ledger
 *   /__preview/tour?step=0        the product tour (add &tour=ask for the welcome dialog)
 *   ...&fail=/api/dashboard/metrics   make those routes answer 500
 *
 * The figures follow the seeded Riverside Hardware demo tenant. Customer and
 * supplier names are invented sample data.
 */
import { useEffect, useState, type ComponentType } from 'react';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '../store';
import { AppLayout } from '../components/layout/AppLayout';
import { LockScreen } from '../components/layout/LockScreen';
import { TenantProvider } from '../context/TenantContext';
import { DashboardView } from '../components/dashboard/DashboardView';
import { SalesView } from '../components/sales/SalesView';
import { BankingView } from '../components/banking/BankingView';
import { ReportsView } from '../components/reports/ReportsView';
import { ExpensesView } from '../components/expenses/ExpensesView';
import { PayrollView } from '../components/payroll/PayrollView';
import { InventoryView } from '../components/inventory/InventoryView';
import { TaxView } from '../components/tax/TaxView';
import { ProjectsView } from '../components/projects/ProjectsView';
import { CustomerHubView } from '../components/crm/CustomerHubView';
import { AccountingView } from '../components/accounting/AccountingView';
import { BusinessFeedView } from '../components/feed/BusinessFeedView';
import { TeamView } from '../components/team/TeamView';
import { AppsView } from '../components/apps/AppsView';
import { AuditLogView } from '../components/audit/AuditLogView';
import { SystemHealthView } from '../components/health/SystemHealthView';
import { SettingsView } from '../components/settings/SettingsView';
import { GeneralLedgerView } from '../components/reports/GeneralLedgerView';
import { AuthContext } from '../context/AuthProvider';
import { OnboardingProvider } from '../components/onboarding/OnboardingProvider';

const ORG = {
  id: '146b2a09-11b0-47bd-a0ba-d9f27f1f12ec',
  name: 'Riverside Hardware Ltd',
  legalName: 'Riverside Hardware Limited',
  baseCurrency: 'KES',
  country: 'Kenya',
  city: 'Nairobi',
  isDemo: true,
};

const entry = (id: number, date: string, memo: string, cents: number, source = 'MANUAL') => ({
  id: `je-${id}`,
  orgId: ORG.id,
  entryDate: date,
  memo,
  referenceNo: `JE-${String(id).padStart(4, '0')}`,
  sourceType: source,
  lines: [
    { id: `l-${id}-d`, debit: cents, credit: 0, description: memo },
    { id: `l-${id}-c`, debit: 0, credit: cents, description: memo },
  ],
});

/** Six weeks of sample till activity, long enough to scroll the ledger. */
function mpesaTillLines() {
  const lines = [];
  const start = new Date('2026-07-01');
  for (let day = 0; day < 42; day++) {
    const date = new Date(start.getTime() + day * 86_400_000).toISOString().slice(0, 10);
    lines.push({ id: `m-${day}-in`, date, sourceType: 'MANUAL', memo: 'M-Pesa counter sales', debit: 3_850_000 + ((day * 137_000) % 2_400_000), credit: 0 });
    if (day % 7 === 6) {
      lines.push({ id: `m-${day}-out`, date, sourceType: 'MANUAL', memo: 'Transfer to KCB account', debit: 0, credit: 24_000_000 });
    }
  }
  return lines;
}

const FIXTURES: Record<string, unknown> = {
  '/api/organizations': { organizations: [ORG] },
  '/api/dashboard/metrics': {
    cashPositionCents: 193_125_000,
    moneyInCents: 54_000_000,
    overdueInvoices: 1,
    overdueCents: 28_500_000,
    moneyOutCents: 80_000_000,
    totalIncomeCents: 230_000_000,
    totalCogsCents: 137_000_000,
    totalExpenseCents: 64_650_000,
    netProfitCents: 28_350_000,
    monthlyTrends: [
      { month: 'Mar', revenue: 1_500_000, expense: 900_000 },
      { month: 'Apr', revenue: 800_000, expense: 470_000 },
      { month: 'May', revenue: 0, expense: 420_000 },
      { month: 'Jun', revenue: 0, expense: 226_500 },
    ],
    unrealizedFX: {
      totalUnrealizedGainLossCents: -1_240_000,
      receivablesGainLossCents: 380_000,
      payablesGainLossCents: -1_620_000,
      bankHoldingsGainLossCents: 0,
      currencySummaries: [{ currency: 'USD', rate: 0.00773 }, { currency: 'UGX', rate: 28.4 }],
    },
  },
  '/api/invoices': {
    invoices: [
      { id: 'inv-41', invoiceNumber: 'INV-2026-0041', customerId: 'c-1', invoiceNo: 'INV-2026-0041', totalCents: 28_500_000, status: 'OVERDUE', currency: 'KES', issueDate: '2026-03-15', dueDate: '2026-04-14' },
      { id: 'inv-43', invoiceNumber: 'INV-2026-0043', customerId: 'c-2', invoiceNo: 'INV-2026-0043', totalCents: 14_500_000, status: 'SENT', currency: 'KES', issueDate: '2026-08-20', dueDate: '2026-09-19' },
      { id: 'inv-44', invoiceNumber: 'INV-2026-0044', customerId: 'c-3', invoiceNo: 'INV-2026-0044', totalCents: 11_000_000, status: 'SENT', currency: 'KES', issueDate: '2026-09-02', dueDate: '2026-10-02' },
      { id: 'inv-39', invoiceNumber: 'INV-2026-0039', customerId: 'c-2', invoiceNo: 'INV-2026-0039', totalCents: 120_000_000, status: 'PAID', currency: 'KES', issueDate: '2026-03-10', dueDate: '2026-04-09' },
    ],
  },
  '/api/vendors': {
    vendors: [
      { id: 'v-1', displayName: 'Nairobi Steel Supplies', email: 'accounts@nairobisteel.example', balance: 50_000_000 },
      { id: 'v-2', displayName: 'Athi River Cement Traders', email: 'billing@athicement.example', balance: 30_000_000 },
    ],
  },
  '/api/customers': {
    customers: [
      { id: 'c-1', displayName: 'Mwangaza Builders', email: 'pay@mwangaza.example', balance: 28_500_000 },
      { id: 'c-2', displayName: 'Kiambu Contractors', email: 'finance@kiambucon.example', balance: 14_500_000 },
      { id: 'c-3', displayName: 'Baraka Construction', email: 'ap@baraka.example', balance: 11_000_000 },
    ],
  },
  '/api/journal-entries': {
    entries: [
      entry(12, '2026-06-15', 'Electricity and water', 4_650_000),
      entry(11, '2026-06-01', 'Rent, second quarter', 18_000_000),
      entry(10, '2026-05-31', 'Payroll, May 2026', 42_000_000, 'PAYROLL'),
      entry(9, '2026-05-05', 'Supplier payment', 80_000_000, 'BILL'),
      entry(8, '2026-04-30', 'Customer receipts against March invoices', 120_000_000, 'INVOICE'),
      entry(7, '2026-04-02', 'Cost of goods sold, counter sales', 47_000_000),
      entry(6, '2026-04-02', 'M-Pesa counter sales, VAT at 16%', 92_800_000),
      entry(5, '2026-03-15', 'Cost of goods sold, March credit sales', 90_000_000),
      entry(4, '2026-03-15', 'Credit sales, March, VAT at 16%', 174_000_000, 'INVOICE'),
    ],
  },
  '/api/bills': {
    bills: [
      { id: 'b-1', billNumber: 'NSS-4471', vendorId: 'v-1', billDate: '2026-08-28', dueDate: '2026-09-27', totalCents: 50_000_000, status: 'OPEN' },
      { id: 'b-2', billNumber: 'ARC-0913', vendorId: 'v-2', billDate: '2026-08-02', dueDate: '2026-09-01', totalCents: 30_000_000, status: 'OPEN' },
      { id: 'b-3', billNumber: 'NSS-4402', vendorId: 'v-1', billDate: '2026-06-30', dueDate: '2026-07-30', totalCents: 18_500_000, status: 'PAID' },
    ],
  },
  '/api/employees': {
    employees: [
      { id: 'e-1', firstName: 'Wanjiru', lastName: 'Kamau', email: 'wanjiru@riverside.example', kraPin: 'A012345678Z', baseSalaryCents: 8_500_000, status: 'Active' },
      { id: 'e-2', firstName: 'Otieno', lastName: 'Ochieng', email: 'otieno@riverside.example', kraPin: 'A019876543K', baseSalaryCents: 6_200_000, status: 'Active' },
      { id: 'e-3', firstName: 'Amina', lastName: 'Hassan', email: 'amina@riverside.example', kraPin: 'A015551234P', baseSalaryCents: 4_800_000, status: 'Active' },
    ],
  },
  '/api/accounts': {
    accounts: [
      { id: 'a-1000', code: '1000', name: 'Cash at Bank - KCB', type: 'ASSET', balanceCents: 94_975_000 },
      { id: 'a-1010', code: '1010', name: 'M-Pesa Till', type: 'ASSET', balanceCents: 98_150_000 },
      { id: 'a-1100', code: '1100', name: 'Accounts Receivable', type: 'ASSET', balanceCents: 54_000_000 },
      { id: 'a-4000', code: '4000', name: 'Sales Revenue', type: 'INCOME', balanceCents: 230_000_000 },
    ],
  },
  '/api/inventory': {
    items: [
      { id: 'i-1', name: 'Cement 50kg, Bamburi', sku: 'CEM-50-BAM', unitOfMeasure: 'bags', unitPriceCents: 85_000, costPriceCents: 72_000, quantityOnHand: 340, reorderPoint: 120 },
      { id: 'i-2', name: 'Y12 deformed bar, 12m', sku: 'STL-Y12-12', unitOfMeasure: 'lengths', unitPriceCents: 118_000, costPriceCents: 98_500, quantityOnHand: 64, reorderPoint: 80 },
      { id: 'i-3', name: 'Iron sheets, gauge 30, 3m', sku: 'ROF-G30-3', unitOfMeasure: 'sheets', unitPriceCents: 92_000, costPriceCents: 76_000, quantityOnHand: 210, reorderPoint: 60 },
      { id: 'i-4', name: 'Crown emulsion, white 20L', sku: 'PNT-CRW-20', unitOfMeasure: 'tins', unitPriceCents: 780_000, costPriceCents: 640_000, quantityOnHand: 9, reorderPoint: 12 },
    ],
  },
  '/api/reports/tax-summary': {
    outputVat: { standardRatedSalesCents: 174_000_000, vatRatePercent: 16, taxAmountCents: 24_000_000 },
    inputVat: { claimablePurchasesCents: 87_000_000, vatRatePercent: 16, taxAmountCents: 12_000_000 },
    withholdingTaxVat: { withholdingRatePercent: 2, withheldAmountCents: 0 },
    netVatPayableCents: 12_000_000,
    etimsVerifiedCount: 0,
    etimsPendingCount: 3,
    kraPin: 'P051234567Z',
  },
  '/api/projects': {
    projects: [
      { id: 'p-1', name: 'Kiambu Road warehouse fit-out', projectCode: 'PRJ-07', customerId: 'c-2', status: 'In progress', budgetCents: 450_000_000, costCents: 312_000_000 },
      { id: 'p-2', name: 'Baraka site, roofing supply', projectCode: 'PRJ-08', customerId: 'c-3', status: 'In progress', budgetCents: 120_000_000, costCents: 131_500_000 },
      { id: 'p-3', name: 'Showroom repaint', projectCode: 'PRJ-09', status: 'Planned', budgetCents: 0, costCents: 0 },
    ],
  },
  '/api/time-entries': {
    entries: [
      { id: 'te-1', projectId: 'p-1', projectName: 'Kiambu Road warehouse fit-out', entryDate: '2026-09-15', hours: 6.5, description: 'Site survey and bill of quantities' },
      { id: 'te-2', projectId: 'p-2', projectName: 'Baraka site, roofing supply', entryDate: '2026-09-14', hours: 3, description: 'Delivery supervision' },
    ],
  },
  '/api/team': {
    members: [
      { id: 'm-1', userId: 'u-1', email: 'owner@riverside.example', role: 'owner', status: 'active', isYou: true },
      { id: 'm-2', userId: 'u-2', email: 'accounts@riverside.example', role: 'admin', status: 'active', isYou: false },
      { id: 'm-3', userId: 'u-3', email: 'counter@riverside.example', role: 'member', status: 'invited', isYou: false },
    ],
  },
  '/api/audit': {
    logs: [
      { id: 'al-1', userId: 'u-2', action: 'CREATE', resourceType: 'JOURNAL_ENTRY', resourceId: 'je-12', details: { memo: 'Electricity and water', amountCents: 4650000 }, timestamp: '2026-09-16T09:42:00Z' },
      { id: 'al-2', userId: 'u-1', action: 'CREATE', resourceType: 'TEAM_MEMBER', resourceId: 'm-3', details: { email: 'counter@riverside.example', role: 'member' }, timestamp: '2026-09-15T16:05:00Z' },
      { id: 'al-3', userId: 'u-2', action: 'UPDATE', resourceType: 'ACCOUNT', resourceId: 'a-1010', details: { name: 'M-Pesa Till' }, timestamp: '2026-09-12T11:20:00Z' },
    ],
  },
  '/api/budgets': {
    budgets: [
      { id: 'bg-1', accountId: 'a-6200', categoryName: 'Office rent and utilities', accountCode: '6200', period: 'MONTHLY', limitCents: 25_000_000, spentCents: 22_650_000 },
      { id: 'bg-2', accountId: 'a-6000', categoryName: 'Operating expenses', accountCode: '6000', period: 'QUARTERLY', limitCents: 30_000_000, spentCents: 34_100_000 },
    ],
  },
  '/api/payroll/runs': {
    runs: [{ id: 'run-8', period: 'August 2026', payDate: '2026-08-31', status: 'POSTED' }],
  },
  '/api/banking/rules': {
    rules: [{ id: 'r-1', matchText: 'SAFARICOM', targetAccountCode: '6200', targetAccountName: 'Office rent and utilities' }],
  },
  '/api/banking/reconciliation': { statementBalanceCents: 94_975_000, glBalanceCents: 80_475_000, varianceCents: 14_500_000, transactionCount: 4 },
  '/api/currency/unrealized-fx': {
    totalUnrealizedGainLossCents: -1_240_000,
    items: [
      { id: 'fx-1', entityType: 'BILL', referenceNo: 'BILL-2026-0017', partyName: 'Kampala Timber Co', foreignCurrency: 'UGX', foreignAmountCents: 5_800_000_000, bookedRate: 28.9, currentRate: 28.4, gainLossCents: -1_620_000 },
      { id: 'fx-2', entityType: 'INVOICE', referenceNo: 'INV-2026-0038', partyName: 'Lakeview Lodges', foreignCurrency: 'USD', foreignAmountCents: 250_000, bookedRate: 0.00776, currentRate: 0.00773, gainLossCents: 380_000 },
    ],
  },
  '/api/reports/ledger': { lines: mpesaTillLines() },
  '/api/banking/ai-matches': {
    matches: [
      { transactionId: 't-2', confidence: 92, matchedEntityNumber: 'INV-2026-0043', suggestedAccountCode: '1100', suggestedAccountName: 'Accounts Receivable' },
      { transactionId: 't-3', confidence: 71, suggestedAccountCode: '2000', suggestedAccountName: 'Accounts Payable' },
    ],
  },
  '/api/banking/transactions': {
    transactions: [
      { id: 't-1', date: '2026-09-15', description: 'M-Pesa QJK4XS2L1 from 0712 xxx 234', amountCents: 450_000, direction: 'IN', status: 'UNMATCHED' },
      { id: 't-2', date: '2026-09-15', description: 'M-Pesa QJK7PL9A2 from Kiambu Contractors, 0722 xxx 918', amountCents: 14_500_000, direction: 'IN', status: 'UNMATCHED' },
      { id: 't-3', date: '2026-09-14', description: 'KCB transfer, Nairobi Steel Supplies', amountCents: 5_000_000, direction: 'OUT', status: 'UNMATCHED' },
      { id: 't-4', date: '2026-09-12', description: 'M-Pesa QJH2ZX8M4 from 0733 xxx 101', amountCents: 320_000, direction: 'IN', status: 'MATCHED' },
    ],
  },
};

const PAYSLIPS = {
  payslips: [
    { id: 'ps-1', employeeName: 'Wanjiru Kamau', grossCents: 8_500_000, payeCents: 1_698_335, nssfCents: 216_000, shifCents: 233_750, ahlCents: 127_500, netCents: 6_224_415 },
    { id: 'ps-2', employeeName: 'Otieno Ochieng', grossCents: 6_200_000, payeCents: 1_008_335, nssfCents: 216_000, shifCents: 170_500, ahlCents: 93_000, netCents: 4_712_165 },
    { id: 'ps-3', employeeName: 'Amina Hassan', grossCents: 4_800_000, payeCents: 588_335, nssfCents: 216_000, shifCents: 132_000, ahlCents: 72_000, netCents: 3_791_665 },
  ],
};

/** A stand-in session so the tour can run without signing in. Never leaves this file. */
const PREVIEW_AUTH = {
  session: { user: { id: 'preview-user' } } as any,
  user: { id: 'preview-user' } as any,
  signOut: async () => undefined,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null, needsEmailConfirmation: false }),
};

function installFixtureFetch() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method || 'GET').toUpperCase();
    // ?fail=/api/dashboard/metrics,/api/invoices answers those routes with a 500, to see error states.
    const failing = (new URLSearchParams(window.location.search).get('fail') || '').split(',');
    if (failing.includes(url.pathname)) {
      return new Response(JSON.stringify({ error: 'Preview failure' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/api/onboarding' && method === 'GET') {
      const params = new URLSearchParams(window.location.search);
      const state = { status: params.get('tour') === 'ask' ? 'NOT_ASKED' : 'IN_PROGRESS', step: Number(params.get('step') || 0) };
      return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const payslips = /^\/api\/payroll\/runs\/[^/]+\/payslips$/.test(url.pathname) ? PAYSLIPS : undefined;
    const body = method === 'GET' ? payslips ?? FIXTURES[url.pathname] ?? {} : { success: true };
    await new Promise((resolve) => setTimeout(resolve, 120));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const VIEWS: Record<string, ComponentType> = {
  'Home / Dashboard': DashboardView,
  'Business Feed': BusinessFeedView,
  Team: TeamView,
  'Apps / Integrations': AppsView,
  Sales: SalesView,
  Banking: BankingView,
  Reports: ReportsView,
  'Expenses & Bills': ExpensesView,
  Payroll: PayrollView,
  Inventory: InventoryView,
  Tax: TaxView,
  Projects: ProjectsView,
  'Customer Hub': CustomerHubView,
  Accounting: AccountingView,
  'Audit Logs': AuditLogView,
  'System Health': SystemHealthView,
  Settings: SettingsView,
};

function PreviewApp() {
  const params = new URLSearchParams(window.location.search);
  const store = useAppStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    store.setOrganizations([ORG] as any);
    store.setActiveCompany(ORG as any);
    store.setCurrentOrgId(ORG.id);
    store.setDisplayCurrency('KES');
    store.setTheme(params.get('theme') === 'dark' ? 'dark' : 'light');
    store.setActiveView(params.get('view') || 'Home / Dashboard');
    setReady(true);
    // One-time setup for the preview session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;
  if (window.location.pathname.startsWith('/__preview/lock')) return <LockScreen />;
  if (window.location.pathname.startsWith('/__preview/ledger')) {
    return (
      <TenantProvider>
        <AppLayout>
          <GeneralLedgerView onBack={() => undefined} initialAccountName="M-Pesa Till" />
        </AppLayout>
      </TenantProvider>
    );
  }

  const View = VIEWS[store.activeView] || DashboardView;
  if (window.location.pathname.startsWith('/__preview/tour')) {
    return (
      <AuthContext.Provider value={PREVIEW_AUTH}>
        <OnboardingProvider>
          <TenantProvider>
            <AppLayout>
              <View />
            </AppLayout>
          </TenantProvider>
        </OnboardingProvider>
      </AuthContext.Provider>
    );
  }
  return (
    <TenantProvider>
      <AppLayout>
        <View />
      </AppLayout>
    </TenantProvider>
  );
}

/** ?motion=off answers the reduced-motion query, for headless checks where animation frames never run. */
function forceReducedMotion() {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const list = real(query);
    if (!query.includes('prefers-reduced-motion')) return list;
    return new Proxy(list, {
      get: (target, key) => {
        if (key === 'matches') return true;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
}

export function mountPreview(root: Root) {
  if (new URLSearchParams(window.location.search).get('motion') === 'off') forceReducedMotion();
  installFixtureFetch();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root.render(
    <QueryClientProvider client={queryClient}>
      <PreviewApp />
    </QueryClientProvider>,
  );
}
