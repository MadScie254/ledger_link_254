// The Kundi church edition through its services and PostgREST: M-Pesa gifts
// arrive by C2B callback and statement upload, the giving rules place them,
// and what they cannot place waits in the treasurer's queue.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import { OrganizationService } from '../../src/server/organizations';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { assertChurchEdition } from '../../src/server/churchAccess';
import { readMpesaStatement, detectMpesaColumns } from '../../src/utils/mpesaStatement';
import confirmation from './fixtures/c2b-confirmation-1043.json';
import { ORG, OWNER, MEMBER, sql, refused } from './helpers';

let church = '';
let token = '';
const fund = (code: string) => sql(`SELECT id FROM public.funds WHERE org_id = '${church}' AND code = '${code}'`);
const balance = (code: string) => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l
  JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${church}' AND a.code = '${code}'`));

test('a church organization starts with its funds, giving rules and chart', async () => {
  church = await OrganizationService.createOrganization({ name: 'Kanisa la Majaribio', country: 'Kenya', edition: 'church' } as any, OWNER);
  await assertChurchEdition(church);
  await refused(assertChurchEdition(ORG), /Kundi church organizations/);
  assert.equal(sql(`SELECT string_agg(code, ',' ORDER BY code) FROM public.funds WHERE org_id = '${church}'`), 'BUILDING,GENERAL,MISSIONS,WELFARE');
  for (const code of ['1040', '1050', '4010', '4020', '6400']) {
    assert.ok(sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '${code}'`), `account ${code} seeded`);
  }
  // The read-only member who later appears in the register.
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${church}', '${MEMBER}', 'member')`);
  sql(`INSERT INTO public.members (org_id, member_number, first_name, last_name) VALUES
    ('${church}', '1043', 'Mfano', 'Mmoja'), ('${church}', '1044', 'Mfano', 'Wawili')`);
});

test('Daraja settings are kept for admins only, with the secret in Vault', async () => {
  await refused(MpesaC2bService.saveSettings(church, MEMBER, {
    shortcode: '600984', environment: 'SANDBOX', consumerKey: 'k', consumerSecret: 's', integrationActorId: OWNER,
  }), /owner or admin/);
  await MpesaC2bService.saveSettings(church, OWNER, {
    shortcode: '600984', environment: 'SANDBOX', consumerKey: 'test-key', consumerSecret: 'test-secret', integrationActorId: OWNER,
  });
  const settings = await MpesaC2bService.settings(church);
  assert.deepEqual(settings, {
    configured: true, shortcode: '600984', environment: 'SANDBOX', status: 'DRAFT', registeredAt: null, lastError: null,
    hasCredentials: true, hasCallbackUrls: false, integrationActorId: OWNER,
  });
  assert.ok(!JSON.stringify(settings).includes('test-secret'), 'the secret never comes back');
  assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE org_id = '${church}' AND details::text LIKE '%test-secret%'`), '0');
});

test('register sends the giving URLs to Daraja and keeps the old token when Safaricom refuses', async () => {
  const calls: Array<{ path: string; auth: string; body: any }> = [];
  let refuse = true;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({ path: req.url || '', auth: String(req.headers.authorization || ''), body: raw ? JSON.parse(raw) : null });
      res.setHeader('Content-Type', 'application/json');
      if ((req.url || '').startsWith('/oauth/v1/generate')) {
        res.end(JSON.stringify({ access_token: 'sandbox-access', expires_in: '3599' }));
      } else if (refuse) {
        res.statusCode = 400;
        res.end(JSON.stringify({ requestId: 'r-1', errorCode: '400.003.02', errorMessage: 'Bad Request - Invalid ConfirmationURL' }));
      } else {
        res.end(JSON.stringify({ OriginatorCoversationID: 'o-1', ResponseCode: '0', ResponseDescription: 'Success' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  process.env.DARAJA_SANDBOX_BASE_URL = `http://127.0.0.1:${port}`;
  try {
    const refused = await MpesaC2bService.register(church, OWNER, 'https://kundi.example.org');
    assert.deepEqual(refused, { registered: false, message: 'Safaricom did not register the URLs: Bad Request - Invalid ConfirmationURL' });
    assert.equal((await MpesaC2bService.settings(church)).hasCallbackUrls, false);

    refuse = false;
    const done = await MpesaC2bService.register(church, OWNER, 'https://kundi.example.org');
    assert.deepEqual(done, { registered: true, message: 'Success' });
    const register = calls.filter((call) => call.path === '/mpesa/c2b/v1/registerurl').at(-1)!;
    assert.equal(register.auth, 'Bearer sandbox-access');
    assert.equal(register.body.ShortCode, '600984');
    assert.equal(register.body.ResponseType, 'Completed');
    assert.match(register.body.ConfirmationURL, /^https:\/\/kundi\.example\.org\/api\/public\/giving\/c2b\/[0-9a-f]{64}\/confirmation$/);
    assert.equal(calls[0].auth, `Basic ${Buffer.from('test-key:test-secret').toString('base64')}`, 'the secret goes only to Daraja');
    const settings = await MpesaC2bService.settings(church);
    assert.equal(settings.status, 'REGISTERED');
    assert.equal(settings.lastError, null);
    // The registered token now finds the church.
    token = register.body.ConfirmationURL.split('/').at(-2);
    assert.equal((await MpesaC2bService.target(token))?.orgId, church);
  } finally {
    server.close();
    delete process.env.DARAJA_SANDBOX_BASE_URL;
  }
  // A church that registers by hand gets new URLs; the old token stops working.
  const issued = await MpesaC2bService.issueCallbackUrls(church, OWNER, 'https://kundi.example.org');
  assert.equal(await MpesaC2bService.target(token), null);
  token = issued.confirmationUrl.split('/').at(-2)!;
  assert.equal((await MpesaC2bService.target(token))?.orgId, church);
  await refused(MpesaC2bService.issueCallbackUrls(church, MEMBER, 'https://kundi.example.org'), /owner or admin/);
});

test('a replayed C2B confirmation with reference 1043 lands on member 1043 in GENERAL, once', async () => {
  assert.deepEqual(await MpesaC2bService.receiveConfirmation('0'.repeat(64), confirmation), { status: 'unknown-token' });
  assert.deepEqual(await MpesaC2bService.receiveConfirmation('not-a-token', confirmation), { status: 'unknown-token' });
  assert.equal((await MpesaC2bService.receiveConfirmation(token, { TransID: 'X' }) as any).status, 'unreadable');

  const outcome = await MpesaC2bService.receiveConfirmation(token, confirmation);
  assert.equal(outcome.status, 'kept');
  if (outcome.status !== 'kept') return;
  assert.equal(outcome.receipt.status, 'UNMATCHED', 'kept before anything posts');
  const result = await outcome.process();
  assert.equal(result.posted.length, 1);
  assert.equal(result.posted[0].explanation, 'Reference 1043: member 1043, General fund.');
  const posted = sql(`SELECT m.member_number || ':' || f.code || ':' || c.amount_cents || ':' || c.method
    FROM public.contributions c JOIN public.members m ON m.id = c.member_id JOIN public.funds f ON f.id = c.fund_id
    WHERE c.org_id = '${church}'`);
  assert.equal(posted, '1043:GENERAL:250000:MPESA');
  // The member-number rule credits tithes (4010), tagged to GENERAL.
  assert.equal(sql(`SELECT l.entity_id FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id
    WHERE l.org_id = '${church}' AND a.code = '4010'`), fund('GENERAL'));
  assert.equal(balance('1050'), 250_000);
  assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE org_id = '${church}' AND details->>'source' = 'MPESA_C2B'`), '2',
    'the receipt and its match are audited with source MPESA_C2B');

  // Safaricom sending the same confirmation again changes nothing.
  const repeat = await MpesaC2bService.receiveConfirmation(token, confirmation);
  assert.ok(repeat.status === 'kept' && !repeat.receipt.inserted && repeat.receipt.status === 'POSTED');
  if (repeat.status === 'kept') assert.deepEqual(await repeat.process(), { posted: [], queued: [] });
  assert.equal(sql(`SELECT count(*) FROM public.contributions WHERE org_id = '${church}'`), '1');
  assert.equal(balance('1050'), 250_000);
});

test('a reference the rules cannot place waits in the queue with the reason', async () => {
  const outcome = await MpesaC2bService.receiveConfirmation(token, { ...confirmation, TransID: 'TJA1B2C3D5', BillRefNumber: 'harambee' });
  assert.equal(outcome.status, 'kept');
  if (outcome.status !== 'kept') return;
  assert.deepEqual((await outcome.process()).queued.map((item) => item.reason), ['No giving rule fits reference HARAMBEE.']);
  assert.equal(sql(`SELECT status FROM public.mpesa_receipts WHERE org_id = '${church}' AND trans_id = 'TJA1B2C3D5'`), 'UNMATCHED');

  // With no one named to post in, even a sure match waits.
  sql(`UPDATE public.organizations SET integration_actor_id = NULL WHERE id = '${church}'`);
  const unattended = await MpesaC2bService.receiveConfirmation(token, { ...confirmation, TransID: 'TJA1B2C3D6', BillRefNumber: '1044' });
  if (unattended.status !== 'kept') throw new Error('not kept');
  assert.match((await unattended.process()).queued[0].reason, /No one is named to post M-Pesa giving/);
  sql(`UPDATE public.organizations SET integration_actor_id = '${OWNER}' WHERE id = '${church}'`);
});

test('an uploaded M-Pesa statement places gifts once and posts its charges once', async () => {
  const rows = [
    ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Reason Type', 'Other Party Info', 'A/C No.'],
    ['TJA1B2C3D4', '04-10-2026 09:15:22', 'Pay Bill from 2547***126 - MFANO', 'Completed', '2,500.00', '', 'Pay Bill', '2547***126 - MFANO', '1043'],
    ['TJB0000001', '05-10-2026 10:00:00', 'Pay Bill', 'Completed', '1,000.00', '', 'Pay Bill', '2547***111 - MFANO WAWILI', 'BLD 1044'],
    ['TJB0000002', '05-10-2026 10:00:00', 'Pay Bill Charge', 'Completed', '', '-10.00', 'Pay Bill Charge', '', ''],
    ['TJB0000003', '06-10-2026 11:00:00', 'Pay Bill', 'Completed', '300.00', '', 'Pay Bill', '2547***222 - MGENI', 'school'],
  ];
  const { headerRow, mapping } = detectMpesaColumns(rows);
  const read = readMpesaStatement(rows, headerRow, mapping!);
  await refused(MpesaC2bService.uploadStatement(church, MEMBER, read), /owner, administrator or accountant/);

  const first = await MpesaC2bService.uploadStatement(church, OWNER, read);
  assert.equal(first.lines, 3);
  assert.equal(first.newReceipts, 2, 'the callback already kept TJA1B2C3D4');
  assert.deepEqual(first.posted.map((item) => item.transId), ['TJB0000001']);
  assert.deepEqual(first.queued.map((item) => item.transId), ['TJB0000003']);
  assert.deepEqual(first.charges, { journalEntryId: first.charges.journalEntryId, charges: 1, amountCents: 1_000, alreadyRecorded: 0 });
  assert.equal(sql(`SELECT f.code FROM public.contributions c JOIN public.funds f ON f.id = c.fund_id
    JOIN public.mpesa_receipts r ON r.id = c.mpesa_receipt_id WHERE r.trans_id = 'TJB0000001'`), 'BUILDING');

  const again = await MpesaC2bService.uploadStatement(church, OWNER, read);
  assert.equal(again.newReceipts, 0);
  assert.equal(again.posted.length, 0);
  assert.equal(again.charges.journalEntryId, null);
  assert.equal(balance('6400'), 1_000);
  assert.equal(balance('1050'), 250_000 + 100_000 - 1_000);
  // The ledger still balances.
  assert.equal(Number(sql(`SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = '${church}'`)), 0);
});
