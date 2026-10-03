import { AccountService, type AccountInput } from '../../src/server/accounts';
import { OrganizationService } from '../../src/server/organizations';
import { LedgerService } from '../../src/server/ledger';
import { AuditService } from '../../src/server/audit';
import { BudgetService, type BudgetInput } from '../../src/server/budgets';
import type { JournalEntryInput } from '../../src/server/types';
import { bodyOf, respondError, UserError } from '../http';
import {
  accountSchema,
  accountUpdateSchema,
  budgetSchema,
  budgetUpdateSchema,
  bulkAccountsSchema,
  journalEntrySchema,
  undoBulkSchema,
  uuid,
} from '../schemas';
import type { Api } from './types';

export function registerAccountingRoutes(api: Api) {
  // --- Chart of accounts ---
  api.get('/accounts', async (c) => {
    try {
      return c.json({ accounts: await AccountService.getAccounts(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/accounts', async (c) => {
    try {
      const body = accountSchema.parse(await bodyOf(c));
      const id = await AccountService.createAccount({ ...(body as Omit<AccountInput, 'orgId'>), orgId: c.get('orgId') });
      return c.json({ id });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/accounts/:id', async (c) => {
    try {
      const body = accountUpdateSchema.parse(await bodyOf(c));
      await AccountService.updateAccount(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/accounts/bulk', async (c) => {
    try {
      const { accounts } = bulkAccountsSchema.parse(await bodyOf(c));
      return c.json(await AccountService.bulkCreateAccounts(c.get('orgId'), accounts as any));
    } catch (err) { return respondError(c, err); }
  });

  // Undoes one import, and only what that import created.
  api.post('/accounts/undo-bulk', async (c) => {
    try {
      const { batchId } = undoBulkSchema.parse(await bodyOf(c));
      const removed = await AccountService.undoImport(c.get('orgId'), batchId);
      return c.json({ success: true, removed });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/accounts/seed', async (c) => {
    try {
      await OrganizationService.seedDefaultAccounts(c.get('orgId'));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  // --- Journal entries ---
  api.get('/journal-entries', async (c) => {
    try {
      return c.json({ entries: await LedgerService.getJournalEntries(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/journal-entries', async (c) => {
    try {
      const body = journalEntrySchema.parse(await bodyOf(c)) as Omit<JournalEntryInput, 'orgId' | 'createdBy'>;
      const id = await LedgerService.postJournalEntry({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
      return c.json({ id });
    } catch (err) { return respondError(c, err); }
  });

  // --- Audit log ---
  api.get('/audit', async (c) => {
    try {
      const cursorParam = c.req.query('cursor');
      let cursor: { timestamp: string; id: string } | undefined;
      if (cursorParam) {
        const [timestamp, id] = cursorParam.split('|');
        if (!timestamp || !id) throw new UserError('That page link is not valid.');
        cursor = { timestamp, id };
      }
      const resourceType = c.req.query('resourceType');
      if (resourceType && !/^[A-Z_]{2,40}$/.test(resourceType)) throw new UserError('Unknown record type.');
      const resourceId = c.req.query('resourceId');
      return c.json(await AuditService.getLogs(c.get('orgId'), {
        cursor,
        limit: Number(c.req.query('limit')) || 50,
        resourceType: resourceType || undefined,
        resourceId: resourceId ? uuid.parse(resourceId) : undefined,
        includePayroll: c.get('orgRole') !== 'member',
      }));
    } catch (err) { return respondError(c, err); }
  });

  // --- Budgets ---
  api.get('/budgets', async (c) => {
    try {
      return c.json({ budgets: await BudgetService.getBudgets(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/budgets', async (c) => {
    try {
      const body = budgetSchema.parse(await bodyOf(c));
      const id = await BudgetService.createBudget({ ...(body as Omit<BudgetInput, 'orgId' | 'createdBy'>), orgId: c.get('orgId'), createdBy: c.get('userId') });
      return c.json({ id });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/budgets/:id', async (c) => {
    try {
      const body = budgetUpdateSchema.parse(await bodyOf(c));
      await BudgetService.updateBudget(c.get('orgId'), uuid.parse(c.req.param('id')), body.limitCents);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.delete('/budgets/:id', async (c) => {
    try {
      await BudgetService.deleteBudget(c.get('orgId'), uuid.parse(c.req.param('id')));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
}
