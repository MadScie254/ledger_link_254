/**
 * Development-only preview of signed-in screens, for design review without an
 * account. Mounted from main.tsx behind `import.meta.env.MODE === 'development'`, so production
 * builds drop this file and its fixtures entirely.
 *
 *   /__preview?view=Home%20/%20Dashboard&theme=dark
 *   /__preview/lock
 *   /__preview/ledger
 *   /__preview/tour?step=0        the product tour (add &tour=ask for the welcome dialog)
 *   ...&ai=on                     as an organization with AI features turned on
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
import { DocumentationView } from '../components/documentation/DocumentationView';
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
  role: 'owner' as const,
  timeZone: 'Africa/Nairobi',
  booksClosedThrough: '2026-06-30',
  approvalThresholdCents: 40_000_000,
  aiEnabled: false,
};

const orderLine = (itemId: string | null, description: string, quantity: number, unitPriceCents: number, quantityOnHand: number | null) => {
  const amountCents = quantity * unitPriceCents;
  return {
    id: `${itemId || 'free'}-${description}`,
    description,
    inventoryItemId: itemId,
    itemName: itemId ? description : null,
    itemType: itemId ? 'Physical Product' : null,
    quantityOnHand,
    accountId: 'a-4000',
    quantity,
    unitPriceCents,
    taxRate: 16,
    amountCents,
    taxCents: Math.round(amountCents * 0.16),
  };
};

const salesOrder = (
  id: string, orderNumber: string, customerId: string, orderDate: string, promisedDate: string | null,
  status: string, lines: ReturnType<typeof orderLine>[], notes?: string, extra: Record<string, unknown> = {},
) => {
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  const customerNames: Record<string, string> = { 'c-1': 'Mwangaza Builders', 'c-2': 'Kiambu Contractors', 'c-3': 'Baraka Construction' };
  return {
    id, orderNumber, customerId, customerName: customerNames[customerId], orderDate, promisedDate, status, currency: 'KES',
    subtotalCents, taxCents, totalCents: subtotalCents + taxCents, notes: notes ?? null,
    invoiceId: null, invoiceNumber: null, invoiceStatus: null, completedAt: null, cancelledAt: null, cancelReason: null,
    createdAt: `${orderDate}T08:00:00Z`, lines, ...extra,
  };
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
      { period: '2026-03', month: 'Mar', year: 2026, revenue: 1_500_000, expense: 900_000, revenueCents: 150_000_000, expenseCents: 90_000_000 },
      { period: '2026-04', month: 'Apr', year: 2026, revenue: 800_000, expense: 470_000, revenueCents: 80_000_000, expenseCents: 47_000_000 },
      { period: '2026-05', month: 'May', year: 2026, revenue: 0, expense: 420_000, revenueCents: 0, expenseCents: 42_000_000 },
      { period: '2026-06', month: 'Jun', year: 2026, revenue: 0, expense: 226_500, revenueCents: 0, expenseCents: 22_650_000 },
    ],
    unrealizedFX: {
      totalUnrealizedGainLossCents: -1_240_000,
      receivablesGainLossCents: 380_000,
      payablesGainLossCents: -1_620_000,
      bankHoldingsGainLossCents: 0,
      currencySummaries: [{ currency: 'USD', rate: 0.00773 }, { currency: 'UGX', rate: 28.4 }],
    },
  },
  '/api/reports/pnl': {
    income: [{ name: 'Sales Revenue', amountCents: 230_000_000 }],
    costOfSales: [{ name: 'Cost of goods sold', amountCents: 137_000_000 }],
    expenses: [
      { name: 'Payroll', amountCents: 42_000_000 },
      { name: 'Rent', amountCents: 18_000_000 },
      { name: 'Utilities', amountCents: 4_650_000 },
    ],
  },
  '/api/reports/pnl-monthly': {
    months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
    income: { months: [24_000_000, 31_000_000, 46_000_000, 33_000_000, 52_000_000, 44_000_000] },
    costOfSales: { months: [13_000_000, 18_000_000, 29_000_000, 19_000_000, 33_000_000, 25_000_000] },
    expenses: { months: [7_000_000, 9_000_000, 11_000_000, 10_000_000, 15_000_000, 12_650_000] },
  },
  '/api/invoices': {
    invoices: [
      { id: 'inv-41', invoiceNumber: 'INV-2026-0041', customerId: 'c-1', invoiceNo: 'INV-2026-0041', totalCents: 28_500_000, amountDueCents: 28_500_000, status: 'OVERDUE', currency: 'KES', issueDate: '2026-03-15', dueDate: '2026-04-14' },
      { id: 'inv-43', invoiceNumber: 'INV-2026-0043', customerId: 'c-2', invoiceNo: 'INV-2026-0043', totalCents: 14_500_000, amountDueCents: 14_500_000, status: 'SENT', currency: 'KES', issueDate: '2026-08-20', dueDate: '2026-11-19' },
      { id: 'inv-44', invoiceNumber: 'INV-2026-0044', customerId: 'c-3', invoiceNo: 'INV-2026-0044', totalCents: 11_000_000, amountDueCents: 11_000_000, status: 'SENT', currency: 'KES', issueDate: '2026-09-02', dueDate: '2026-11-02' },
      { id: 'inv-39', invoiceNumber: 'INV-2026-0039', customerId: 'c-2', invoiceNo: 'INV-2026-0039', totalCents: 120_000_000, amountDueCents: 0, status: 'PAID', currency: 'KES', issueDate: '2026-03-10', dueDate: '2026-04-09', payments: [{ amountCents: 120_000_000, paymentDate: '2026-09-24', reversedAt: null }] },
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
      { id: 'b-1', billNumber: 'BILL-2026-0021', billNo: 'BILL-2026-0021', supplierReference: 'NSS-4471', vendorId: 'v-1', billDate: '2026-08-28', dueDate: '2026-09-27', totalCents: 50_000_000, amountDueCents: 50_000_000, status: 'OPEN', approvedAt: null },
      { id: 'b-2', billNumber: 'BILL-2026-0019', billNo: 'BILL-2026-0019', supplierReference: 'ARC-0913', vendorId: 'v-2', billDate: '2026-08-02', dueDate: '2026-09-01', totalCents: 30_000_000, amountDueCents: 30_000_000, status: 'OPEN', approvedAt: null },
      { id: 'b-3', billNumber: 'BILL-2026-0012', billNo: 'BILL-2026-0012', supplierReference: 'NSS-4402', vendorId: 'v-1', billDate: '2026-06-30', dueDate: '2026-07-30', totalCents: 18_500_000, amountDueCents: 0, status: 'PAID', approvedAt: null },
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
      { id: 'a-1000', code: '1000', name: 'Cash at Bank - KCB', type: 'ASSET', balanceCents: 94_975_000, isBankAccount: true, isActive: true, isSystem: true },
      { id: 'a-1010', code: '1010', name: 'M-Pesa Till', type: 'ASSET', balanceCents: 98_150_000, isBankAccount: true, isActive: true, isSystem: false },
      { id: 'a-1100', code: '1100', name: 'Accounts Receivable', type: 'ASSET', balanceCents: 54_000_000, isBankAccount: false, isActive: true, isSystem: true },
      { id: 'a-1300', code: '1300', name: 'Staff advances (closed)', type: 'ASSET', balanceCents: 0, isBankAccount: false, isActive: false, isSystem: false },
      { id: 'a-4000', code: '4000', name: 'Sales Revenue', type: 'INCOME', balanceCents: 230_000_000, isBankAccount: false, isActive: true, isSystem: false },
    ],
  },
  '/api/inventory': {
    items: [
      { id: 'i-1', name: 'Cement 50kg, Bamburi', type: 'Physical Product', incomeAccountId: 'a-4000', sku: 'CEM-50-BAM', unitOfMeasure: 'bags', unitPriceCents: 85_000, costPriceCents: 72_000, quantityOnHand: 340, reorderPoint: 120 },
      { id: 'i-2', name: 'Y12 deformed bar, 12m', type: 'Physical Product', incomeAccountId: 'a-4000', sku: 'STL-Y12-12', unitOfMeasure: 'lengths', unitPriceCents: 118_000, costPriceCents: 98_500, quantityOnHand: 64, reorderPoint: 80 },
      { id: 'i-3', name: 'Iron sheets, gauge 30, 3m', type: 'Physical Product', incomeAccountId: 'a-4000', sku: 'ROF-G30-3', unitOfMeasure: 'sheets', unitPriceCents: 92_000, costPriceCents: 76_000, quantityOnHand: 210, reorderPoint: 60 },
      { id: 'i-4', name: 'Crown emulsion, white 20L', type: 'Physical Product', incomeAccountId: 'a-4000', sku: 'PNT-CRW-20', unitOfMeasure: 'tins', unitPriceCents: 780_000, costPriceCents: 640_000, quantityOnHand: 9, reorderPoint: 12 },
    ],
  },
  '/api/sales-orders': {
    orders: [
      salesOrder('so-7', 'SO-2026-00007', 'c-1', '2026-09-30', '2026-10-03', 'OPEN', [
        orderLine('i-1', 'Cement 50kg, Bamburi', 40, 85_000, 340),
        orderLine('i-3', 'Iron sheets, gauge 30, 3m', 24, 92_000, 210),
      ], 'Deliver to the Ruiru site, gate B'),
      salesOrder('so-6', 'SO-2026-00006', 'c-2', '2026-09-24', '2026-09-28', 'IN_PROGRESS', [
        orderLine('i-2', 'Y12 deformed bar, 12m', 90, 118_000, 64),
        orderLine(null, 'Cutting and bending', 1, 450_000, null),
      ]),
      salesOrder('so-5', 'SO-2026-00005', 'c-3', '2026-09-18', null, 'COMPLETED', [
        orderLine('i-4', 'Crown emulsion, white 20L', 6, 780_000, 9),
      ], undefined, { invoiceId: 'inv-44', invoiceNumber: 'INV-2026-0044', invoiceStatus: 'SENT', completedAt: '2026-09-20T09:12:00Z' }),
      salesOrder('so-4', 'SO-2026-00004', 'c-1', '2026-09-10', null, 'CANCELLED', [
        orderLine('i-1', 'Cement 50kg, Bamburi', 10, 85_000, 340),
      ], undefined, { cancelledAt: '2026-09-11T08:00:00Z', cancelReason: 'Customer bought from another supplier' }),
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
      { id: 'm-3', userId: 'u-3', email: 'counter@riverside.example', role: 'member', status: 'active', isYou: false },
    ],
    invitations: [
      { id: 'inv-m-4', email: 'stores@riverside.example', role: 'accountant', status: 'Invited', invitedAt: '2026-09-28T10:00:00Z' },
    ],
  },
  '/api/invitations': { invitations: [] },
  '/api/reports/control-check': {
    receivables: { ledgerCents: 54_000_000, documentsCents: 54_000_000, differenceCents: 0 },
    payables: { ledgerCents: 80_000_000, documentsCents: 80_000_000, differenceCents: 0 },
    agrees: true,
  },
  '/api/inventory/i-4/movements': {
    movements: [
      { id: 'mv-3', quantity: -6, quantityAfter: 9, sourceType: 'SALES_ORDER', note: 'SO-2026-00005', createdAt: '2026-09-20T09:12:00Z' },
      { id: 'mv-2', quantity: -1, quantityAfter: 15, sourceType: 'ADJUSTMENT', note: 'One tin dented in storage', createdAt: '2026-09-05T16:40:00Z' },
      { id: 'mv-1', quantity: 16, quantityAfter: 16, sourceType: 'OPENING', note: 'Opening count', createdAt: '2026-08-01T08:00:00Z' },
    ],
  },
  '/api/bills/b-1': {
    bill: {
      id: 'b-1', billNumber: 'BILL-2026-0021', billNo: 'BILL-2026-0021', supplierReference: 'NSS-4471', vendorId: 'v-1', billDate: '2026-08-28', dueDate: '2026-09-27',
      subtotalCents: 43_103_448, taxCents: 6_896_552, totalCents: 50_000_000, amountDueCents: 50_000_000, status: 'OPEN', approvedAt: null,
      payments: [],
    },
  },
  '/api/invoices/inv-39': {
    invoice: {
      id: 'inv-39', invoiceNumber: 'INV-2026-0039', invoiceNo: 'INV-2026-0039', customerId: 'c-2', issueDate: '2026-03-10', dueDate: '2026-04-09',
      subtotalCents: 103_448_276, taxCents: 16_551_724, totalCents: 120_000_000, amountDueCents: 0, status: 'PAID', currency: 'KES',
      payments: [
        { id: 'pay-1', amountCents: 20_000_000, paymentDate: '2026-03-28', accountId: 'a-1010', reversedAt: '2026-03-30T08:00:00Z', reversalReason: 'Cheque returned unpaid' },
        { id: 'pay-2', amountCents: 120_000_000, paymentDate: '2026-04-30', accountId: 'a-1000', reversedAt: null, reversalReason: null },
      ],
    },
  },
  '/api/audit': {
    logs: [
      { id: 'al-4', userId: 'u-1', actorEmail: 'owner@riverside.example', action: 'UPDATE', resourceType: 'VENDOR', resourceId: 'v-1', details: { changes: { bank_account: { from: '0110 2233 44', to: '0110 9988 77' }, mpesa_number: { from: null, to: '0722 000 111' } } }, timestamp: '2026-09-17T08:15:00Z' },
      { id: 'al-1', userId: 'u-2', actorEmail: 'accounts@riverside.example', action: 'CREATE', resourceType: 'JOURNAL_ENTRY', resourceId: 'je-12', details: { memo: 'Electricity and water', amountCents: 4650000 }, timestamp: '2026-09-16T09:42:00Z' },
      { id: 'al-2', userId: 'u-1', actorEmail: 'owner@riverside.example', action: 'CREATE', resourceType: 'TEAM_MEMBER', resourceId: 'm-3', details: { values: { role: 'member' } }, timestamp: '2026-09-15T16:05:00Z' },
      { id: 'al-3', userId: 'u-2', actorEmail: 'accounts@riverside.example', action: 'UPDATE', resourceType: 'ACCOUNT', resourceId: 'a-1010', details: { changes: { name: { from: 'Mpesa', to: 'M-Pesa Till' }, is_bank_account: { from: false, to: true } } }, timestamp: '2026-09-12T11:20:00Z' },
    ],
    nextCursor: null,
  },
  '/api/budgets': {
    budgets: [
      { id: 'bg-1', accountId: 'a-6200', categoryName: 'Office rent and utilities', accountCode: '6200', period: 'MONTHLY', limitCents: 25_000_000, spentCents: 22_650_000 },
      { id: 'bg-2', accountId: 'a-6000', categoryName: 'Operating expenses', accountCode: '6000', period: 'QUARTERLY', limitCents: 30_000_000, spentCents: 34_100_000 },
    ],
  },
  '/api/payroll/runs': {
    runs: [
      { id: 'run-8', period: 'August 2026', payDate: '2026-08-31', status: 'POSTED', reversedAt: null, reversalReason: null },
      { id: 'run-7', period: 'July 2026', payDate: '2026-07-31', status: 'POSTED', reversedAt: '2026-08-02T09:00:00Z', reversalReason: 'Housing allowance missed for two staff' },
    ],
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
      { id: 't-1', date: '2026-09-15', description: 'M-Pesa QJK4XS2L1 from 0712 xxx 234', amountCents: 450_000, direction: 'IN', status: 'UNMATCHED', bankAccountId: 'a-1010', aiCategoryCode: '4000', aiCategoryName: 'Sales Revenue' },
      { id: 't-2', date: '2026-09-15', description: 'M-Pesa QJK7PL9A2 from Kiambu Contractors, 0722 xxx 918', amountCents: 14_500_000, direction: 'IN', status: 'UNMATCHED', bankAccountId: 'a-1010' },
      { id: 't-3', date: '2026-09-14', description: 'KCB transfer, Nairobi Steel Supplies', amountCents: 5_000_000, direction: 'OUT', status: 'UNMATCHED', bankAccountId: 'a-1000' },
      { id: 't-4', date: '2026-09-12', description: 'M-Pesa QJH2ZX8M4 from 0733 xxx 101', amountCents: 320_000, direction: 'IN', status: 'MATCHED', bankAccountId: 'a-1010' },
    ],
  },
  '/api/ai/usage': {
    since: '2026-10-01T00:00:00Z', dailyUnits: 4000, unitsLeftToday: 3_712,
    features: [
      { feature: 'ask.answer', calls: 41, failed: 0, units: 352 },
      { feature: 'ask.plan', calls: 41, failed: 1, units: 701 },
      { feature: 'bank.suggest', calls: 3, failed: 0, units: 70 },
      { feature: 'draft.reminder', calls: 6, failed: 0, units: 48 },
      { feature: 'receipt.read', calls: 12, failed: 0, units: 598 },
    ],
  },
  '/api/cash-transactions?kind=EXPENSE': {
    transactions: [
      { id: 'ex-1', kind: 'EXPENSE', number: 'EXP-2026-0018', date: '2026-10-02', partyName: 'KPLC', moneyAccountName: '1000 Cash at Bank - KCB', reference: 'KPLC-381', totalCents: 4_650_000, status: 'POSTED', createdAt: '2026-10-02T09:00:00Z', lines: [{ description: 'Electricity and water', amountCents: 4_650_000 }] },
      { id: 'ex-2', kind: 'EXPENSE', number: 'EXP-2026-0017', date: '2026-09-26', partyName: 'Nairobi Supplies', moneyAccountName: '1010 M-Pesa Till', reference: null, totalCents: 1_850_000, status: 'POSTED', createdAt: '2026-09-26T14:00:00Z', lines: [{ description: 'Cleaning materials', amountCents: 1_850_000 }] },
      { id: 'ex-3', kind: 'EXPENSE', number: 'EXP-2026-0013', date: '2026-09-04', partyName: 'Office Store', moneyAccountName: '1000 Cash at Bank - KCB', reference: null, totalCents: 980_000, status: 'VOID', voidedAt: '2026-09-05T10:00:00Z', voidReason: 'Entered twice', createdAt: '2026-09-04T08:00:00Z', lines: [{ description: 'Stationery', amountCents: 980_000 }] },
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
  resendConfirmation: async () => ({ error: null }),
  requestPasswordReset: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  isRecoveringPassword: false,
  justConfirmedEmail: false,
  dismissEmailConfirmed: () => undefined,
};

// Writes answer with the shape the real route returns, so receipts read as they would.
function previewWrite(pathname: string, rawBody: BodyInit | null | undefined) {
  const order = /^\/api\/sales-orders\/([^/]+)\/(status|invoice)$/.exec(pathname);
  const number = (id: string) => (FIXTURES['/api/sales-orders'] as any).orders.find((o: any) => o.id === id)?.orderNumber;
  if (pathname === '/api/sales-orders') return { id: 'so-8', orderNumber: 'SO-2026-00008', totalCents: 0 };
  // The AI features, answering as Workers AI did against the demo companies.
  if (pathname === '/api/ai/ask') {
    return {
      answer: 'Kiambu Contractors owes KES 540,000.00, of which KES 145,000.00 is 38 days overdue. Mombasa Builders owes KES 214,000.00, none of it overdue yet.',
      question: 'who_owes_us', title: 'Who owes us', scope: 'today, 10 October 2026',
      columns: ['Customer', 'Owed (KES)', 'Overdue (KES)', 'Oldest, days late'],
      rows: [['Kiambu Contractors', '540,000.00', '145,000.00', 38], ['Mombasa Builders', '214,000.00', '0.00', '']],
    };
  }
  if (pathname === '/api/ai/transcribe') return { text: 'Which customers owe us money?' };
  if (pathname === '/api/ai/bank-suggestions') {
    return { suggestions: [{ transactionId: 't-1', code: '4000', reason: 'Money received by M-Pesa for a sale' }], considered: 1, remaining: 0 };
  }
  if (pathname === '/api/ai/invoice-reminder') {
    return {
      text: 'Dear Kiambu Contractors,\n\nThis is a reminder that invoice INV-2026-0041 for KES 285,000.00 was due on 14 April 2026 and is now 179 days overdue. Please pay through M-Pesa Paybill 522522, account INV-2026-0041.\n\nRiverside Hardware Ltd',
      subject: 'Invoice INV-2026-0041: payment reminder', email: 'accounts@kiambu-contractors.example',
    };
  }
  if (/^\/api\/inventory\/[^/]+\/adjustments$/.test(pathname)) {
    const counted = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}').countedQuantity;
    return { quantity: counted - 9, quantityOnHand: counted };
  }
  if (/^\/api\/bills\/[^/]+\/approve$/.test(pathname)) return { billNumber: 'BILL-2026-0021', approvedAt: new Date().toISOString() };
  if (order?.[2] === 'invoice') return { invoiceId: 'inv-45', invoiceNumber: 'INV-2026-0045' };
  if (order?.[2] === 'status') {
    const status = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}').status;
    return { orderNumber: number(order[1]), status, stockChanges: [] };
  }
  return { success: true };
}

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
    const body = method === 'GET' ? payslips ?? FIXTURES[url.pathname + url.search] ?? FIXTURES[url.pathname] ?? {} : previewWrite(url.pathname, init?.body);
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
  Documentation: DocumentationView,
};

function PreviewApp() {
  const params = new URLSearchParams(window.location.search);
  const store = useAppStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // ?ai=on shows the AI features as an organization that has turned them on.
    const org = params.get('ai') === 'on' ? { ...ORG, aiEnabled: true } : ORG;
    store.setOrganizations([org] as any);
    store.setActiveCompany(org as any);
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
