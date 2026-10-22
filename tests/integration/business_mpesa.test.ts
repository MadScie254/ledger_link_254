// Live M-Pesa for a business, through its services, routes and PostgREST:
// Safaricom's C2B confirmation becomes one statement line on the M-Pesa
// account and settles the invoice its account number names; anything else
// waits in Banking with the reason kept.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { MpesaPaymentService } from '../../src/server/mpesaPayments';
import { InvoiceService } from '../../src/server/invoices';
import { OrganizationService } from '../../src/server/organizations';
import { C2B_ACCEPTED, C2B_REJECTED } from '../../src/utils/mpesaC2b';
import { registerMpesaPublicRoutes, registerMpesaRoutes } from '../../worker/routes/mpesa';
import confirmation from './fixtures/c2b-confirmation-1043.json';
import { CUSTOMER, MEMBER, ORG, OWNER, SALES, refused, sql, uuid } from './helpers';

let mpesaAccount = '';
let token = '';
let firstInvoice = '';
let firstNumber = '';

const publicApp = new Hono<any>();
registerMpesaPublicRoutes(publicApp);
const confirm = (body: unknown, path = 'payments') => publicApp.request(`/api/public/${path}/c2b/${token}/confirmation`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const invoiceDue = async (id: string) => (await InvoiceService.getInvoices(ORG)).find((invoice) => invoice.id === id)!;

function adminApi(orgId: string, role = 'owner') {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', orgId); c.set('userId', OWNER); c.set('orgRole', role); await next(); });
  registerMpesaRoutes(api);
  return api;
}

test('a business links its paybill; payments land in M-Pesa account 1050 unless another is chosen', async () => {
  mpesaAccount = sql(`INSERT INTO public.accounts (org_id, code, name, type, is_bank_account)
    VALUES ('${ORG}', '1050', 'M-Pesa', 'ASSET', true) RETURNING id`).split('\n')[0];
  await refused(MpesaC2bService.saveSettings(ORG, OWNER, {
    shortcode: '174379', environment: 'SANDBOX', consumerKey: 'k', consumerSecret: 's', integrationActorId: OWNER, moneyAccountId: SALES,
  }), /money account/);
  await MpesaC2bService.saveSettings(ORG, OWNER, {
    shortcode: '174379', environment: 'SANDBOX', consumerKey: 'test-key', consumerSecret: 'test-secret', integrationActorId: OWNER,
  });
  const settings = await MpesaC2bService.settings(ORG);
  assert.equal(settings.moneyAccountId, mpesaAccount);
  assert.equal(settings.integrationActorId, OWNER);
  assert.ok(!JSON.stringify(settings).includes('test-secret'));

  const urls = await MpesaC2bService.issueCallbackUrls(ORG, OWNER, 'https://books.example.co.ke');
  assert.match(urls.confirmationUrl, /^https:\/\/books\.example\.co\.ke\/api\/public\/payments\/c2b\/[0-9a-f]{64}\/confirmation$/);
  token = urls.confirmationUrl.split('/').at(-2)!;
  const target = await MpesaC2bService.target(token);
  assert.equal(target?.edition, 'business');
  assert.equal(target?.moneyAccountId, mpesaAccount);
});

test('a payment naming an invoice settles it once, however often Safaricom repeats it', async () => {
  firstInvoice = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 400_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  firstNumber = (await invoiceDue(firstInvoice)).invoiceNumber;
  const body = { ...confirmation, TransID: 'TKB1C2D3E4', TransAmount: '1500.00', BillRefNumber: firstNumber.replace(/-/g, '').toLowerCase() };

  const validation = await publicApp.request(`/api/public/payments/c2b/${token}/validation`, { method: 'POST', body: '{}' });
  assert.deepEqual(await validation.json(), C2B_ACCEPTED);
  const response = await confirm(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), C2B_ACCEPTED);

  const invoice = await invoiceDue(firstInvoice);
  assert.equal(invoice.amountDueCents, 250_000);
  assert.equal(invoice.status, 'PARTIALLY_PAID');
  const [payment] = await MpesaPaymentService.recent(ORG);
  assert.equal(payment.transId, 'TKB1C2D3E4');
  assert.equal(payment.outcome, 'SETTLED');
  assert.equal(payment.invoiceNumber, firstNumber);
  assert.equal(payment.payerName, 'MFANO');
  assert.equal(sql(`SELECT status || ':' || bank_account_id FROM public.bank_transactions WHERE org_id = '${ORG}' AND reference = 'TKB1C2D3E4'`),
    `MATCHED:${mpesaAccount}`);

  // The same confirmation again, even on another of the paths, changes nothing.
  assert.deepEqual(await (await confirm(body, 'mpesa')).json(), C2B_ACCEPTED);
  assert.equal((await invoiceDue(firstInvoice)).amountDueCents, 250_000);
  assert.equal(sql(`SELECT count(*) FROM public.bank_transactions WHERE org_id = '${ORG}' AND reference = 'TKB1C2D3E4'`), '1');
  assert.equal(sql(`SELECT count(*) FROM public.mpesa_payments WHERE org_id = '${ORG}'`), '1');
});

