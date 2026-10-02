import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { getSupabase } from '../src/server/supabase';
import { AccountService } from '../src/server/accounts';
import { CustomerService } from '../src/server/customers';
import { InvoiceService, type InvoiceInput, type InvoicePaymentInput } from '../src/server/invoices';
import { BankingService } from '../src/server/banking';
import { VendorService } from '../src/server/vendors';
import { BillService, type BillInput, type BillPaymentInput, type BillBatchPaymentInput } from '../src/server/bills';
import { PayrollService } from '../src/server/payroll';
import { InventoryService } from '../src/server/inventory';
import { ProjectService } from '../src/server/projects';
import { LedgerService } from '../src/server/ledger';
import type { JournalEntryInput } from '../src/server/types';
import { AuditService } from '../src/server/audit';
import { DashboardService } from '../src/server/metrics';
import { TeamService } from '../src/server/team';
import { ReportsService } from '../src/server/reports';
import { OrganizationService } from '../src/server/organizations';
import { CurrencyService } from '../src/server/currency';
import { GeminiService } from '../src/server/gemini';
import { BudgetService } from '../src/server/budgets';
import { AIInsightsService } from '../src/server/aiInsights';
import { OnboardingService } from '../src/server/onboarding';
import { SalesOrderService, type SalesOrderInput } from '../src/server/salesOrders';
import {
  requireAuthenticationAndOrganization,
  requireOrganizationAdministrator,
  requirePayrollAccess,
  requireRequestedOrganization,
  type Variables,
} from './auth';

const app = new Hono<{ Variables: Variables }>();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001').split(',');

// --- Security headers (replaces helmet) ---
app.use('*', async (c, next) => {
  await next();
  const isProduction = process.env.NODE_ENV === 'production';
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      isProduction ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    ].join('; ')
  );
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
});

