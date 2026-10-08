// The Mizani law edition through its services and PostgREST: a matter is
// opened, its time and court dates recorded, client money received, spent
// and transferred against a fee note, and every figure reconciles.
import assert from 'node:assert/strict';
import test from 'node:test';
import { OrganizationService } from '../../src/server/organizations';
import { CustomerService } from '../../src/server/customers';
import { MatterService } from '../../src/server/matters';
import { CourtEventService } from '../../src/server/courtEvents';
import { ClientAccountService } from '../../src/server/clientAccount';
import { DisbursementService } from '../../src/server/disbursements';
import { FeeNoteService } from '../../src/server/feeNotes';
import { assertLawEdition } from '../../src/server/lawAccess';
import { ORG, OWNER, sql, uuid, refused } from './helpers';

let lawOrg = '';
let client = '';
let matter = '';
const account = (code: string) => sql(`SELECT id FROM public.accounts WHERE org_id = '${lawOrg}' AND code = '${code}'`);
const balance = (code: string) => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l
  JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${lawOrg}' AND a.code = '${code}'`));

test('a law organization opens a numbered matter for a client and checks conflicts', async () => {
  lawOrg = await OrganizationService.createOrganization({ name: 'Wanjiru & Co Advocates', country: 'Kenya', edition: 'law' } as any, OWNER);
  await assertLawEdition(lawOrg);
  await refused(assertLawEdition(ORG), /Mizani law organizations/);
  for (const code of ['1060', '1170', '1180', '2200', '4300', '4310']) assert.ok(account(code), `account ${code} seeded`);

  client = await CustomerService.createCustomer(lawOrg, { displayName: 'Achieng Otieno' } as any);
  matter = await MatterService.create(lawOrg, OWNER, {
    title: 'Otieno v Kamau, land dispute', clientId: client, matterType: 'LITIGATION',
    billingMethod: 'HOURLY', defaultRateCents: 1_500_000, openedOn: '2026-10-01', court: 'ELC Nairobi',
  });
  const opened = await MatterService.get(lawOrg, matter);
  assert.match(opened.matter_number, /^MAT-2026-\d{4}$/);
  assert.equal(opened.status, 'OPEN');
  assert.equal(opened.customers.display_name, 'Achieng Otieno');

  await MatterService.addParty(lawOrg, matter, OWNER, { name: 'Peter Kamau', role: 'OPPOSING_PARTY' });
  const parties = await MatterService.parties(lawOrg, matter);
  assert.deepEqual(parties.map((party: any) => party.name), ['Peter Kamau']);
  const hits = await MatterService.conflictCheck(lawOrg, 'Kamau');
  assert.ok(hits.some((hit: any) => hit.source === 'PARTY' && hit.matter_id === matter), 'the opposing party is found');
  assert.ok((await MatterService.conflictCheck(lawOrg, 'Otieno')).some((hit: any) => hit.source === 'CUSTOMER'), 'the client is found');
  assert.equal((await MatterService.list(lawOrg, { search: 'land' })).length, 1);

  // Another organization cannot read the matter.
  await refused(MatterService.get(ORG, matter), /Matter not found/);
});

test('time is billed at the matter rate and court dates feed a private calendar', async () => {
  const time = await MatterService.logTime(lawOrg, matter, OWNER, { entryDate: '2026-10-02', hours: 2.5, description: 'Drafting plaint', billable: true });
  assert.equal(sql(`SELECT amount_cents FROM public.time_entries WHERE id = '${time}'`), '3750000');
  await MatterService.logTime(lawOrg, matter, OWNER, { entryDate: '2026-10-02', hours: 1, description: 'Internal review', billable: false });
  const unbilled = await MatterService.unbilled(lawOrg, matter);
  assert.equal(unbilled.timeEntries.length, 1, 'only billable time waits to be billed');

  const hearing = await CourtEventService.create(lawOrg, OWNER, { matterId: matter, eventType: 'HEARING', startsAt: '2026-10-15T09:00:00+03:00', court: 'ELC Nairobi' });
  await refused(CourtEventService.update(lawOrg, hearing, { status: 'DONE', outcome: 'Part heard' }), /next court date/);
  const mention = await CourtEventService.create(lawOrg, OWNER, { matterId: matter, eventType: 'MENTION', startsAt: '2026-11-03T09:00:00+03:00' });
  await CourtEventService.update(lawOrg, hearing, { status: 'ADJOURNED', outcome: 'Adjourned for mention', nextEventId: mention });
  assert.equal((await CourtEventService.list(lawOrg, { matterId: matter })).length, 2);

  // The diary follows the responsible advocate.
  await MatterService.update(lawOrg, matter, { responsibleUserId: OWNER });
  const token = await CourtEventService.rotateCalendarToken(lawOrg, OWNER);
  const feed = await CourtEventService.calendarForToken(token);
  assert.ok(feed && feed.includes('BEGIN:VCALENDAR') && feed.includes('DTSTART:20261015T060000Z'), 'the hearing is in the feed');
  assert.equal(await CourtEventService.calendarForToken('0'.repeat(64)), null, 'an unknown token reads nothing');
  const rotated = await CourtEventService.rotateCalendarToken(lawOrg, OWNER);
  assert.equal(await CourtEventService.calendarForToken(token), null, 'a rotated token stops working');
  assert.ok(await CourtEventService.calendarForToken(rotated));
});