test('a payment that names no open invoice waits, and settles once that invoice exists', async () => {
  // The customer typed the number of the next invoice before it was raised.
  const nextNumber = firstNumber.replace(/(\d+)$/, (digits) => String(Number(digits) + 1).padStart(digits.length, '0'));
  assert.deepEqual(await (await confirm({ ...confirmation, TransID: 'TKB1C2D3E5', TransAmount: '700', BillRefNumber: nextNumber })).json(), C2B_ACCEPTED);
  const waiting = (await MpesaPaymentService.recent(ORG)).find((payment) => payment.transId === 'TKB1C2D3E5')!;
  assert.equal(waiting.outcome, 'WAITING');
  assert.match(waiting.note || '', /is not the number of an open invoice/);
  assert.equal(sql(`SELECT status FROM public.bank_transactions WHERE org_id = '${ORG}' AND reference = 'TKB1C2D3E5'`), 'UNREVIEWED');

  const second = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-10-01', dueDate: '2026-10-31', currency: 'KES',
    lines: [{ description: 'Delivery', accountId: SALES, amountCents: 70_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal((await invoiceDue(second)).invoiceNumber, nextNumber);

  // Members cannot reach the payments; an owner settles from the account number.
  const member = await adminApi(ORG, 'member').request(`/integrations/mpesa/payments/${waiting.id}/settle`, { method: 'POST' });
  assert.equal(member.status, 403);
  const settled = await adminApi(ORG).request(`/integrations/mpesa/payments/${waiting.id}/settle`, { method: 'POST' });
  assert.equal(settled.status, 200);
  const result = await settled.json();
  assert.equal(result.outcome, 'SETTLED');
  assert.equal(result.invoiceNumber, nextNumber);
  assert.equal((await invoiceDue(second)).status, 'PAID');

  const listed = await adminApi(ORG).request('/integrations/mpesa/payments');
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).payments.map((payment: any) => payment.outcome), ['SETTLED', 'SETTLED']);
});

test('without anyone named to post, a payment waits in Banking', async () => {
  sql(`UPDATE public.organizations SET integration_actor_id = NULL WHERE id = '${ORG}'`);
  await confirm({ ...confirmation, TransID: 'TKB1C2D3E6', TransAmount: '100', BillRefNumber: firstNumber });
  const waiting = (await MpesaPaymentService.recent(ORG)).find((payment) => payment.transId === 'TKB1C2D3E6')!;
  assert.equal(waiting.outcome, 'WAITING');
  assert.match(waiting.note || '', /No one is named/);
  assert.equal((await invoiceDue(firstInvoice)).amountDueCents, 250_000);
  sql(`UPDATE public.organizations SET integration_actor_id = '${OWNER}' WHERE id = '${ORG}'`);
});

test('a token that is not registered, or a body that is not a payment, is refused', async () => {
  const unknown = await publicApp.request(`/api/public/payments/c2b/${'0'.repeat(64)}/confirmation`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirmation),
  });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), C2B_REJECTED);
  const unreadable = await confirm({ ...confirmation, TransAmount: 'abc', TransID: 'TKB1C2D3E7' });
  assert.equal(unreadable.status, 400);
  assert.equal(sql(`SELECT count(*) FROM public.mpesa_payments WHERE trans_id = 'TKB1C2D3E7'`), '0');
});

test('a law organization has no M-Pesa link, and a church reads its receipts in Giving', async () => {
  const law = await OrganizationService.createOrganization({ name: 'Wakili na Wenzake', country: 'Kenya', edition: 'law' } as any, OWNER);
  const lawSettings = await adminApi(law).request('/integrations/mpesa');
  assert.equal(lawSettings.status, 403);
  const church = await OrganizationService.createOrganization({ name: 'Kanisa la Malipo', country: 'Kenya', edition: 'church' } as any, OWNER);
  assert.equal((await adminApi(church).request('/integrations/mpesa')).status, 200);
  const churchPayments = await adminApi(church).request('/integrations/mpesa/payments');
  assert.equal(churchPayments.status, 403);
  assert.match((await churchPayments.json()).error, /Giving/);
  assert.ok(MEMBER);
});