// --- CORS ---
app.use(
  '/api/*',
  cors({
    origin: (origin) => (!origin || ALLOWED_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
  })
);

const api = new Hono<{ Variables: Variables }>();
api.use('*', requireAuthenticationAndOrganization);
// Employee and payroll records are personal data: not for the read-only member role.
api.use('/employees', requirePayrollAccess);
api.use('/employees/*', requirePayrollAccess);
api.use('/payroll/*', requirePayrollAccess);

// 500s can carry raw Supabase/Postgres error text (constraint names, column
// names) — log the detail server-side and never forward it to the client.
function serverError(c: any, err: unknown) {
  console.error('[API] Unhandled server error:', err);
  return c.json({ error: 'An unexpected error occurred. Please try again later.' }, 500);
}

// 400s are almost always our own intentional validation/business-rule
// messages, so they're safe to forward as-is; still log for observability.
// Supabase/PostgREST errors thrown via `if (error) throw error` are plain
// { message, code, details, hint } objects — not `instanceof Error` — so
// checking that alone silently swallows every DB-originated 400 message.
// Postgres's own wording for constraint failures names tables, columns and
// constraints. Those are replaced with a plain sentence for the SQLSTATE;
// messages the app's own functions RAISE are sentences already and pass
// through.
const RAW_DATABASE_MESSAGE = /violates|constraint|column|relation|syntax|invalid input|permission denied|null value/i;
const DATABASE_MESSAGES: Record<string, string> = {
  '23505': 'That record already exists.',
  '23503': 'A linked record does not exist or belongs to another organization.',
  '23514': 'A value is outside what is allowed.',
  '23502': 'A required value is missing.',
  '22P02': 'A value is in the wrong format.',
  '22001': 'A value is too long.',
  '42501': 'Your role does not allow this.',
};

function clientError(c: any, err: unknown) {
  let message = 'Invalid request.';
  const code = err && typeof err === 'object' && typeof (err as any).code === 'string' ? (err as any).code : '';
  const rawMessage = err && typeof err === 'object' && typeof (err as any).message === 'string' ? (err as any).message : '';
  if (/^[0-9A-Z]{5}$/.test(code) && RAW_DATABASE_MESSAGE.test(rawMessage)) {
    console.error('[API] Database rejected request:', err);
    return c.json({ error: DATABASE_MESSAGES[code] || 'The request could not be saved.' }, 400);
  }
  if (err instanceof z.ZodError) {
    // A ZodError's own message is a JSON dump of every issue; send the
    // readable messages instead.
    message = err.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join(' ');
  } else if (err instanceof Error) {
    message = err.message;
  } else if (err && typeof err === 'object' && typeof (err as any).message === 'string') {
    message = (err as any).message;
  }
  console.error('[API] Request error:', err);
  return c.json({ error: message }, 400);
}

const bulkStatusUpdateSchema = z.object({
  entityType: z.enum(['CUSTOMERS', 'VENDORS', 'INVENTORY', 'EMPLOYEES']),
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.string().trim().min(1).max(32),
});

const dateSchema = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'A valid date is required.')
  .transform((value) => new Date(value).toISOString().slice(0, 10));
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO code.');
const documentLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  accountId: z.string().uuid(),
  amountCents: z.number().int().nonnegative(),
  foreignAmountCents: z.number().int().positive().optional(),
  taxCents: z.number().int().nonnegative().default(0),
}).strict().refine((line) => line.amountCents > 0 || (line.foreignAmountCents || 0) > 0, {
  message: 'Each line needs a base or foreign-currency amount.',
});
const documentBaseSchema = z.object({
  dueDate: dateSchema,
  currency: currencySchema.default('KES'),
  exchangeRate: z.number().positive().finite().default(1),
  notes: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().uuid(),
  lines: z.array(documentLineSchema).min(1).max(200),
}).strict();
const createInvoiceSchema = documentBaseSchema.extend({
  customerId: z.string().uuid(),
  issueDate: dateSchema,
});
const createBillSchema = documentBaseSchema.extend({
  vendorId: z.string().uuid(),
  billDate: dateSchema,
});
const documentUpdateSchema = z.object({
  dueDate: dateSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
}).strict();
const invoicePaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  paymentDate: dateSchema,
  depositAccountId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
}).strict();
const billPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  paymentDate: dateSchema,
  sourceAccountId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
}).strict();
const batchBillPaymentSchema = z.object({
  payments: z.array(billPaymentSchema.extend({ billId: z.string().uuid() })).min(1).max(100),
}).strict();
const bulkDeleteSchema = z.object({
  entityType: z.enum(['INVOICES', 'BILLS', 'CUSTOMERS', 'VENDORS', 'INVENTORY', 'EMPLOYEES']),
  ids: z.array(z.string().uuid()).min(1).max(100),
}).strict();
const journalLineSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  description: z.string().trim().max(500).optional(),
}).strict().refine((line) => (line.debit > 0) !== (line.credit > 0), {
  message: 'Each journal line must have exactly one non-zero side.',
});
const journalEntrySchema = z.object({
  entryDate: dateSchema,
  memo: z.string().trim().max(1000).transform((value) => value || 'Manual journal entry'),
  sourceType: z.enum(['MANUAL', 'ADJUSTMENT']).default('MANUAL'),
  referenceNo: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().uuid().optional(),
  lines: z.array(journalLineSchema).min(2).max(500),
}).strict().superRefine((entry, context) => {
  const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit <= 0 || debit !== credit) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Journal debits and credits must be equal, positive safe-integer cents.' });
  }
});

// A report asked for with a period or date it does not understand is the
// caller's mistake (400), not a server failure (500).
function reportError(c: any, err: unknown) {
  const message = err instanceof Error ? err.message : '';
  if (/^(Unsupported report period|The balance-sheet date|accountName is required)/.test(message)) {
    return clientError(c, err);
  }
  return serverError(c, err);
}

