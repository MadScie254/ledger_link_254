import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents, C2B_ACCEPTED, callbackUrls, constantTimeEqual, darajaTimeToIso, forbiddenUrlWords, parseC2bConfirmation,
} from './mpesaC2b.ts';

// The shape of the published Daraja C2B confirmation sample.
const confirmation = {
  TransactionType: 'Pay Bill',
  TransID: 'SJK3H2K9QX',
  TransTime: '20261004081522',
  TransAmount: '1500.00',
  BusinessShortCode: '600984',
  BillRefNumber: '1043',
  InvoiceNumber: '',
  OrgAccountBalance: '49197.00',
  ThirdPartyTransID: '',
  MSISDN: '2547 ***** 126',
  FirstName: 'AMINA',
  MiddleName: '',
  LastName: 'W',
};

test('a confirmation becomes a receipt in Nairobi time and cents', () => {
  const parsed = parseC2bConfirmation(confirmation);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.receipt, {
    transId: 'SJK3H2K9QX', transTime: '2026-10-04T08:15:22+03:00', amountCents: 150_000, billRefNumber: '1043',
    msisdn: '2547 ***** 126', firstName: 'AMINA W', shortcode: '600984', transactionType: 'Pay Bill',
  });
  assert.equal(new Date(parsed.receipt.transTime).toISOString(), '2026-10-04T05:15:22.000Z');
});

test('a confirmation that cannot be a payment is refused with the field named', () => {
  assert.deepEqual(parseC2bConfirmation(null), { ok: false, reason: 'The body is not a JSON object.' });
  assert.deepEqual(parseC2bConfirmation([confirmation]), { ok: false, reason: 'The body is not a JSON object.' });
  assert.match((parseC2bConfirmation({ ...confirmation, TransID: 'x' }) as any).reason, /TransID/);
  assert.match((parseC2bConfirmation({ ...confirmation, TransTime: '2026-10-04' }) as any).reason, /TransTime/);
  assert.match((parseC2bConfirmation({ ...confirmation, TransAmount: '-5' }) as any).reason, /TransAmount/);
  assert.match((parseC2bConfirmation({ ...confirmation, TransAmount: '0' }) as any).reason, /TransAmount/);
  const blank = parseC2bConfirmation({ ...confirmation, BillRefNumber: '  ', FirstName: '', LastName: '' });
  assert.ok(blank.ok && blank.receipt.billRefNumber === null && blank.receipt.firstName === null);
});

test('Daraja times and amounts are read exactly', () => {
  assert.equal(darajaTimeToIso('20261231235959'), '2026-12-31T23:59:59+03:00');
  assert.equal(darajaTimeToIso('20260230120000'), null, 'no 30 February');
  assert.equal(darajaTimeToIso('20261004246000'), null);
  assert.equal(darajaTimeToIso(20261004081522), '2026-10-04T08:15:22+03:00');
  assert.equal(amountToCents('10'), 1000);
  assert.equal(amountToCents(10.5), 1050);
  assert.equal(amountToCents('1,000.05'), 100_005);
  assert.equal(amountToCents('0.001'), null);
  assert.equal(amountToCents('abc'), null);
  assert.equal(amountToCents(''), null);
});

test('tokens compare in full, whatever the length', () => {
  const token = 'ab'.repeat(32);
  assert.equal(constantTimeEqual(token, token), true);
  assert.equal(constantTimeEqual(token, 'ab'.repeat(31) + 'ac'), false);
  assert.equal(constantTimeEqual(token, token.slice(0, 63)), false);
  assert.equal(constantTimeEqual('', ''), true);
});

test('the registered URLs avoid the words Daraja refuses', () => {
  const urls = callbackUrls('https://app.example.org/', 'ab'.repeat(32));
  assert.equal(urls.confirmationUrl, `https://app.example.org/api/public/giving/c2b/${'ab'.repeat(32)}/confirmation`);
  assert.deepEqual(forbiddenUrlWords(urls.confirmationUrl), []);
  assert.deepEqual(forbiddenUrlWords(urls.validationUrl), []);
  assert.deepEqual(forbiddenUrlWords('https://x.org/api/public/mpesa/c2b'), ['mpesa']);
  assert.deepEqual(forbiddenUrlWords('https://safaricom-exec.example/'), ['safaricom', 'exec']);
  assert.deepEqual(C2B_ACCEPTED, { ResultCode: '0', ResultDesc: 'Accepted' });
});
