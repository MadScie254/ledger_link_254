import { Router, type Response } from 'express';
import { getSupabase } from './supabase';
import { AccountService } from './accounts';
import { CustomerService } from './customers';
import { InvoiceService } from './invoices';
import { BankingService } from './banking';
import { VendorService } from './vendors';
import { BillService } from './bills';
import { PayrollService } from './payroll';
import { InventoryService } from './inventory';
import { ProjectService } from './projects';
import { LedgerService } from './ledger';
import { AuditService } from './audit';
import { DashboardService } from './metrics';
import { TeamService } from './team';
import { ReportsService } from './reports';
import { OrganizationService } from './organizations';
import { CurrencyService } from './currency';
import { GeminiService } from './gemini';
import { BudgetService } from './budgets';
import { AIInsightsService } from './aiInsights';
import {
  requireAuthenticationAndOrganization,
  requireOrganizationAdministrator,
  requireRequestedOrganization,
  type AuthenticatedRequest,
} from './auth';
import { z } from 'zod';

export const apiRouter = Router();

apiRouter.use(requireAuthenticationAndOrganization);

// 500s can carry raw Supabase/Postgres error text (constraint names, column
// names) — log the detail server-side and never forward it to the client.
function sendServerError(res: Response, err: unknown) {
  console.error('[API] Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again later.' });
}

// 400s are almost always our own intentional validation/business-rule
// messages (e.g. "Account code X already exists"), so they're safe to
// forward as-is; still log server-side for observability.
//
// Note: Supabase/PostgREST errors thrown via `if (error) throw error` are
// plain { message, code, details, hint } objects — NOT `instanceof Error` —
// so that check alone silently swallowed every DB-originated 400 message
// into a generic "Invalid request." Check for a string `.message` too.
function sendClientError(res: Response, err: unknown) {
  let message = 'Invalid request.';
  if (err instanceof Error) {
    message = err.message;
  } else if (err && typeof err === 'object' && typeof (err as any).message === 'string') {
    message = (err as any).message;
  }
  console.error('[API] Request error:', err);
  res.status(400).json({ error: message });
}

const bulkStatusUpdateSchema = z.object({
  entityType: z.enum(['CUSTOMERS', 'VENDORS', 'INVENTORY', 'EMPLOYEES']),
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.string().trim().min(1).max(32),
});