const bankMatchSchema = z.object({
  transactionId: z.string().uuid(),
  targetAccountId: z.string().uuid().optional(),
  existingJournalEntryId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  billId: z.string().uuid().optional(),
}).strict().refine(
  (body) => [body.targetAccountId, body.existingJournalEntryId, body.invoiceId, body.billId].filter(Boolean).length === 1,
  { message: 'Choose exactly one of an account, a posted entry, an invoice or a bill to match this line to.' },
);
const autoReconcileSchema = z.object({
  minConfidence: z.number().min(0).max(100).optional(),
}).strict();

const decimals = (value: number) => {
  const text = String(value);
  return /e/i.test(text) ? Infinity : (text.split('.')[1] || '').length;
};
const salesOrderLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  accountId: z.string().uuid(),
  inventoryItemId: z.string().uuid().optional(),
  quantity: z.number().positive().max(1_000_000_000)
    .refine((value) => decimals(value) <= 3, 'Use at most three decimals for a quantity.'),
  unitPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxRate: z.number().min(0).max(100)
    .refine((value) => decimals(value) <= 2, 'Use at most two decimals for a VAT rate.')
    .default(0),
}).strict();
const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  orderDate: dateSchema,
  promisedDate: dateSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().uuid(),
  lines: z.array(salesOrderLineSchema).min(1).max(200),
}).strict().refine((order) => !order.promisedDate || order.promisedDate >= order.orderDate, {
  message: 'The promised date cannot be before the order date.',
});
const salesOrderStatusSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  reason: z.string().trim().max(500).optional(),
}).strict();
const invoiceSalesOrderSchema = z.object({
  issueDate: dateSchema,
  dueDate: dateSchema,
}).strict().refine((body) => body.dueDate >= body.issueDate, {
  message: 'The due date cannot be before the issue date.',
});

const bodyOf = (c: any) => c.req.json().catch(() => ({}));
const onboardingSchema = z.object({
  status: z.enum(['NOT_ASKED', 'IN_PROGRESS', 'SKIPPED', 'COMPLETED']),
  step: z.number().int().min(0).max(50),
}).strict();

// --- Personal onboarding (not tied to the active organization) ---
api.get('/onboarding', async (c) => {
  try {
    return c.json(await OnboardingService.getState(c.get('userId')));
  } catch (err) { return serverError(c, err); }
});

api.patch('/onboarding', async (c) => {
  try {
    const state = onboardingSchema.parse(await bodyOf(c)) as {
      status: 'NOT_ASKED' | 'IN_PROGRESS' | 'SKIPPED' | 'COMPLETED';
      step: number;
    };
    return c.json(await OnboardingService.updateState(c.get('userId'), state));
  } catch (err) { return clientError(c, err); }
});

// --- Reports ---
api.get('/reports/pnl', async (c) => {
  try {
    const data = await ReportsService.getProfitAndLoss(c.get('orgId'), c.req.query('dateRange') || 'This Year-to-date');
    return c.json(data);
  } catch (err) { return reportError(c, err); }
});

api.get('/reports/balance-sheet', async (c) => {
  try {
    const data = await ReportsService.getBalanceSheet(c.get('orgId'), c.req.query('asOfDate') || new Date().toISOString());
    return c.json(data);
  } catch (err) { return reportError(c, err); }
});

api.get('/reports/cash-flow', async (c) => {
  try {
    const data = await ReportsService.getCashFlow(c.get('orgId'), c.req.query('dateRange') || 'This Year-to-date');
    return c.json(data);
  } catch (err) { return reportError(c, err); }
});

api.get('/reports/trial-balance', async (c) => {
  try {
    const data = await ReportsService.getTrialBalance(c.get('orgId'));
    return c.json(data);
  } catch (err) { return reportError(c, err); }
});

api.get('/reports/tax-summary', async (c) => {
  try {
    const data = await ReportsService.getTaxSummary(c.get('orgId'), c.req.query('period') || 'This month');
    return c.json(data);
  } catch (err) { return reportError(c, err); }
});

