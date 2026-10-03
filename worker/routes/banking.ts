import { BankingService } from '../../src/server/banking';
import { bodyOf, respondError } from '../http';
import { autoReconcileSchema, bankMatchSchema, bankRuleSchema, connectionRequestSchema, uuid } from '../schemas';
import type { Api } from './types';

export function registerBankingRoutes(api: Api) {
  api.get('/banking/transactions', async (c) => {
    try {
      return c.json({ transactions: await BankingService.getTransactions(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/ai-matches', async (c) => {
    try {
      return c.json({ matches: await BankingService.getAIMatches(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/auto-reconcile-all', async (c) => {
    try {
      const body = autoReconcileSchema.parse(await bodyOf(c));
      return c.json(await BankingService.autoReconcileAll(c.get('orgId'), body.minConfidence, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/sync', async (c) => {
    try {
      return c.json(await BankingService.syncTransactions(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/match', async (c) => {
    try {
      const { transactionId, ...target } = bankMatchSchema.parse(await bodyOf(c));
      const journalEntryId = await BankingService.matchTransaction(c.get('orgId'), transactionId, target, c.get('userId'));
      return c.json({ journalEntryId });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/transactions/:id/unmatch', async (c) => {
    try {
      return c.json(await BankingService.unmatchTransaction(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/rules', async (c) => {
    try {
      return c.json({ rules: await BankingService.getRules(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/rules', async (c) => {
    try {
      const body = bankRuleSchema.parse(await bodyOf(c));
      return c.json({ id: await BankingService.createRule(c.get('orgId'), body.matchText, body.targetAccountId, c.get('userId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.delete('/banking/rules/:id', async (c) => {
    try {
      await BankingService.deleteRule(c.get('orgId'), uuid.parse(c.req.param('id')));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/reconciliation', async (c) => {
    try {
      return c.json(await BankingService.getReconciliationSummary(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/connection-requests', async (c) => {
    try {
      return c.json({ requests: await BankingService.getConnectionRequests(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/connection-requests', async (c) => {
    try {
      const body = connectionRequestSchema.parse(await bodyOf(c));
      return c.json({ id: await BankingService.requestBankConnection(c.get('orgId'), body as any, c.get('userId')) });
    } catch (err) { return respondError(c, err); }
  });
}
