import { BankingService, type StatementLineInput } from '../../src/server/banking';
import { ReconciliationService } from '../../src/server/reconciliation';
import { bodyOf, respondError } from '../http';
import {
  autoReconcileSchema, bankMatchSchema, bankRuleSchema, connectionRequestSchema, optionalUuid,
  reconciliationLinesSchema, reconciliationStartSchema, reconciliationUndoSchema, statementImportSchema, uuid,
} from '../schemas';
import type { Api } from './types';

export function registerBankingRoutes(api: Api) {
  api.get('/banking/transactions', async (c) => {
    try {
      return c.json({ transactions: await BankingService.getTransactions(c.get('orgId'), optionalUuid.parse(c.req.query('accountId'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/statements', async (c) => {
    try {
      const body = statementImportSchema.parse(await bodyOf(c));
      return c.json(await BankingService.importStatement(c.get('orgId'), body.accountId, body.fileName, body.lines as StatementLineInput[], c.get('userId')), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/statements', async (c) => {
    try {
      return c.json({ imports: await BankingService.getImports(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/reconciliations', async (c) => {
    try {
      return c.json({ reconciliations: await ReconciliationService.list(c.get('orgId'), optionalUuid.parse(c.req.query('accountId'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/reconciliations', async (c) => {
    try {
      const body = reconciliationStartSchema.parse(await bodyOf(c));
      return c.json(await ReconciliationService.start(c.get('orgId'), body as Parameters<typeof ReconciliationService.start>[1], c.get('userId')), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.get('/banking/reconciliations/:id', async (c) => {
    try {
      return c.json(await ReconciliationService.worksheet(c.get('orgId'), uuid.parse(c.req.param('id'))));
    } catch (err) { return respondError(c, err); }
  });

  api.put('/banking/reconciliations/:id/lines', async (c) => {
    try {
      const body = reconciliationLinesSchema.parse(await bodyOf(c));
      return c.json(await ReconciliationService.setLines(c.get('orgId'), uuid.parse(c.req.param('id')), body.journalLineIds, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/reconciliations/:id/complete', async (c) => {
    try {
      return c.json(await ReconciliationService.complete(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/banking/reconciliations/:id/undo', async (c) => {
    try {
      const body = reconciliationUndoSchema.parse(await bodyOf(c));
      return c.json(await ReconciliationService.undo(c.get('orgId'), uuid.parse(c.req.param('id')), body.reason, c.get('userId')));
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

  api.get('/banking/transactions/:id/candidates', async (c) => {
    try {
      return c.json({ entries: await BankingService.getEntryCandidates(c.get('orgId'), uuid.parse(c.req.param('id'))) });
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
      return c.json(await BankingService.getReconciliationSummary(c.get('orgId'), optionalUuid.parse(c.req.query('accountId'))));
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
