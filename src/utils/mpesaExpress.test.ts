import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  darajaTimestamp, maskPhone, normalizeKenyanPhone, parseStkCallback, stkCallbackUrl, stkPassword, stkPushBody,
} from './mpesaExpress.ts';
import { forbiddenUrlWords } from './mpesaC2b.ts';

test('Kenyan mobile numbers become the form Daraja takes, and nothing else does', () => {
  assert.equal(normalizeKenyanPhone('0712 345 678'), '254712345678');
  assert.equal(normalizeKenyanPhone('+254 712-345-678'), '254712345678');
  assert.equal(normalizeKenyanPhone('712345678'), '254712345678');
  assert.equal(normalizeKenyanPhone('0110 123 456'), '254110123456');
  assert.equal(normalizeKenyanPhone('254712345678'), '254712345678');
  assert.equal(normalizeKenyanPhone('020 2345678'), null, 'a landline');
  assert.equal(normalizeKenyanPhone('07123'), null);
  assert.equal(normalizeKenyanPhone('+1 415 555 0100'), null);
  assert.equal(normalizeKenyanPhone(''), null);
  assert.equal(maskPhone('254712345678'), '0712 *** 678');
});

test('the timestamp is Nairobi time and the password is the published formula', () => {
  assert.equal(darajaTimestamp(new Date('2026-10-22T21:05:09Z')), '20261023000509');
  // Daraja's sandbox sample: shortcode 174379, its published passkey, and a timestamp.
  const passkey = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
  assert.equal(stkPassword('174379', passkey, '20160216165627'),
    Buffer.from(`174379${passkey}20160216165627`).toString('base64'));
});

test('a push asks for whole shillings against the invoice number', () => {
  const body = stkPushBody({
    shortcode: '174379', passkey: 'key', timestamp: '20261023000509', amountCents: 150_000,
    phone: '254712345678', callbackUrl: 'https://books.example.co.ke/api/public/payments/stk/abc', accountReference: 'INV202600042',
  });
  assert.deepEqual(body, {
    BusinessShortCode: 174379, Password: Buffer.from('174379key20261023000509').toString('base64'), Timestamp: '20261023000509',
    TransactionType: 'CustomerPayBillOnline', Amount: 1500, PartyA: 254712345678, PartyB: 174379, PhoneNumber: 254712345678,
    CallBackURL: 'https://books.example.co.ke/api/public/payments/stk/abc', AccountReference: 'INV202600042', TransactionDesc: 'Invoice',
  });
  assert.throws(() => stkPushBody({ ...base(), amountCents: 150_050 }), /whole shillings/);
  assert.throws(() => stkPushBody({ ...base(), accountReference: 'INV-2026-00042' }), /12 letters and digits/);
  assert.throws(() => stkPushBody({ ...base(), phone: '0712345678' }), /Safaricom number/);
  assert.deepEqual(forbiddenUrlWords(stkCallbackUrl('https://books.example.co.ke/', 'ab'.repeat(32))), []);
});

function base() {
  return { shortcode: '174379', passkey: 'k', timestamp: '20261023000509', amountCents: 100, phone: '254712345678', callbackUrl: 'https://x.example/', accountReference: 'INV1' };
}

// The shape of Daraja's published STK callback samples.
const paid = {
  Body: { stkCallback: {
    MerchantRequestID: '29115-34620561-1', CheckoutRequestID: 'ws_CO_191220191020363925', ResultCode: 0,
    ResultDesc: 'The service request is processed successfully.',
    CallbackMetadata: { Item: [
      { Name: 'Amount', Value: 1500.0 }, { Name: 'MpesaReceiptNumber', Value: 'nlj7rt61sv' }, { Name: 'Balance' },
      { Name: 'TransactionDate', Value: 20261023000509 }, { Name: 'PhoneNumber', Value: 254712345678 },
    ] },
  } },
};

test('a paid result carries the receipt in cents and Nairobi time', () => {
  const parsed = parseStkCallback(paid);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.result, {
    checkoutRequestId: 'ws_CO_191220191020363925', merchantRequestId: '29115-34620561-1', resultCode: '0',
    resultDesc: 'The service request is processed successfully.',
    payment: { transId: 'NLJ7RT61SV', transTime: '2026-10-23T00:05:09+03:00', amountCents: 150_000, msisdn: '254712345678' },
  });
});

test('a cancelled result carries no receipt, and a broken one is refused', () => {
  const cancelled = parseStkCallback({ Body: { stkCallback: {
    MerchantRequestID: 'm-1', CheckoutRequestID: 'ws_CO_2', ResultCode: 1032, ResultDesc: 'Request cancelled by user',
  } } });
  assert.ok(cancelled.ok);
  assert.equal(cancelled.result.resultCode, '1032');
  assert.equal(cancelled.result.payment, null);
  assert.equal(parseStkCallback({}).ok, false);
  assert.equal(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_3' } } }).ok, false);
  const noReceipt = structuredClone(paid);
  noReceipt.Body.stkCallback.CallbackMetadata.Item = noReceipt.Body.stkCallback.CallbackMetadata.Item.filter((entry) => entry.Name !== 'MpesaReceiptNumber');
  assert.match((parseStkCallback(noReceipt) as any).reason, /MpesaReceiptNumber/);
});
