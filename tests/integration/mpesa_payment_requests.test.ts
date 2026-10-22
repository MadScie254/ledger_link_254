// Pay with M-Pesa through the services, the Worker's routes and PostgREST,
// with a stand-in for Daraja: an invoice asks the customer's phone to pay,
// and Safaricom's result settles the invoice in the name of the person who
// asked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import { Hono } from 'hono';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { MpesaExpressService } from '../../src/server/mpesaExpress';
import { InvoiceService } from '../../src/server/invoices';
import { OrganizationService } from '../../src/server/organizations';
import { STK_ACCEPTED } from '../../src/utils/mpesaExpress';
import { registerMpesaPublicRoutes, registerMpesaRoutes } from '../../worker/routes/mpesa';
import { CUSTOMER, ORG, OWNER, SALES, refused, sql, uuid } from './helpers';

const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
let invoiceId = '';
let invoiceNumber = '';
let server: Server;
const calls: Array<{ path: string; auth: string; body: any }> = [];
let refusePush = false;

const publicApp = new Hono<any>();
registerMpesaPublicRoutes(publicApp);
function api(orgId: string, role = 'owner') {
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('orgId', orgId); c.set('userId', OWNER); c.set('orgRole', role); await next(); });
  registerMpesaRoutes(app);
  return app;
}
const due = async () => (await InvoiceService.getInvoices(ORG)).find((invoice) => invoice.id === invoiceId)!;

test.before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({ path: req.url || '', auth: String(req.headers.authorization || ''), body: raw ? JSON.parse(raw) : null });
      res.setHeader('Content-Type', 'application/json');
      if ((req.url || '').startsWith('/oauth/v1/generate')) {
        res.end(JSON.stringify({ access_token: 'sandbox-access', expires_in: '3599' }));
      } else if (refusePush) {
        res.statusCode = 400;
        res.end(JSON.stringify({ requestId: 'r-2', errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PhoneNumber' }));
      } else {
        res.end(JSON.stringify({
          MerchantRequestID: `m-${calls.length}`, CheckoutRequestID: `ws_CO_TEST${calls.length}`, ResponseCode: '0',
          ResponseDescription: 'Success. Request accepted for processing', CustomerMessage: 'Success. Request accepted for processing',
        }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.DARAJA_SANDBOX_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.after(() => {
  server.close();
  delete process.env.DARAJA_SANDBOX_BASE_URL;
});

test('the passkey is saved by an owner and the settings say so, never what it is', async () => {
  sql(`INSERT INTO public.accounts (org_id, code, name, type, is_bank_account) VALUES ('${ORG}', '1050', 'M-Pesa', 'ASSET', true)`);
  await MpesaC2bService.saveSettings(ORG, OWNER, {
    shortcode: '174379', environment: 'SANDBOX', consumerKey: 'test-key', consumerSecret: 'test-secret', integrationActorId: OWNER,
  });
  const member = await api(ORG, 'member').request('/integrations/mpesa/express', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passkey: PASSKEY }),
  });
  assert.equal(member.status, 403);
  const saved = await api(ORG).request('/integrations/mpesa/express', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passkey: PASSKEY }),
  });
  assert.equal(saved.status, 200);
  const settings = await saved.json();
  assert.equal(settings.hasExpressPasskey, true);
  assert.ok(!JSON.stringify(settings).includes(PASSKEY));
});