test('client money is received, paid out, transferred to office against a fee note, and reconciles', async () => {
  const receipt = await ClientAccountService.receipt(lawOrg, OWNER, {
    matterId: matter, amountCents: 10_000_000, receiptDate: '2026-10-03', method: 'BANK', reference: 'EFT-889', idempotencyKey: uuid(),
  });
  assert.ok(receipt);
  await ClientAccountService.payment(lawOrg, OWNER, {
    matterId: matter, amountCents: 500_000, paymentDate: '2026-10-04', payee: 'Judiciary', purpose: 'Court filing fees',
    asDisbursement: true, idempotencyKey: uuid(),
  });
  await refused(ClientAccountService.payment(lawOrg, OWNER, {
    matterId: matter, amountCents: 99_000_000, paymentDate: '2026-10-04', payee: 'Overdraw', purpose: 'Too much',
    asDisbursement: false, idempotencyKey: uuid(),
  }), /client|balance|exceed/i);

  const officeBank = account('1000');
  await DisbursementService.recordOffice(lawOrg, OWNER, {
    matterId: matter, amountCents: 200_000, incurredOn: '2026-10-05', description: 'Search fees, Ardhisasa',
    paidFromAccountId: officeBank, idempotencyKey: uuid(),
  });
  const unbilled = await MatterService.unbilled(lawOrg, matter);
  assert.equal(unbilled.disbursements.length, 1, 'the office disbursement waits to be billed');

  const feeNote = await FeeNoteService.create(lawOrg, OWNER, {
    matterId: matter, issueDate: '2026-10-06', dueDate: '2026-10-20',
    timeEntryIds: unbilled.timeEntries.map((entry: any) => entry.id),
    disbursementIds: unbilled.disbursements.map((entry: any) => entry.id),
    vatRatePercent: 0, idempotencyKey: uuid(),
  });
  const note = await FeeNoteService.get(lawOrg, feeNote);
  assert.equal(Number(note.total_cents), 3_750_000 + 200_000);
  assert.deepEqual(note.lines.map((line: any) => line.line_kind).sort(), ['DISBURSEMENT', 'PROFIT_COST']);
  assert.equal((await FeeNoteService.list(lawOrg, matter)).length, 1);
  await refused(FeeNoteService.create(lawOrg, OWNER, {
    matterId: matter, issueDate: '2026-10-06', dueDate: '2026-10-20', timeEntryIds: [], disbursementIds: [],
    vatRatePercent: 16, idempotencyKey: uuid(),
  }), /VAT/);

  // Part paid from client money, the rest by the client less 5% withholding on fees.
  await ClientAccountService.transfer(lawOrg, OWNER, {
    matterId: matter, invoiceId: feeNote, amountCents: 1_000_000, transferDate: '2026-10-07', officeAccountId: officeBank, idempotencyKey: uuid(),
  });
  await FeeNoteService.payment(lawOrg, OWNER, feeNote, {
    cashCents: 2_950_000 - 187_500, whtCents: 187_500, whtCertificateNumber: 'WHT-2026-77', paymentDate: '2026-10-08',
    depositAccountId: officeBank, idempotencyKey: uuid(),
  });
  assert.equal(sql(`SELECT status || ' ' || amount_due_cents FROM public.invoices WHERE id = '${feeNote}'`), 'PAID 0');
  await FeeNoteService.recordEtims(lawOrg, OWNER, feeNote, 'KRAMW0120261008000123');

  // The client ledger and balances agree with the client accounts.
  const ledger = await ClientAccountService.entries(lawOrg, matter);
  assert.deepEqual(ledger.map((line) => [line.receivedCents, line.paidCents]), [[10_000_000, 0], [0, 500_000], [0, 1_000_000]]);
  assert.equal(ledger.at(-1)!.heldCents, 8_500_000);
  const held = (await ClientAccountService.balances(lawOrg, '2026-10-31')).find((row: any) => row.matter_id === matter);
  assert.equal(Number(held.balance_cents), 8_500_000);
  assert.equal(balance('1060'), 8_500_000, 'client bank holds what is owed to clients');
  assert.equal(-balance('2200'), 8_500_000, 'client money held');
  assert.equal(balance('1100'), 0, 'the fee note is settled');
  assert.equal(balance('1170'), 187_500, 'withholding receivable');
  assert.equal(balance('1180'), 0, 'the disbursement is recovered through the fee note');
});
