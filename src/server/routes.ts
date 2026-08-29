import { Router } from 'express';
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

export const apiRouter = Router();

// Middleware to mock orgId/auth for now, until Firebase Auth is hooked up on the frontend
apiRouter.use((req, res, next) => {
  // In a real app, extract orgId from JWT token
  req.body.orgId = req.headers['x-org-id'] || 'default-org-id';
  (req as any).orgId = req.body.orgId;
  (req as any).userId = req.headers['x-user-id'] || 'demo-user-id';
  next();
});

// --- Reports ---
apiRouter.get('/reports/pnl', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const dateRange = (req.query.dateRange as string) || 'This Year-to-date';
    const data = await ReportsService.getProfitAndLoss(orgId, dateRange);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/reports/balance-sheet', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const asOfDate = (req.query.asOfDate as string) || new Date().toISOString();
    const data = await ReportsService.getBalanceSheet(orgId, asOfDate);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/reports/cash-flow', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const dateRange = (req.query.dateRange as string) || 'This Year-to-date';
    const data = await ReportsService.getCashFlow(orgId, dateRange);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/reports/trial-balance', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const data = await ReportsService.getTrialBalance(orgId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/reports/tax-summary', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const period = (req.query.period as string) || 'August 2026';
    const data = await ReportsService.getTaxSummary(orgId, period);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/team', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const members = await TeamService.getMembers(orgId);
    res.json({ members });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/team', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await TeamService.addMember({ ...req.body, orgId });
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/dashboard/metrics', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const metrics = await DashboardService.getMetrics(orgId);
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/accounts', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const id = await AccountService.createAccount({ ...req.body, orgId, createdBy: userId });
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

// --- Journal Entries ---
apiRouter.get('/journal-entries', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const entries = await LedgerService.getJournalEntries(orgId);
    res.json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/journal-entries', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const id = await LedgerService.postJournalEntry({ ...req.body, orgId, createdBy: userId });
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Audit Logs ---
apiRouter.get('/audit', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const logs = await AuditService.getLogs(orgId);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/accounts', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const accounts = await AccountService.getAccounts(orgId);
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// --- Banking ---
apiRouter.get('/banking/transactions', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const transactions = await BankingService.getTransactions(orgId);
    res.json({ transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/banking/ai-matches', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const matches = await BankingService.getAIMatches(orgId);
    res.json({ matches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/banking/auto-reconcile-all', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId || 'demo-user';
    const minConfidence = req.body.minConfidence || 85;
    const result = await BankingService.autoReconcileAll(orgId, minConfidence, userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/banking/sync', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const result = await BankingService.syncMockTransactions(orgId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/banking/match', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { transactionId, targetAccountId, existingJournalEntryId } = req.body;
    const journalEntryId = await BankingService.matchTransaction(orgId, transactionId, targetAccountId, existingJournalEntryId, 'test-user');
    res.json({ journalEntryId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/customers', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const customers = await CustomerService.getCustomers(orgId);
    res.json({ customers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/customers', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await CustomerService.createCustomer(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Invoices ---
apiRouter.get('/invoices', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const invoices = await InvoiceService.getInvoices(orgId);
    res.json({ invoices });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/invoices', async (req, res) => {
  try {
    req.body.createdBy = 'test-user';
    const id = await InvoiceService.createInvoice(req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Vendors ---
apiRouter.get('/vendors', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const vendors = await VendorService.getVendors(orgId);
    res.json({ vendors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/vendors', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await VendorService.createVendor(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Bills ---
apiRouter.get('/bills', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const bills = await BillService.getBills(orgId);
    res.json({ bills });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/bills', async (req, res) => {
  try {
    req.body.createdBy = 'test-user';
    const id = await BillService.createBill(req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Payroll ---
apiRouter.get('/employees', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const employees = await PayrollService.getEmployees(orgId);
    res.json({ employees });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/employees', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await PayrollService.addEmployee(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Inventory ---
apiRouter.get('/inventory', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const items = await InventoryService.getItems(orgId);
    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/inventory', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await InventoryService.createItem(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Projects ---
apiRouter.get('/projects', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const projects = await ProjectService.getProjects(orgId);
    res.json({ projects });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/projects', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const id = await ProjectService.createProject(orgId, req.body);
    res.json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Bulk Operations ---
apiRouter.post('/bulk/delete', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { entityType, ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('ids array is required');
    }

    const collectionMap: Record<string, string> = {
      CUSTOMERS: 'customers',
      VENDORS: 'vendors',
      BILLS: 'bills',
      INVOICES: 'invoices',
      INVENTORY: 'inventory_items',
      ACCOUNTS: 'accounts',
      EMPLOYEES: 'employees'
    };

    const collName = collectionMap[entityType];
    if (!collName) throw new Error(`Unsupported entity type: ${entityType}`);

    const supabase = getSupabase();
    const { error } = await supabase
      .from(collName)
      .delete()
      .eq('org_id', orgId)
      .in('id', ids);

    if (error) throw error;

    res.json({ success: true, count: ids.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/bulk/status-update', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { entityType, ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('ids array is required');
    }

    const collectionMap: Record<string, string> = {
      CUSTOMERS: 'customers',
      VENDORS: 'vendors',
      BILLS: 'bills',
      INVOICES: 'invoices',
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
    res.status(400).json({ error: err.message });
  }
});

// --- Organizations & Multi-Entity Management ---
apiRouter.get('/organizations', async (req, res) => {
  try {
    const orgs = await OrganizationService.getOrganizations();
    res.json({ organizations: orgs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/organizations/:id', async (req, res) => {
  try {
    const org = await OrganizationService.getOrganization(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: org });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/organizations', async (req, res) => {
  try {
    const id = await OrganizationService.createOrganization(req.body);
    res.json({ id, message: 'Organization created successfully' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/organizations/:id', async (req, res) => {
  try {
    await OrganizationService.updateOrganization(req.params.id, req.body);
    res.json({ success: true, message: 'Organization updated' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/currency/refresh', async (req, res) => {
  try {
    const base = req.body.base || 'KES';
    const ratesData = await CurrencyService.fetchLiveRates(base, true);
    res.json({ success: true, data: ratesData, message: 'Daily exchange rates refreshed from free live market API' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/currency/unrealized-fx', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const base = (req.query.base as string) || 'KES';
    const breakdown = await CurrencyService.calculateUnrealizedFX(orgId, base);
    res.json(breakdown);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