test('an invoice asks the customer\'s phone for whole shillings, against its number', async () => {
  invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 400_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  invoiceNumber = (await due()).invoiceNumber;
  const response = await api(ORG).request(`/invoices/${invoiceId}/mpesa-request`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '0712 345 678', amountCents: 150_000 }),
  });
  assert.equal(response.status, 201);
  const sent = await response.json();
  assert.equal(sent.status, 'SENT');
  assert.equal(sent.phone, '0712 *** 678');

  const push = calls.filter((call) => call.path === '/mpesa/stkpush/v1/processrequest').at(-1)!;
  assert.equal(push.auth, 'Bearer sandbox-access');
  assert.equal(push.body.BusinessShortCode, 174379);
  assert.equal(push.body.TransactionType, 'CustomerPayBillOnline');
  assert.equal(push.body.Amount, 1500);
  assert.equal(push.body.PhoneNumber, 254712345678);
  assert.equal(push.body.AccountReference, invoiceNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
  assert.equal(push.body.Password, Buffer.from(`174379${PASSKEY}${push.body.Timestamp}`).toString('base64'));
  assert.match(push.body.CallBackURL, /^http:\/\/localhost\/api\/public\/payments\/stk\/[0-9a-f]{64}$/);
  assert.equal(calls[0].auth, `Basic ${Buffer.from('test-key:test-secret').toString('base64')}`);

  // Safaricom's result at the URL that names the request settles the invoice.
  const token = push.body.CallBackURL.split('/').at(-1);
  const result = await publicApp.request(`/api/public/payments/stk/${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Body: { stkCallback: {
      MerchantRequestID: 'm-x', CheckoutRequestID: sql(`SELECT checkout_request_id FROM public.mpesa_payment_requests WHERE id = '${sent.id}'`),
      ResultCode: 0, ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: { Item: [
        { Name: 'Amount', Value: 1500 }, { Name: 'MpesaReceiptNumber', Value: 'TKS2000001' },
        { Name: 'TransactionDate', Value: 20261022100000 }, { Name: 'PhoneNumber', Value: 254712345678 },
      ] },
    } } }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), STK_ACCEPTED);
  assert.equal((await due()).amountDueCents, 250_000);
  const [request] = await MpesaExpressService.requestsFor(ORG, invoiceId);
  assert.equal(request.status, 'PAID');
  assert.deepEqual(request.settlement, { outcome: 'SETTLED', note: null, transId: 'TKS2000001' });
  const listed = await api(ORG).request(`/invoices/${invoiceId}/mpesa-requests`);
  assert.equal((await listed.json()).requests[0].status, 'PAID');

  // Safaricom sending the result again changes nothing.
  await publicApp.request(`/api/public/payments/stk/${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_TEST2', ResultCode: 0, CallbackMetadata: { Item: [
      { Name: 'Amount', Value: 1500 }, { Name: 'MpesaReceiptNumber', Value: 'TKS2000001' }, { Name: 'TransactionDate', Value: 20261022100000 },
    ] } } } }),
  });
  assert.equal((await due()).amountDueCents, 250_000);
});

test('a push Safaricom refuses is kept with its words, and nothing changes', async () => {
  refusePush = true;
  try {
    const refusedPush = await MpesaExpressService.requestPayment(ORG, invoiceId, { phone: '0712345678', amountCents: 10_000 }, OWNER, 'https://books.example.co.ke');
    assert.equal(refusedPush.status, 'FAILED');
    assert.equal(refusedPush.message, 'Safaricom did not send the request: Bad Request - Invalid PhoneNumber');
  } finally {
    refusePush = false;
  }
  assert.equal((await due()).amountDueCents, 250_000);
  await refused(MpesaExpressService.requestPayment(ORG, invoiceId, { phone: '020 2345678', amountCents: 10_000 }, OWNER, 'https://x.example'), /Safaricom number/);
  await refused(MpesaExpressService.requestPayment(ORG, invoiceId, { phone: '0712345678', amountCents: 300_000 }, OWNER, 'https://x.example'), /no more than/);
  const unknown = await publicApp.request(`/api/public/payments/stk/${'0'.repeat(64)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_1', ResultCode: 1032 } } }),
  });
  assert.equal(unknown.status, 404);
});

test('a church cannot send payment requests', async () => {
  const church = await OrganizationService.createOrganization({ name: 'Kanisa la Ombi', country: 'Kenya', edition: 'church' } as any, OWNER);
  const response = await api(church).request(`/invoices/${uuid()}/mpesa-request`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0712345678', amountCents: 100 }),
  });
  assert.equal(response.status, 403);
});
