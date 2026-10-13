import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { BankingService } from '../../src/server/banking';
import { registerBankingRoutes } from '../../worker/routes/banking';
import { BANK, ORG, OWNER } from './helpers';

test('CSV layout is saved for the imported account and read back by the Worker', async () => {
  const layout = { headerRow: 1, mapping: { date: 0, description: 1, amount: 2, reference: 3, dateFormat: 'DMY' as const } };
  const result = await BankingService.importStatement(ORG, BANK, 'september.csv', [
    { date: '2026-09-21', description: 'Layout test debit', amountCents: -12_345, reference: 'MAP-1' },
  ], OWNER, layout);
  assert.equal(result.imported, 1);
  assert.equal(result.layoutSaved, true);
  assert.deepEqual(await BankingService.getStatementLayout(ORG, BANK), layout);
  assert.equal(await BankingService.getStatementLayout('00000000-0000-0000-0000-0000000000bb', BANK), null);
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('userId', OWNER); await next(); });
  registerBankingRoutes(api);
  const response = await api.request(`/banking/statements/layout?accountId=${BANK}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).layout, layout);
});