api.get('/reports/ledger', async (c) => {
  try {
    const accountName = c.req.query('accountName');
    if (!accountName) throw new Error('accountName is required');
    const lines = await ReportsService.getLedgerLinesForAccount(c.get('orgId'), accountName);
    return c.json({ lines });
  } catch (err) { return reportError(c, err); }
});

api.get('/reports/ar-aging', async (c) => {
  try {
    return c.json(await ReportsService.getARAging(c.get('orgId')));
  } catch (err) { return serverError(c, err); }
});

api.get('/reports/ap-aging', async (c) => {
  try {
    return c.json(await ReportsService.getAPAging(c.get('orgId')));
  } catch (err) { return serverError(c, err); }
});

// --- Team ---
api.get('/team', async (c) => {
  try {
    const members = await TeamService.getMembers(c.get('orgId'), c.get('userId'));
    return c.json({ members });
  } catch (err) { return serverError(c, err); }
});

api.post('/team', requireOrganizationAdministrator, async (c) => {
  try {
    const body = await bodyOf(c);
    const id = await TeamService.addMember({ ...body, orgId: c.get('orgId'), invitedBy: c.get('userId') });
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/team/:id', requireOrganizationAdministrator, async (c) => {
  try {
    const body = await bodyOf(c);
    await TeamService.updateMemberRole(c.get('orgId'), c.req.param('id'), body.role, c.get('userId'));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.delete('/team/:id', requireOrganizationAdministrator, async (c) => {
  try {
    await TeamService.removeMember(c.get('orgId'), c.req.param('id'), c.get('userId'));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

// --- Dashboard ---
api.get('/dashboard/metrics', async (c) => {
  try {
    return c.json(await DashboardService.getMetrics(c.get('orgId')));
  } catch (err) { return serverError(c, err); }
});

// --- Accounts ---
api.post('/accounts', async (c) => {
  try {
    const body = await bodyOf(c);
    const id = await AccountService.createAccount({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.post('/accounts/bulk', async (c) => {
  try {
    const { accounts } = await bodyOf(c);
    const result = await AccountService.bulkCreateAccounts(c.get('orgId'), accounts, c.get('userId'));
    return c.json(result);
  } catch (err) { return clientError(c, err); }
});

api.post('/accounts/undo-bulk', async (c) => {
  try {
    const { accountIds } = await bodyOf(c);
    await AccountService.bulkDeleteAccounts(c.get('orgId'), accountIds, c.get('userId'));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.get('/accounts', async (c) => {
  try {
    return c.json({ accounts: await AccountService.getAccounts(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/accounts/seed', async (c) => {
  try {
    const orgId = c.get('orgId');
    await OrganizationService.seedDefaultAccounts(orgId);
    return c.json({ success: true });
  } catch (err) { return serverError(c, err); }
});

// --- Journal Entries ---
api.get('/journal-entries', async (c) => {
  try {
    return c.json({ entries: await LedgerService.getJournalEntries(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/journal-entries', async (c) => {
  try {
    const body = journalEntrySchema.parse(await bodyOf(c)) as Omit<JournalEntryInput, 'orgId' | 'createdBy'>;
    const id = await LedgerService.postJournalEntry({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

// --- Audit Logs ---
api.get('/audit', async (c) => {
  try {
    return c.json({ logs: await AuditService.getLogs(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

// --- Budgets ---
api.get('/budgets', async (c) => {
  try {
    return c.json({ budgets: await BudgetService.getBudgets(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/budgets', async (c) => {
  try {
    const body = await bodyOf(c);
    const id = await BudgetService.createBudget({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/budgets/:id', async (c) => {
  try {
    const body = await bodyOf(c);
    await BudgetService.updateBudget(c.get('orgId'), c.req.param('id'), body.limitCents);
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.delete('/budgets/:id', async (c) => {
  try {
    await BudgetService.deleteBudget(c.get('orgId'), c.req.param('id'));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

// --- Banking ---
api.get('/banking/transactions', async (c) => {
  try {
    return c.json({ transactions: await BankingService.getTransactions(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.get('/banking/ai-matches', async (c) => {
  try {
    return c.json({ matches: await BankingService.getAIMatches(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/banking/auto-reconcile-all', async (c) => {
  let body: z.infer<typeof autoReconcileSchema>;
  try {
    body = autoReconcileSchema.parse(await bodyOf(c));
  } catch (err) { return clientError(c, err); }
  try {
    const result = await BankingService.autoReconcileAll(c.get('orgId'), body.minConfidence, c.get('userId'));
    return c.json(result);
  } catch (err) { return serverError(c, err); }
});

api.post('/banking/sync', async (c) => {
  try {
    return c.json(await BankingService.syncTransactions(c.get('orgId')));
  } catch (err) { return clientError(c, err); }
});

api.post('/banking/match', async (c) => {
  try {
    const { transactionId, ...target } = bankMatchSchema.parse(await bodyOf(c));
    const journalEntryId = await BankingService.matchTransaction(c.get('orgId'), transactionId, target, c.get('userId'));
    return c.json({ journalEntryId });
  } catch (err) { return clientError(c, err); }
});

api.get('/banking/rules', async (c) => {
  try {
    return c.json({ rules: await BankingService.getRules(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/banking/rules', async (c) => {
  try {
    const body = z.object({
      matchText: z.string().trim().min(1).max(200),
      targetAccountId: z.string().uuid(),
    }).strict().parse(await bodyOf(c));
    const id = await BankingService.createRule(c.get('orgId'), body.matchText, body.targetAccountId, c.get('userId'));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.delete('/banking/rules/:id', async (c) => {
  try {
    await BankingService.deleteRule(c.get('orgId'), z.string().uuid().parse(c.req.param('id')));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.get('/banking/reconciliation', async (c) => {
  try {
    return c.json(await BankingService.getReconciliationSummary(c.get('orgId')));
  } catch (err) { return serverError(c, err); }
});

api.get('/banking/connection-requests', async (c) => {
  try {
    return c.json({ requests: await BankingService.getConnectionRequests(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/banking/connection-requests', async (c) => {
  try {
    const body = await bodyOf(c);
    const id = await BankingService.requestBankConnection(c.get('orgId'), body, c.get('userId'));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

// --- Customers ---
api.get('/customers', async (c) => {
  try {
    return c.json({ customers: await CustomerService.getCustomers(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/customers', async (c) => {
  try {
    const id = await CustomerService.createCustomer(c.get('orgId'), await bodyOf(c));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/customers/:id', async (c) => {
  try {
    await CustomerService.updateCustomer(c.get('orgId'), c.req.param('id'), await bodyOf(c));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

// --- Invoices ---
api.get('/invoices', async (c) => {
  try {
    return c.json({ invoices: await InvoiceService.getInvoices(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/invoices', async (c) => {
  try {
    const body = createInvoiceSchema.parse(await bodyOf(c)) as Omit<InvoiceInput, 'orgId' | 'createdBy'>;
    const id = await InvoiceService.createInvoice({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/invoices/:id', async (c) => {
  try {
    const invoiceId = z.string().uuid().parse(c.req.param('id'));
    await InvoiceService.updateInvoice(c.get('orgId'), invoiceId, documentUpdateSchema.parse(await bodyOf(c)));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.post('/invoices/:id/payments', async (c) => {
  try {
    const invoiceId = z.string().uuid().parse(c.req.param('id'));
    const body = invoicePaymentSchema.parse(await bodyOf(c)) as Omit<InvoicePaymentInput, 'createdBy'>;
    const payment = await InvoiceService.receivePayment(c.get('orgId'), invoiceId, {
      ...body,
      createdBy: c.get('userId'),
    });
    return c.json(payment, 201);
  } catch (err) { return clientError(c, err); }
});

// --- Vendors ---
api.get('/vendors', async (c) => {
  try {
    return c.json({ vendors: await VendorService.getVendors(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/vendors', async (c) => {
  try {
    const id = await VendorService.createVendor(c.get('orgId'), await bodyOf(c));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/vendors/:id', async (c) => {
  try {
    await VendorService.updateVendor(c.get('orgId'), c.req.param('id'), await bodyOf(c));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

// --- Sales orders ---
// An order is recorded, moved through its statuses (completion counts stock
// out, reopening counts it back) and invoiced in one step. Each write is one
// Postgres function call, one transaction.
api.get('/sales-orders', async (c) => {
  try {
    return c.json({ orders: await SalesOrderService.getOrders(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/sales-orders', async (c) => {
  try {
    const body = createSalesOrderSchema.parse(await bodyOf(c)) as Omit<SalesOrderInput, 'orgId' | 'createdBy'>;
    const order = await SalesOrderService.createOrder({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
    return c.json(order);
  } catch (err) { return clientError(c, err); }
});

api.post('/sales-orders/:id/status', async (c) => {
  try {
    const orderId = z.string().uuid().parse(c.req.param('id'));
    const body = salesOrderStatusSchema.parse(await bodyOf(c));
    return c.json(await SalesOrderService.setStatus(c.get('orgId'), orderId, body.status, body.reason, c.get('userId')));
  } catch (err) { return clientError(c, err); }
});

api.post('/sales-orders/:id/invoice', async (c) => {
  try {
    const orderId = z.string().uuid().parse(c.req.param('id'));
    const body = invoiceSalesOrderSchema.parse(await bodyOf(c));
    return c.json(await SalesOrderService.invoiceOrder(c.get('orgId'), orderId, body.issueDate, body.dueDate, c.get('userId')));
  } catch (err) { return clientError(c, err); }
});

// --- Bills ---
api.get('/bills', async (c) => {
  try {
    return c.json({ bills: await BillService.getBills(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/bills', async (c) => {
  try {
    const body = createBillSchema.parse(await bodyOf(c)) as Omit<BillInput, 'orgId' | 'createdBy'>;
    const id = await BillService.createBill({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/bills/:id', async (c) => {
  try {
    const billId = z.string().uuid().parse(c.req.param('id'));
    await BillService.updateBill(c.get('orgId'), billId, documentUpdateSchema.parse(await bodyOf(c)));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.post('/bills/:id/payments', async (c) => {
  try {
    const billId = z.string().uuid().parse(c.req.param('id'));
    const body = billPaymentSchema.parse(await bodyOf(c)) as Omit<BillPaymentInput, 'createdBy'>;
    const payment = await BillService.recordPayment(c.get('orgId'), billId, {
      ...body,
      createdBy: c.get('userId'),
    });
    return c.json(payment, 201);
  } catch (err) { return clientError(c, err); }
});

api.post('/bills/batch-pay', async (c) => {
  try {
    const { payments } = batchBillPaymentSchema.parse(await bodyOf(c)) as { payments: BillBatchPaymentInput[] };
    const result = await BillService.recordBatchPayment(c.get('orgId'), payments, c.get('userId'));
    return c.json(result);
  } catch (err) { return clientError(c, err); }
});

// --- Receipt scanning (Gemini) ---
api.post('/expenses/scan', async (c) => {
  try {
    const { image, imageBase64, mimeType } = await bodyOf(c);
    const receiptImage = image || imageBase64;
    if (!receiptImage) throw new Error('Image data is required');
    const result = await GeminiService.scanReceipt(receiptImage, mimeType || 'image/jpeg');
    return c.json(result);
  } catch (err) { return serverError(c, err); }
});

// --- AI Business Feed ---
api.post('/ai/ask', async (c) => {
  try {
    const body = await bodyOf(c);
    const question = (body.question || '').trim();
    if (!question) throw new Error('A question is required.');
    if (question.length > 500) throw new Error('Question is too long (max 500 characters).');
    const answer = await AIInsightsService.ask(c.get('orgId'), question);
    return c.json({ answer });
  } catch (err) { return clientError(c, err); }
});

// --- Payroll ---
api.get('/employees', async (c) => {
  try {
    return c.json({ employees: await PayrollService.getEmployees(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/employees', async (c) => {
  try {
    const id = await PayrollService.addEmployee(c.get('orgId'), await bodyOf(c));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/employees/:id', async (c) => {
  try {
    await PayrollService.updateEmployee(c.get('orgId'), c.req.param('id'), await bodyOf(c));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.get('/payroll/runs', async (c) => {
  try {
    return c.json({ runs: await PayrollService.getPayrollRuns(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.get('/payroll/runs/:id/payslips', async (c) => {
  try {
    const runId = z.string().uuid().parse(c.req.param('id'));
    return c.json({ payslips: await PayrollService.getPayslips(c.get('orgId'), runId) });
  } catch (err) { return err instanceof z.ZodError ? clientError(c, err) : serverError(c, err); }
});

api.post('/payroll/runs', async (c) => {
  try {
    const { period, payDate } = await bodyOf(c);
    if (!period || !payDate) throw new Error('period and payDate are required.');
    const id = await PayrollService.runPayroll(c.get('orgId'), period, payDate, c.get('userId'));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

// --- Inventory ---
api.get('/inventory', async (c) => {
  try {
    return c.json({ items: await InventoryService.getItems(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/inventory', async (c) => {
  try {
    const id = await InventoryService.createItem(c.get('orgId'), await bodyOf(c));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/inventory/:id', async (c) => {
  try {
    await InventoryService.updateItem(c.get('orgId'), c.req.param('id'), await bodyOf(c));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

// --- Projects ---
api.get('/projects', async (c) => {
  try {
    return c.json({ projects: await ProjectService.getProjects(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/projects', async (c) => {
  try {
    const id = await ProjectService.createProject(c.get('orgId'), await bodyOf(c));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.patch('/projects/:id', async (c) => {
  try {
    await ProjectService.updateProject(c.get('orgId'), c.req.param('id'), await bodyOf(c));
    return c.json({ success: true });
  } catch (err) { return clientError(c, err); }
});

api.get('/time-entries', async (c) => {
  try {
    return c.json({ entries: await ProjectService.getTimeEntries(c.get('orgId')) });
  } catch (err) { return serverError(c, err); }
});

api.post('/time-entries', async (c) => {
  try {
    const id = await ProjectService.submitTimeEntry(c.get('orgId'), c.get('userId'), await bodyOf(c));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

// --- Bulk Operations ---
// Customers, suppliers, stock items and employees are deleted outright;
// invoices and bills are voided with a reversing entry, never deleted.
const BULK_COLLECTIONS: Record<string, { table: string; resourceType: 'CUSTOMER' | 'VENDOR' | 'INVENTORY_ITEM' | 'EMPLOYEE' }> = {
  CUSTOMERS: { table: 'customers', resourceType: 'CUSTOMER' },
  VENDORS: { table: 'vendors', resourceType: 'VENDOR' },
  INVENTORY: { table: 'inventory_items', resourceType: 'INVENTORY_ITEM' },
  EMPLOYEES: { table: 'employees', resourceType: 'EMPLOYEE' },
};

api.post('/bulk/delete', async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { entityType, ids } = bulkDeleteSchema.parse(await bodyOf(c));

    if (entityType === 'INVOICES' || entityType === 'BILLS') {
      // Each void is its own transaction. One that is refused (for example
      // an invoice with payments) no longer stops the rest; each refusal is
      // reported with its document.
      const failures: Array<{ id: string; message: string }> = [];
      for (const id of ids) {
        try {
          if (entityType === 'INVOICES') await InvoiceService.voidInvoice(orgId, id, userId);
          else await BillService.voidBill(orgId, id, userId);
        } catch (err: any) {
          failures.push({ id, message: err?.message || 'Could not be voided.' });
        }
      }
      return c.json({ success: failures.length === 0, count: ids.length - failures.length, failed: failures.length, failures, action: 'VOID' });
    }

    const collection = BULK_COLLECTIONS[entityType];
    if (!collection) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    const { data: deleted, error } = await supabase
      .from(collection.table)
      .delete()
      .eq('org_id', orgId)
      .in('id', ids)
      .select('id');
    if (error) throw error;

    await AuditService.logEvents((deleted || []).map((row: any) => ({
      orgId,
      userId,
      action: 'DELETE' as const,
      resourceType: collection.resourceType,
      resourceId: row.id,
      details: { bulk: true },
    })));

    return c.json({ success: true, count: deleted?.length || 0, action: 'DELETE' });
  } catch (err) { return clientError(c, err); }
});

api.post('/bulk/status-update', async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { entityType, ids, status } = bulkStatusUpdateSchema.parse(await bodyOf(c));

    const collection = BULK_COLLECTIONS[entityType];
    if (!collection) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    const { data: updated, error } = await supabase
      .from(collection.table)
      .update({ status })
      .eq('org_id', orgId)
      .in('id', ids)
      .select('id');
    if (error) throw error;

    await AuditService.logEvents((updated || []).map((row: any) => ({
      orgId,
      userId,
      action: 'UPDATE' as const,
      resourceType: collection.resourceType,
      resourceId: row.id,
      details: { status, bulk: true },
    })));

    return c.json({ success: true, count: updated?.length || 0 });
  } catch (err) { return clientError(c, err); }
});

// --- Organizations & Multi-Entity Management ---
api.get('/organizations', async (c) => {
  try {
    const orgs = await OrganizationService.getOrganizations(c.get('userId'));
    return c.json({ organizations: orgs });
  } catch (err) { return serverError(c, err); }
});

api.get('/organizations/:id', requireRequestedOrganization, async (c) => {
  try {
    const org = await OrganizationService.getOrganization(c.req.param('id'));
    if (!org) return c.json({ error: 'Organization not found' }, 404);
    return c.json({ organization: org });
  } catch (err) { return serverError(c, err); }
});

api.post('/organizations', async (c) => {
  try {
    const id = await OrganizationService.createOrganization(await bodyOf(c), c.get('userId'));
    return c.json({ id, message: 'Organization created successfully' });
  } catch (err) { return clientError(c, err); }
});

api.put('/organizations/:id', requireRequestedOrganization, requireOrganizationAdministrator, async (c) => {
  try {
    await OrganizationService.updateOrganization(c.req.param('id'), await bodyOf(c));
    return c.json({ success: true, message: 'Organization updated' });
  } catch (err) { return clientError(c, err); }
});

// --- Multi-Currency & Free Exchange Rate Engine ---
api.get('/currency/rates', async (c) => {
  try {
    const base = c.req.query('base') || 'KES';
    const forceRefresh = c.req.query('refresh') === 'true';
    return c.json(await CurrencyService.fetchLiveRates(base, forceRefresh));
  } catch (err) { return serverError(c, err); }
});

api.post('/currency/refresh', async (c) => {
  try {
    const body = await bodyOf(c);
    const ratesData = await CurrencyService.fetchLiveRates(body.base || 'KES', true);
    return c.json({ success: true, data: ratesData, message: 'Daily exchange rates refreshed from free live market API' });
  } catch (err) { return serverError(c, err); }
});

api.get('/currency/unrealized-fx', async (c) => {
  try {
    const base = c.req.query('base') || 'KES';
    return c.json(await CurrencyService.calculateUnrealizedFX(c.get('orgId'), base));
  } catch (err) { return serverError(c, err); }
});

app.route('/api', api);

app.onError((err, c) => {
  console.error('[LedgerLink] Unhandled error:', err);
  return c.json({ error: 'An unexpected error occurred. Please try again later.' }, 500);
});

export default app;
