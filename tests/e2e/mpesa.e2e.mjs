// Live M-Pesa for a business, from its screens against the real Worker: the
// paybill is linked in Settings, an invoice asks the customer's phone to
// pay, and Safaricom's result (sent here by hand, as Daraja would) settles
// the invoice. A stand-in for Daraja listens on DARAJA_STUB_PORT, which
// run.sh gives the Worker as DARAJA_SANDBOX_BASE_URL.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createServer } from 'node:http';
import { signedIn, openView, refusedWrites, closeBrowser, sql, flow, BASE } from './helpers.mjs';

const ORG = '00000000-0000-0000-0000-0000000000aa';
const OWNER = '00000000-0000-0000-0000-000000000001';
const pushes = [];
let stub;

before(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if ((req.url || '').startsWith('/oauth/v1/generate')) {
        res.end(JSON.stringify({ access_token: 'stub-access', expires_in: '3599' }));
        return;
      }
      pushes.push(JSON.parse(raw));
      res.end(JSON.stringify({
        MerchantRequestID: `m-${pushes.length}`, CheckoutRequestID: `ws_CO_E2E${pushes.length}`, ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing', CustomerMessage: 'Success. Request accepted for processing',
      }));
    });
  });
  await new Promise((resolve) => stub.listen(Number(process.env.DARAJA_STUB_PORT || 5191), '127.0.0.1', resolve));
});
after(async () => {
  stub?.close();
  await closeBrowser();
});

test('a business links its paybill, and an invoice asks the customer\'s phone to pay', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('mpesa-request', session, async () => {
    const invoice = sql(`SELECT public.create_invoice_with_journal('${ORG}', '00000000-0000-0000-0000-0000000000c1',
      current_date, current_date + 30, 'KES', 1, NULL, '${OWNER}',
      jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', '00000000-0000-0000-0000-00000000a400', 'amountCents', 250000)),
      'e2e-mpesa-invoice')`);
    const number = sql(`SELECT invoice_number FROM public.invoices WHERE id = '${invoice}'`);

    // Integrations names M-Pesa as built and opens its settings.
    await openView(page, 'Integrations');
    await page.getByRole('button', { name: 'Set up' }).click();
    await page.getByRole('heading', { name: 'M-Pesa payments' }).waitFor();
    await page.getByLabel('Paybill or till number').fill('174379');
    await page.getByLabel('Consumer key').fill('e2e-key');
    await page.getByLabel('Consumer secret').fill('e2e-secret');
    await page.getByLabel('Payments land in').selectOption({ label: '1050 · M-Pesa Till' });
    await page.getByLabel('Settle invoices in the name of').selectOption({ label: 'owner@example.com (owner)' });
    await page.getByRole('button', { name: 'Save M-Pesa settings' }).click();
    await page.getByText('M-Pesa settings saved. The consumer key and secret are in Vault.').waitFor();
    await page.getByLabel('M-Pesa Express passkey').fill('e2epasskey123');
    await page.getByRole('button', { name: 'Save passkey' }).click();
    await page.getByText(/Passkey saved in Vault/).waitFor();
    assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE details::text LIKE '%e2epasskey123%' OR details::text LIKE '%e2e-secret%'`), '0');

    // The invoice asks for payment.
    await openView(page, 'Sales & customers');
    const row = page.getByRole('row').filter({ hasText: number });
    await row.getByRole('button', { name: 'Ask by M-Pesa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask for payment by M-Pesa' });
    await dialog.getByLabel('Customer\'s Safaricom number').fill('0712 345 678');
    assert.equal(await dialog.getByLabel('Amount (KES, whole shillings)').inputValue(), '2500');
    await dialog.getByRole('button', { name: 'Send to the phone' }).click();
    await dialog.getByText('waiting for the customer to enter their PIN.').waitFor({ timeout: 10_000 });
    const push = pushes.at(-1);
    assert.equal(push.Amount, 2500);
    assert.equal(push.PhoneNumber, 254712345678);
    assert.equal(push.AccountReference, number.replace(/[^A-Za-z0-9]/g, '').toUpperCase());

    // Safaricom's result, at the URL the push named.
    const result = await fetch(new URL(new URL(push.CallBackURL).pathname, BASE), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Body: { stkCallback: {
        MerchantRequestID: `m-${pushes.length}`, CheckoutRequestID: `ws_CO_E2E${pushes.length}`, ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: { Item: [
          { Name: 'Amount', Value: 2500 }, { Name: 'MpesaReceiptNumber', Value: 'TKE2E00001' },
          { Name: 'TransactionDate', Value: 20261022100000 }, { Name: 'PhoneNumber', Value: 254712345678 },
        ] },
      } } }),
    });
    assert.equal(result.status, 200);
    await dialog.getByText(/paid, receipt TKE2E00001, invoice settled\./).waitFor({ timeout: 15_000 });
    await dialog.getByText('Nothing is left to ask for on this invoice.').waitFor({ timeout: 10_000 });
    assert.equal(await dialog.getByRole('button', { name: 'Send to the phone' }).isDisabled(), true);
    assert.equal(sql(`SELECT status || ' ' || amount_due_cents FROM public.invoices WHERE id = '${invoice}'`), 'PAID 0');
    assert.equal(sql(`SELECT status FROM public.bank_transactions WHERE org_id = '${ORG}' AND reference = 'TKE2E00001'`), 'MATCHED');
    assert.deepEqual(refusedWrites(api), []);
    assert.deepEqual(problems, []);
  });
});
