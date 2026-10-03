import { ReportsService } from '../../src/server/reports';
import { DashboardService } from '../../src/server/metrics';
import { respondError, UserError } from '../http';
import { uuid } from '../schemas';
import type { Api } from './types';

export function registerReportRoutes(api: Api) {
  api.get('/reports/pnl', async (c) => {
    try {
      return c.json(await ReportsService.getProfitAndLoss(c.get('orgId'), c.req.query('dateRange') || 'This Year-to-date'));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/balance-sheet', async (c) => {
    try {
      return c.json(await ReportsService.getBalanceSheet(c.get('orgId'), c.req.query('asOfDate') || new Date().toISOString()));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/cash-flow', async (c) => {
    try {
      return c.json(await ReportsService.getCashFlow(c.get('orgId'), c.req.query('dateRange') || 'This Year-to-date'));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/trial-balance', async (c) => {
    try {
      return c.json(await ReportsService.getTrialBalance(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/tax-summary', async (c) => {
    try {
      return c.json(await ReportsService.getTaxSummary(c.get('orgId'), c.req.query('period') || 'This month'));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/ledger', async (c) => {
    try {
      const accountId = c.req.query('accountId');
      const accountName = c.req.query('accountName');
      if (accountId) {
        return c.json({ lines: await ReportsService.getLedgerLinesForAccount(c.get('orgId'), { id: uuid.parse(accountId) }) });
      }
      if (!accountName || accountName.length > 200) throw new UserError('Choose an account.');
      return c.json({ lines: await ReportsService.getLedgerLinesForAccount(c.get('orgId'), { name: accountName }) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/ar-aging', async (c) => {
    try {
      return c.json(await ReportsService.getARAging(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/ap-aging', async (c) => {
    try {
      return c.json(await ReportsService.getAPAging(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });

  // Receivables and payables in the ledger against their open documents.
  api.get('/reports/control-check', async (c) => {
    try {
      return c.json(await ReportsService.getControlCheck(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/dashboard/metrics', async (c) => {
    try {
      return c.json(await DashboardService.getMetrics(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });
}
