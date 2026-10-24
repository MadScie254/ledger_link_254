import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { InventoryService } from '../../src/server/inventory';
import { CashTransactionService } from '../../src/server/cashTransactions';
import { registerOperationsRoutes } from '../../worker/routes/operations';
import { BANK, CEMENT, ORG, OWNER, SALES, sql, uuid } from './helpers';

const apiAs = (role: string) => {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('userId', OWNER); c.set('orgRole', role); await next(); });
  registerOperationsRoutes(api);
  return api;
};

test('stock valuation starts from the counted stock and a sale posts its cost of goods sold', async () => {
  const before = await InventoryService.getValuation(ORG);
  assert.equal(before.startDate, null);

  // An accountant cannot turn it on; an owner can, at the cost given.
  const refused = await apiAs('accountant').request('/inventory/valuation/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: '2026-09-01', costs: [] }),
  });
  assert.equal(refused.status, 403);
  const started = await apiAs('owner').request('/inventory/valuation/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: '2026-09-01', costs: [{ itemId: CEMENT, unitCostCents: 40_000 }] }),
  });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).valueCents, 200_000);

  await CashTransactionService.recordSalesReceipt({
    orgId: ORG, payeeName: 'Walk-in', date: '2026-09-10', depositAccountId: BANK,
    lines: [{ description: 'Cement 50kg', accountId: SALES, inventoryItemId: CEMENT, quantity: 2, unitPriceCents: 75_000 } as any],
    actor: OWNER, idempotencyKey: uuid(),
  });

  const report = await (await apiAs('member').request('/inventory/valuation')).json();
  assert.equal(report.startDate, '2026-09-01');
  assert.equal(report.itemsValueCents, 120_000);
  assert.equal(report.ledgerValueCents, 120_000);
  const cement = report.items.find((item: any) => item.itemId === CEMENT);
  assert.equal(cement.quantity, 3);
  assert.equal(cement.averageCostCents, 40_000);
  assert.equal(Number(sql(`SELECT sum(l.debit - l.credit) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${ORG}' AND a.code = '5000'`)), 80_000);

  const movements = await InventoryService.getMovements(ORG, CEMENT);
  assert.equal(movements[0].valueCents, -80_000);
  assert.equal(movements[0].valueAfterCents, 120_000);
});
