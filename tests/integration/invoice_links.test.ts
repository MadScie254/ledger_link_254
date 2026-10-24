// The customer's invoice link through the Worker's routes and PostgREST,
// with a stand-in for Daraja: the link is made and copied again, the
// customer opens the invoice outside sign-in and asks their phone to pay,
// Safaricom's result settles the invoice, and a withdrawn link opens nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import { Hono } from 'hono';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { MpesaExpressService } from '../../src/server/mpesaExpress';
import { InvoiceService } from '../../src/server/invoices';
import { registerMpesaPublicRoutes } from '../../worker/routes/mpesa';
import { registerInvoiceLinkPublicRoutes, registerInvoiceLinkRoutes } from '../../worker/routes/invoiceLinks';
import { CUSTOMER, ORG, OWNER, SALES, sql, uuid } from './helpers';

const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
let server: Server;
const pushes: any[] = [];

const publicApp = new Hono<any>();
registerMpesaPublicRoutes(publicApp);
registerInvoiceLinkPublicRoutes(publicApp);
const api = new Hono<any>();
api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('userId', OWNER); c.set('orgRole', 'owner'); await next(); });
registerInvoiceLinkRoutes(api);

test.before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if ((req.url || '').startsWith('/oauth/v1/generate')) {
        res.end(JSON.stringify({ access_token: 'sandbox-access', expires_in: '3599' }));
        return;
      }
      pushes.push(JSON.parse(raw));
      res.end(JSON.stringify({ MerchantRequestID: `m-${pushes.length}`, CheckoutRequestID: `ws_CO_LINK${pushes.length}`,
        ResponseCode: '0', ResponseDescription: 'Success. Request accepted for processing', CustomerMessage: 'Success. Request accepted for processing' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.DARAJA_SANDBOX_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.after(() => {
  server.close();
  delete process.env.DARAJA_SANDBOX_BASE_URL;
});

test('a customer opens a shared invoice, pays it from their phone, and a withdrawn link stops working', async () => {
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-10-01', dueDate: '2026-10-31', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 300_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });

  const made = await (await api.request(`/invoices/${invoiceId}/share-link`, { method: 'POST' })).json();
  assert.match(made.url, /^http:\/\/localhost\/pay\/[0-9a-f]{64}$/);
  assert.equal(made.created, true);
  const again = await (await api.request(`/invoices/${invoiceId}/share-link`, { method: 'POST' })).json();
  assert.equal(again.url, made.url, 'the same link is copied again');
  const token = made.url.split('/').at(-1);

  // Before M-Pesa is set up the page shows the invoice and offers no payment.
  const opened = await publicApp.request(`/api/public/invoices/${token}`);
  assert.equal(opened.status, 200);
  const page = await opened.json();
  assert.equal(page.document.kind, 'invoice');
  assert.equal(page.amountDueCents, 300_000);
  assert.equal(page.pay.canRequestPayment, false);
  const refused = await publicApp.request(`/api/public/invoices/${token}/mpesa`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0712345678', amountCents: 100_000 }),
  });
  assert.equal(refused.status, 409);

  // With the Daraja keys, the passkey and a posting person, the page asks the phone.
  sql(`INSERT INTO public.accounts (org_id, code, name, type, is_bank_account) VALUES ('${ORG}', '1050', 'M-Pesa', 'ASSET', true) ON CONFLICT (org_id, code) DO NOTHING`);
  await MpesaC2bService.saveSettings(ORG, OWNER, {
    shortcode: '174379', environment: 'SANDBOX', consumerKey: 'test-key', consumerSecret: 'test-secret', integrationActorId: OWNER,
  });
  await MpesaExpressService.savePasskey(ORG, OWNER, PASSKEY);
  assert.equal((await (await publicApp.request(`/api/public/invoices/${token}`)).json()).pay.canRequestPayment, true);

  const asked = await publicApp.request(`/api/public/invoices/${token}/mpesa`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0712 345 678', amountCents: 100_000 }),
  });
  assert.equal(asked.status, 201);
  const request = await asked.json();
  assert.equal(request.status, 'SENT');
  assert.equal(pushes.at(-1).Amount, 1000);
  assert.equal(sql(`SELECT requested_by FROM public.mpesa_payment_requests WHERE id = '${request.id}'`), OWNER);

  // Safaricom's result settles part of the invoice; the page sees it.
  const stkToken = pushes.at(-1).CallBackURL.split('/').at(-1);
  await publicApp.request(`/api/public/payments/stk/${stkToken}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Body: { stkCallback: {
      MerchantRequestID: 'm-x', CheckoutRequestID: sql(`SELECT checkout_request_id FROM public.mpesa_payment_requests WHERE id = '${request.id}'`),
      ResultCode: 0, ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: { Item: [
        { Name: 'Amount', Value: 1000 }, { Name: 'MpesaReceiptNumber', Value: 'TLK3000001' },
        { Name: 'TransactionDate', Value: 20261024100000 }, { Name: 'PhoneNumber', Value: 254712345678 },
      ] },
    } } }),
  });
  const status = await (await publicApp.request(`/api/public/invoices/${token}/mpesa/${request.id}`)).json();
  assert.equal(status.status, 'PAID');
  assert.equal(status.amountDueCents, 200_000);

  // Withdrawn: the page says the link is no longer valid.
  assert.deepEqual(await (await api.request(`/invoices/${invoiceId}/share-link`, { method: 'DELETE' })).json(), { withdrawn: true });
  assert.equal((await publicApp.request(`/api/public/invoices/${token}`)).status, 404);
  assert.equal((await publicApp.request('/api/public/invoices/not-a-token')).status, 400);
});
