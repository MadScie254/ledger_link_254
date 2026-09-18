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
import {
  requireAuthenticationAndOrganization,
  requireOrganizationAdministrator,
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
function clientError(c: any, err: unknown) {
  let message = 'Invalid request.';
  if (err instanceof Error) {
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

const bodyOf = (c: any) => c.req.json().catch(() => ({}));

// --- Reports ---
api.get('/reports/pnl', async (c) => {
  try {
    const data = await ReportsService.getProfitAndLoss(c.get('orgId'), c.req.query('dateRange') || 'This Year-to-date');
    return c.json(data);
  } catch (err) { return serverError(c, err); }
});

api.get('/reports/balance-sheet', async (c) => {
  try {
    const data = await ReportsService.getBalanceSheet(c.get('orgId'), c.req.query('asOfDate') || new Date().toISOString());
    return c.json(data);
  } catch (err) { return serverError(c, err); }
});

api.get('/reports/cash-flow', async (c) => {
  try {
    const data = await ReportsService.getCashFlow(c.get('orgId'), c.req.query('dateRange') || 'This Year-to-date');
    return c.json(data);
  } catch (err) { return serverError(c, err); }
});

api.get('/reports/trial-balance', async (c) => {
  try {
    const data = await ReportsService.getTrialBalance(c.get('orgId'));
    return c.json(data);
  } catch (err) { return serverError(c, err); }
});

api.get('/reports/tax-summary', async (c) => {
  try {
    const data = await ReportsService.getTaxSummary(c.get('orgId'), c.req.query('period') || 'August 2026');
    return c.json(data);
  } catch (err) { return serverError(c, err); }
});

api.get('/reports/ledger', async (c) => {
  try {
    const accountName = c.req.query('accountName');
    if (!accountName) throw new Error('accountName is required');
    const lines = await ReportsService.getLedgerLinesForAccount(c.get('orgId'), accountName);
    return c.json({ lines });
  } catch (err) { return serverError(c, err); }
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
  try {
    const body = await bodyOf(c);
    const result = await BankingService.autoReconcileAll(c.get('orgId'), body.minConfidence || 85, c.get('userId'));
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
    const { transactionId, targetAccountId, existingJournalEntryId } = await bodyOf(c);
    const journalEntryId = await BankingService.matchTransaction(c.get('orgId'), transactionId, targetAccountId, existingJournalEntryId, c.get('userId'));
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
    const body = await bodyOf(c);
    const id = await BankingService.createRule(c.get('orgId'), body.matchText, body.targetAccountId, c.get('userId'));
    return c.json({ id });
  } catch (err) { return clientError(c, err); }
});

api.delete('/banking/rules/:id', async (c) => {
  try {
    await BankingService.deleteRule(c.get('orgId'), c.req.param('id'));
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
    return c.json({ payslips: await PayrollService.getPayslips(c.get('orgId'), c.req.param('id')) });
  } catch (err) { return serverError(c, err); }
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
api.post('/bulk/delete', async (c) => {
  try {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { entityType, ids } = bulkDeleteSchema.parse(await bodyOf(c));

    if (entityType === 'INVOICES') {
      for (const id of ids) await InvoiceService.voidInvoice(orgId, id, userId);
      return c.json({ success: true, count: ids.length, action: 'VOID' });
    }

    if (entityType === 'BILLS') {
      for (const id of ids) await BillService.voidBill(orgId, id, userId);
      return c.json({ success: true, count: ids.length, action: 'VOID' });
    }

    const collectionMap: Record<string, string> = {
      CUSTOMERS: 'customers',
      VENDORS: 'vendors',
      INVENTORY: 'inventory_items',
      EMPLOYEES: 'employees',
    };

    const collName = collectionMap[entityType];
    if (!collName) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    const { error } = await supabase.from(collName).delete().eq('org_id', orgId).in('id', ids);
    if (error) throw error;

    return c.json({ success: true, count: ids.length, action: 'DELETE' });
  } catch (err) { return clientError(c, err); }
});

api.post('/bulk/status-update', async (c) => {
  try {
    const orgId = c.get('orgId');
    const { entityType, ids, status } = bulkStatusUpdateSchema.parse(await bodyOf(c));

    const collectionMap: Record<string, string> = {
      CUSTOMERS: 'customers',
      VENDORS: 'vendors',
      INVENTORY: 'inventory_items',
      EMPLOYEES: 'employees',
    };

    const collName = collectionMap[entityType];
    if (!collName) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    const { error } = await supabase.from(collName).update({ status }).eq('org_id', orgId).in('id', ids);
    if (error) throw error;

    return c.json({ success: true, count: ids.length });
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
