// The Kundi church edition through its services and PostgREST: M-Pesa gifts
// arrive by C2B callback and statement upload, the giving rules place them,
// and what they cannot place waits in the treasurer's queue.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import { OrganizationService } from '../../src/server/organizations';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { assertChurchEdition } from '../../src/server/churchAccess';
import { MembersService } from '../../src/server/members';
import { FundsService } from '../../src/server/funds';
import { GivingService } from '../../src/server/giving';
import { CollectionsService } from '../../src/server/collections';
import { ChurchReportService } from '../../src/server/churchReports';
import { CashTransactionService } from '../../src/server/cashTransactions';
import { runWithRequestContext } from '../../src/server/requestContext';
import { readMpesaStatement, detectMpesaColumns } from '../../src/utils/mpesaStatement';
import { detectMemberColumns, readMembers } from '../../src/utils/memberImport';
import { countTotalCents } from '../../src/utils/cashCount';
import confirmation from './fixtures/c2b-confirmation-1043.json';
import { ORG, OWNER, MEMBER, sql, uuid, refused } from './helpers';

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

test('the register takes members one at a time and fifty from a CSV, with consent for contact details', async () => {
  await refused(MembersService.create(church, OWNER, { memberNumber: '3001', firstName: 'Simu', phone: '0700000301' }), /needs the member's consent/);
  const id = await MembersService.create(church, OWNER, {
    memberNumber: 'k-3001', firstName: 'Simu', lastName: 'Mfano', phone: '0700000301', consentMethod: 'Signed form',
  });
  const record = await MembersService.get(church, id);
  assert.equal(record.member.member_number, 'K-3001', 'member numbers are kept upper case');
  assert.ok(record.member.consent_given_at, 'consent is dated');
  await refused(MembersService.create(church, OWNER, { memberNumber: 'K-3001', firstName: 'Rudia' }), /already in the register/);
  await MembersService.update(church, id, { phone: null });
  assert.equal((await MembersService.get(church, id)).member.consent_method, null, 'no contact details, no consent kept');

  // Fifty members from a CSV, in households.
  const header = ['Member No', 'First name', 'Surname', 'Phone', 'Consent', 'Status', 'Household'];
  const rows = [header, ...Array.from({ length: 50 }, (_, i) => [
    String(5001 + i), `Mshiriki${i + 1}`, 'Mfano', i % 2 ? '' : `07000${String(i).padStart(5, '0')}`, i % 2 ? '' : 'Signed form',
    i % 10 === 0 ? 'Visitor' : 'Member', `Nyumba ${Math.floor(i / 5) + 1}`,
  ])];
  const existing = new Set((await MembersService.list(church)).map((m: any) => m.member_number));
  const read = readMembers(rows, detectMemberColumns(header), existing);
  assert.equal(read.members.length, 50);
  assert.deepEqual(read.problems, []);
  const result = await MembersService.importMany(church, OWNER, read.members);
  assert.deepEqual(result, { imported: 50, householdsCreated: 10 });
  assert.equal((await MembersService.list(church, { search: 'Mshiriki' })).length, 50);
  assert.equal((await MembersService.list(church, { status: 'VISITOR' })).length, 5);
  const households = await MembersService.households(church);
  assert.equal(households.find((h: any) => h.name === 'Nyumba 1')?.memberCount, 5);
  await refused(MembersService.importMany(church, OWNER, read.members.slice(0, 1)), /Already in the register: 5001/);

  // The plan's member limit is named when reached.
  sql(`UPDATE public.plans SET max_members = 10 WHERE id = (SELECT plan_id FROM public.organization_subscriptions WHERE org_id = '${church}')`);
  await refused(MembersService.create(church, OWNER, { memberNumber: '9999', firstName: 'Mwingine' }), /plan includes 10 members/);
  sql(`UPDATE public.plans SET max_members = NULL WHERE id = (SELECT plan_id FROM public.organization_subscriptions WHERE org_id = '${church}')`);
});

test('funds and giving rules are kept by the treasurer; the general fund stays open', async () => {
  const youth = await FundsService.create(church, { code: 'youth', name: 'Youth fund', restricted: true,
    incomeAccountId: sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '4030'`) });
  await refused(FundsService.create(church, { code: 'YOUTH', name: 'Again', restricted: false,
    incomeAccountId: sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '4030'`) }), /already has a fund coded YOUTH/);
  await refused(FundsService.create(church, { code: 'BAD', name: 'Wrong account', restricted: false,
    incomeAccountId: sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '1000'`) }), /active income account/);
  await refused(FundsService.update(church, fund('GENERAL'), { isActive: false }), /general fund stays open/);
  const rule = await FundsService.createRule(church, { priority: 40, matchType: 'PREFIX', pattern: 'yth', fundId: youth });
  assert.equal((await FundsService.rules(church)).find((r: any) => r.id === rule)?.pattern, 'YTH');
  // The new rule places a gift at once.
  const outcome = await MpesaC2bService.receiveConfirmation(token, { ...confirmation, TransID: 'TJC0000001', BillRefNumber: 'YTH-1044', TransAmount: '700' });
  if (outcome.status !== 'kept') throw new Error('not kept');
  assert.equal((await outcome.process()).posted[0].explanation, 'Reference YTH-1044: member 1044, Youth fund.');
});

test('the queue shows why a receipt waits, takes an assignment, and sets aside what is not giving', async () => {
  const queue = await GivingService.queue(church);
  const harambee = queue.waiting.find((item: any) => item.transId === 'TJA1B2C3D5')!;
  assert.equal(harambee.reason, 'No giving rule fits reference HARAMBEE.');
  const forMember = queue.waiting.find((item: any) => item.transId === 'TJA1B2C3D6')!;
  assert.equal(forMember.suggestedMemberId, sql(`SELECT id FROM public.members WHERE org_id = '${church}' AND member_number = '1044'`));
  assert.ok(queue.waiting.some((item: any) => item.transId === 'TJB0000003'));

  const member1043 = sql(`SELECT id FROM public.members WHERE org_id = '${church}' AND member_number = '1043'`);
  const posted = await GivingService.assign(church, OWNER, harambee.id, { memberId: member1043, fundId: fund('BUILDING') });
  assert.ok(posted.journalEntryId);
  await refused(GivingService.assign(church, OWNER, harambee.id, { memberId: member1043, fundId: fund('BUILDING') }), /already posted/);
  await GivingService.assign(church, OWNER, forMember.id, { memberId: forMember.suggestedMemberId, fundId: fund('GENERAL') });

  const school = queue.waiting.find((item: any) => item.transId === 'TJB0000003')!;
  await refused(GivingService.ignore(church, OWNER, school.id, 'no'), /Say why/);
  await GivingService.ignore(church, OWNER, school.id, 'School fees paid to the church paybill by mistake');
  let after = await GivingService.queue(church);
  assert.equal(after.waiting.length, 0);
  assert.deepEqual(after.setAside.map((item: any) => item.reason), ['School fees paid to the church paybill by mistake']);
  await GivingService.restore(church, OWNER, school.id);
  after = await GivingService.queue(church);
  assert.equal(after.waiting.length, 1);
  await GivingService.ignore(church, OWNER, school.id, 'School fees paid to the church paybill by mistake');
});

test('a Sunday cash count needs two people, and banking it short by KES 100 posts the shortfall', async () => {
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${church}', '00000000-0000-0000-0000-000000000004', 'accountant')
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'accountant'`);
  const second = '00000000-0000-0000-0000-000000000004';
  const counts = { 1000: 12, 500: 3, 100: 1 };
  const total = countTotalCents(counts);
  assert.equal(total, 1_360_000);
  const started = await CollectionsService.start(church, OWNER, {
    serviceDate: '2026-10-04', serviceName: 'Main service', counts, totalCents: total, fundId: fund('GENERAL'), idempotencyKey: uuid(),
  });
  assert.match(started.number, /^COL-2026-\d{4}$/);
  await refused(CollectionsService.confirm(church, OWNER, started.id, { counts, idempotencyKey: uuid() }), /second person|first count|counted it/i);
  await refused(CollectionsService.confirm(church, second, started.id, { counts: { ...counts, 100: 2 }, idempotencyKey: uuid() }),
    /KES 13,600.00.*KES 13,500.00|KES 13,500.00.*KES 13,600.00|13,600|differ/);
  assert.equal(balance('1040'), 0, 'nothing posts until the counts agree');
  await CollectionsService.confirm(church, second, started.id, { counts, idempotencyKey: uuid() });
  assert.equal(balance('1040'), 1_360_000);

  const bank = sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '1000'`);
  const banked = await CollectionsService.bank(church, OWNER, started.id, {
    bankedCents: 1_350_000, bankedOn: '2026-10-05', bankAccountId: bank, bankReference: 'DEP-1', idempotencyKey: uuid(),
  });
  assert.equal(banked.varianceCents, -10_000);
  assert.equal(balance('1040'), 0);
  assert.equal(balance('1000'), 1_350_000);
  assert.equal((await CollectionsService.list(church, { status: 'BANKED' })).length, 1);
});

test('gifts by bank or cheque post to their fund, and Bills and expenses post to the fund chosen', async () => {
  await GivingService.recordGift(church, OWNER, {
    memberId: null, fundId: fund('MISSIONS'), amountCents: 500_000, method: 'CHEQUE', receivedOn: '2026-10-04', idempotencyKey: uuid(),
  });
  const day = await GivingService.day(church, '2026-10-04');
  assert.equal(day.byMethod.CHEQUE, 500_000);
  assert.equal(day.byMethod.CASH, 1_360_000);
  assert.ok(day.byFund.some((f: any) => f.code === 'MISSIONS' && f.cents === 500_000));

  const vendor = sql(`INSERT INTO public.vendors (org_id, display_name) VALUES ('${church}', 'Mfano Hardware') RETURNING id`);
  await runWithRequestContext({ actorId: OWNER, fundId: fund('BUILDING') }, () => CashTransactionService.recordExpense({
    orgId: church, vendorId: vendor, date: '2026-10-06', paidFromAccountId: sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '1000'`),
    lines: [{ description: 'Roofing sheets', accountId: sql(`SELECT id FROM public.accounts WHERE org_id = '${church}' AND code = '6310'`), amountCents: 300_000 }],
    actor: OWNER, idempotencyKey: uuid(),
  } as any));
  const balances = await ChurchReportService.fundBalances(church, '2026-10-01', '2026-10-31');
  assert.equal(balances.funds.find((f) => f.code === 'BUILDING')?.expenseCents, 300_000);
});

