// The Mizani client account reconciliation through the Worker's routes and
// PostgREST: nothing to sign until the client bank account is reconciled
// to its statement, then the three legs agree and an owner signs once.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { OrganizationService } from '../../src/server/organizations';
import { CustomerService } from '../../src/server/customers';
import { MatterService } from '../../src/server/matters';
import { ClientAccountService } from '../../src/server/clientAccount';
import { registerLawRoutes } from '../../worker/routes/law';
import { OWNER, sql } from './helpers';

const apiFor = (orgId: string, role: string) => {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', orgId); c.set('userId', OWNER); c.set('orgRole', role); await next(); });
  registerLawRoutes(api);
  return api;
};

test('the client account reconciliation is signed once the statement agrees with the books', async () => {
  const lawOrg = await OrganizationService.createOrganization({ name: 'Njeri & Co Advocates', country: 'Kenya', edition: 'law' } as any, OWNER);
  const client = await CustomerService.createCustomer(lawOrg, { displayName: 'Fictional client' } as any);
  const matter = await MatterService.create(lawOrg, OWNER, { title: 'Land purchase', clientId: client, matterType: 'CONVEYANCING', openedOn: '2026-10-01' } as any);
  await ClientAccountService.receipt(lawOrg, OWNER, { matterId: matter, amountCents: 500_000, receiptDate: '2026-10-02', method: 'BANK', reference: 'DEP-1', idempotencyKey: crypto.randomUUID() } as any);

  const owner = apiFor(lawOrg, 'owner');
  const before = await (await owner.request('/client-account/reconciliation?asOf=2026-10-31')).json();
  assert.equal(before.bankReconciliationId, null);
  assert.equal(before.cashBookCents, 500_000);
  assert.equal(before.matterLedgersCents, 500_000);

  // Reconcile the client bank account to a statement that shows the deposit.
  const bank = sql(`SELECT id FROM public.accounts WHERE org_id = '${lawOrg}' AND code = '1060'`);
  const rec = JSON.parse(sql(`SELECT public.start_bank_reconciliation('${lawOrg}', '${bank}', DATE '2026-10-31', 500000, 0, '${OWNER}')`));
  const line = sql(`SELECT id FROM public.journal_lines WHERE org_id = '${lawOrg}' AND account_id = '${bank}' AND debit = 500000`);
  sql(`SELECT public.set_bank_reconciliation_lines('${lawOrg}', '${rec.id}', ARRAY['${line}']::uuid[], '${OWNER}')`);
  sql(`SELECT public.complete_bank_reconciliation('${lawOrg}', '${rec.id}', '${OWNER}')`);

  const ready = await (await owner.request('/client-account/reconciliation?asOf=2026-10-31')).json();
  assert.equal(ready.agrees, true);
  assert.equal(ready.adjustedStatementCents, 500_000);

  const accountant = await apiFor(lawOrg, 'accountant').request('/client-account/reconciliation', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asOf: '2026-10-31' }),
  });
  assert.equal(accountant.status, 403);
  const signed = await owner.request('/client-account/reconciliation', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asOf: '2026-10-31', note: '' }),
  });
  assert.equal(signed.status, 200);
  assert.equal((await signed.json()).signed.agrees, true);
  const again = await owner.request('/client-account/reconciliation', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asOf: '2026-10-31' }),
  });
  assert.equal(again.status, 409);
});