// --- Reports ---
apiRouter.get('/reports/pnl', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const dateRange = (req.query.dateRange as string) || 'This Year-to-date';
    const data = await ReportsService.getProfitAndLoss(orgId, dateRange);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/balance-sheet', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const asOfDate = (req.query.asOfDate as string) || new Date().toISOString();
    const data = await ReportsService.getBalanceSheet(orgId, asOfDate);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/cash-flow', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const dateRange = (req.query.dateRange as string) || 'This Year-to-date';
    const data = await ReportsService.getCashFlow(orgId, dateRange);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/trial-balance', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const data = await ReportsService.getTrialBalance(orgId);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/tax-summary', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const period = (req.query.period as string) || 'August 2026';
    const data = await ReportsService.getTaxSummary(orgId, period);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/ledger', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const accountName = req.query.accountName as string;
    if (!accountName) throw new Error('accountName is required');
    const lines = await ReportsService.getLedgerLinesForAccount(orgId, accountName);
    res.json({ lines });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/ar-aging', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const data = await ReportsService.getARAging(orgId);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/reports/ap-aging', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const data = await ReportsService.getAPAging(orgId);
    res.json(data);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/team', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    const members = await TeamService.getMembers(orgId, userId);
    res.json({ members });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/team', requireOrganizationAdministrator, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    const id = await TeamService.addMember({ ...req.body, orgId, invitedBy: userId });
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/team/:id', requireOrganizationAdministrator, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    await TeamService.updateMemberRole(orgId, req.params.id, req.body.role, userId);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.delete('/team/:id', requireOrganizationAdministrator, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    await TeamService.removeMember(orgId, req.params.id, userId);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.get('/dashboard/metrics', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const metrics = await DashboardService.getMetrics(orgId);
    res.json(metrics);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/accounts', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const id = await AccountService.createAccount({ ...req.body, orgId, createdBy: userId });
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.post('/accounts/bulk', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const { accounts } = req.body;
    const result = await AccountService.bulkCreateAccounts(orgId, accounts, userId);
    res.json(result);
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.post('/accounts/undo-bulk', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const { accountIds } = req.body;
    await AccountService.bulkDeleteAccounts(orgId, accountIds, userId);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Journal Entries ---
apiRouter.get('/journal-entries', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const entries = await LedgerService.getJournalEntries(orgId);
    res.json({ entries });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/journal-entries', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const id = await LedgerService.postJournalEntry({ ...req.body, orgId, createdBy: userId });
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Audit Logs ---
apiRouter.get('/audit', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const logs = await AuditService.getLogs(orgId);
    res.json({ logs });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/accounts', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const accounts = await AccountService.getAccounts(orgId);
    res.json({ accounts });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/accounts/seed', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const standardAccounts = [
      { code: '1000', name: 'Cash equivalents', type: 'ASSET' },
      { code: '1100', name: 'Accounts Receivable (A/R)', type: 'ASSET' },
      { code: '2000', name: 'Accounts Payable (A/P)', type: 'LIABILITY' },
      { code: '3000', name: 'Owner\'s Equity', type: 'EQUITY' },
      { code: '4000', name: 'Sales Revenue', type: 'INCOME' },
      { code: '5000', name: 'Cost of Goods Sold', type: 'COGS' },
      { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' },
    ] as const;

    for (const acc of standardAccounts) {
      try {
        await AccountService.createAccount({ ...acc, orgId });
      } catch (err) {
        // Ignore if already exists
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

// --- Budgets ---
apiRouter.get('/budgets', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const budgets = await BudgetService.getBudgets(orgId);
    res.json({ budgets });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/budgets', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    const id = await BudgetService.createBudget({ ...req.body, orgId, createdBy: userId });
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/budgets/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await BudgetService.updateBudget(orgId, req.params.id, req.body.limitCents);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.delete('/budgets/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await BudgetService.deleteBudget(orgId, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Banking ---
apiRouter.get('/banking/transactions', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const transactions = await BankingService.getTransactions(orgId);
    res.json({ transactions });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/banking/ai-matches', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const matches = await BankingService.getAIMatches(orgId);
    res.json({ matches });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/banking/auto-reconcile-all', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId!;
    const minConfidence = req.body.minConfidence || 85;
    const result = await BankingService.autoReconcileAll(orgId, minConfidence, userId);
    res.json(result);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/banking/sync', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const result = await BankingService.syncTransactions(orgId);
    res.json(result);
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.post('/banking/match', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { transactionId, targetAccountId, existingJournalEntryId } = req.body;
    const userId = (req as AuthenticatedRequest).userId!;
    const journalEntryId = await BankingService.matchTransaction(orgId, transactionId, targetAccountId, existingJournalEntryId, userId);
    res.json({ journalEntryId });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.get('/banking/rules', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const rules = await BankingService.getRules(orgId);
    res.json({ rules });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/banking/rules', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    const id = await BankingService.createRule(orgId, req.body.matchText, req.body.targetAccountId, userId);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.delete('/banking/rules/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await BankingService.deleteRule(orgId, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.get('/banking/reconciliation', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const summary = await BankingService.getReconciliationSummary(orgId);
    res.json(summary);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/banking/connection-requests', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const requests = await BankingService.getConnectionRequests(orgId);
    res.json({ requests });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/banking/connection-requests', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    const id = await BankingService.requestBankConnection(orgId, req.body, userId);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.get('/customers', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const customers = await CustomerService.getCustomers(orgId);
    res.json({ customers });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/customers', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await CustomerService.createCustomer(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/customers/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await CustomerService.updateCustomer(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Invoices ---
apiRouter.get('/invoices', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const invoices = await InvoiceService.getInvoices(orgId);
    res.json({ invoices });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/invoices', async (req, res) => {
  try {
    const authenticatedReq = req as AuthenticatedRequest;
    const id = await InvoiceService.createInvoice({
      ...req.body,
      orgId: authenticatedReq.orgId!,
      createdBy: authenticatedReq.userId!,
    });
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/invoices/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await InvoiceService.updateInvoice(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Vendors ---
apiRouter.get('/vendors', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const vendors = await VendorService.getVendors(orgId);
    res.json({ vendors });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/vendors', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await VendorService.createVendor(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/vendors/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await VendorService.updateVendor(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Bills ---
apiRouter.get('/bills', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const bills = await BillService.getBills(orgId);
    res.json({ bills });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/bills', async (req, res) => {
  try {
    const authenticatedReq = req as AuthenticatedRequest;
    const id = await BillService.createBill({
      ...req.body,
      orgId: authenticatedReq.orgId!,
      createdBy: authenticatedReq.userId!,
    });
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/bills/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await BillService.updateBill(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.post('/bills/batch-pay', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId!;
    const { billIds, paymentDate } = req.body;
    if (!Array.isArray(billIds) || billIds.length === 0) throw new Error('billIds array is required.');
    const result = await BillService.recordBatchPayment(orgId, billIds, paymentDate || new Date().toISOString().slice(0, 10), userId);
    res.json(result);
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.post('/expenses/scan', async (req, res) => {
  try {
    const { image, imageBase64, mimeType } = req.body;
    const receiptImage = image || imageBase64;
    if (!receiptImage) throw new Error('Image data is required');
    const result = await GeminiService.scanReceipt(receiptImage, mimeType || 'image/jpeg');
    res.json(result);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

// --- AI Business Feed ---
apiRouter.post('/ai/ask', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const question = (req.body.question || '').trim();
    if (!question) throw new Error('A question is required.');
    if (question.length > 500) throw new Error('Question is too long (max 500 characters).');
    const answer = await AIInsightsService.ask(orgId, question);
    res.json({ answer });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Payroll ---
apiRouter.get('/employees', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const employees = await PayrollService.getEmployees(orgId);
    res.json({ employees });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/employees', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await PayrollService.addEmployee(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/employees/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await PayrollService.updateEmployee(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.get('/payroll/runs', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const runs = await PayrollService.getPayrollRuns(orgId);
    res.json({ runs });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/payroll/runs/:id/payslips', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const payslips = await PayrollService.getPayslips(orgId, req.params.id);
    res.json({ payslips });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/payroll/runs', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId!;
    const { period, payDate } = req.body;
    if (!period || !payDate) throw new Error('period and payDate are required.');
    const id = await PayrollService.runPayroll(orgId, period, payDate, userId);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Inventory ---
apiRouter.get('/inventory', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const items = await InventoryService.getItems(orgId);
    res.json({ items });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/inventory', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await InventoryService.createItem(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/inventory/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await InventoryService.updateItem(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Projects ---
apiRouter.get('/projects', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const projects = await ProjectService.getProjects(orgId);
    res.json({ projects });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/projects', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await ProjectService.createProject(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.patch('/projects/:id', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await ProjectService.updateProject(orgId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.get('/time-entries', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const entries = await ProjectService.getTimeEntries(orgId);
    res.json({ entries });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/time-entries', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId;
    const id = await ProjectService.submitTimeEntry(orgId, userId, req.body);
    res.json({ id });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Bulk Operations ---
apiRouter.post('/bulk/delete', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as AuthenticatedRequest).userId!;
    const { entityType, ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('ids array is required');
    }

    if (entityType === 'INVOICES') {
      for (const id of ids) {
        await InvoiceService.voidInvoice(orgId, id, userId);
      }
      return res.json({ success: true, count: ids.length, action: 'VOID' });
    }

    if (entityType === 'BILLS') {
      for (const id of ids) {
        await BillService.voidBill(orgId, id, userId);
      }
      return res.json({ success: true, count: ids.length, action: 'VOID' });
    }

    const collectionMap: Record<string, string> = {
      CUSTOMERS: 'customers',
      VENDORS: 'vendors',
      INVENTORY: 'inventory_items',
      EMPLOYEES: 'employees'
    };

    const collName = collectionMap[entityType];
    if (!collName) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    // Assuming soft-delete via archived_at is preferred, but falling back to delete for now
    // as changing all tables' schema might break existing selects unless we add archived_at IS NULL to all of them.
    // We will hard delete them as they are not posted directly to the ledger (except accounts, which should be protected if they have txns).
    const { error } = await supabase
      .from(collName)
      .delete()
      .eq('org_id', orgId)
      .in('id', ids);

    if (error) throw error;

    res.json({ success: true, count: ids.length, action: 'DELETE' });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.post('/bulk/status-update', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { entityType, ids, status } = bulkStatusUpdateSchema.parse(req.body);

    const collectionMap: Record<string, string> = {
      CUSTOMERS: 'customers',
      VENDORS: 'vendors',
      INVENTORY: 'inventory_items',
      EMPLOYEES: 'employees'
    };

    const collName = collectionMap[entityType];
    if (!collName) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    const { error } = await supabase
      .from(collName)
      .update({ status })
      .eq('org_id', orgId)
      .in('id', ids);

    if (error) throw error;

    res.json({ success: true, count: ids.length });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Organizations & Multi-Entity Management ---
apiRouter.get('/organizations', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const orgs = await OrganizationService.getOrganizations(userId);
    res.json({ organizations: orgs });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/organizations/:id', requireRequestedOrganization, async (req, res) => {
  try {
    const org = await OrganizationService.getOrganization(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: org });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/organizations', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const id = await OrganizationService.createOrganization(req.body, userId);
    res.json({ id, message: 'Organization created successfully' });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

apiRouter.put('/organizations/:id', requireRequestedOrganization, requireOrganizationAdministrator, async (req, res) => {
  try {
    await OrganizationService.updateOrganization(req.params.id, req.body);
    res.json({ success: true, message: 'Organization updated' });
  } catch (err: any) {
    sendClientError(res, err);
  }
});

// --- Multi-Currency & Free Exchange Rate Engine ---
apiRouter.get('/currency/rates', async (req, res) => {
  try {
    const base = (req.query.base as string) || 'KES';
    const forceRefresh = req.query.refresh === 'true';
    const ratesData = await CurrencyService.fetchLiveRates(base, forceRefresh);
    res.json(ratesData);
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.post('/currency/refresh', async (req, res) => {
  try {
    const base = req.body.base || 'KES';
    const ratesData = await CurrencyService.fetchLiveRates(base, true);
    res.json({ success: true, data: ratesData, message: 'Daily exchange rates refreshed from free live market API' });
  } catch (err: any) {
    sendServerError(res, err);
  }
});

apiRouter.get('/currency/unrealized-fx', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const base = (req.query.base as string) || 'KES';
    const breakdown = await CurrencyService.calculateUnrealizedFX(orgId, base);
    res.json(breakdown);
  } catch (err: any) {
    sendServerError(res, err);
  }
});