test("the treasurer's report and fund balances add up and reconcile to the trial balance", async () => {
  const report = await ChurchReportService.treasurer(church, '2026-10');
  assert.equal(report.from, '2026-10-01');
  assert.equal(report.to, '2026-10-31');
  const income = Number(sql(`SELECT COALESCE(sum(l.credit - l.debit), 0) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id
    JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE a.org_id = '${church}' AND a.type = 'INCOME' AND e.entry_date BETWEEN '2026-10-01' AND '2026-10-31'`));
  const spent = Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id
    JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE a.org_id = '${church}' AND a.type IN ('EXPENSE','COGS') AND e.entry_date BETWEEN '2026-10-01' AND '2026-10-31'`));
  assert.equal(report.incomeCents, income);
  assert.equal(report.expenseCents, spent);
  assert.equal(report.closingCents, report.openingCents + income - spent);
  assert.ok(report.incomeByFund.some((section) => section.code === 'BUILDING' && section.restricted));
  assert.equal(report.money.find((m) => m.code === '1050')?.balanceCents, balance('1050'));
  assert.equal(report.unmatchedCount, 0, 'the queue was cleared');
  assert.equal(report.cashNotBankedCents, 0);

  const balances = await ChurchReportService.fundBalances(church, '2026-10-01', '2026-10-31');
  assert.equal(balances.reconciliation.reconciles, true);
  assert.equal(balances.reconciliation.fundsClosingCents, income - spent);
  assert.equal(Number(sql(`SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = '${church}'`)), 0, 'the trial balance balances');
  await refused(ChurchReportService.treasurer(church, '2026-13'), /YYYY-MM/);

  const home = await ChurchReportService.dashboard(church, '2026-10-08');
  assert.equal(home.sunday, '2026-10-04');
  assert.equal(home.sundayGivingCents, Number(sql(`SELECT sum(amount_cents) FROM public.contributions WHERE org_id = '${church}' AND received_on = '2026-10-04'`)));
  assert.equal(home.unmatchedCount, 0);
  assert.ok(home.monthByFund.some((f) => f.code === 'GENERAL' && f.givingCents > 0));
});
