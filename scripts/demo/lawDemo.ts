/**
 * "Wanjiru & Otieno Advocates (demo)": a fictional Mizani law firm with
 * five matters, three in litigation and two in conveyancing, worked through
 * the same services the app uses, so every figure is posted the real way.
 * No real names, phone numbers or ID numbers: clients are named "Mfano"
 * ("example") and carry no contact details.
 */
import { getSupabase } from '../../src/server/supabase';
import { OrganizationService } from '../../src/server/organizations';
import { CustomerService } from '../../src/server/customers';
import { MatterService } from '../../src/server/matters';
import { CourtEventService } from '../../src/server/courtEvents';
import { ClientAccountService } from '../../src/server/clientAccount';
import { DisbursementService } from '../../src/server/disbursements';
import { FeeNoteService } from '../../src/server/feeNotes';
import { AccountService } from '../../src/server/accounts';

const key = () => crypto.randomUUID();
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const daysFrom = (base: Date, days: number) => { const next = new Date(base); next.setUTCDate(next.getUTCDate() + days); return next; };

export const LAW_DEMO_NAME = 'Wanjiru & Otieno Advocates (demo)';

export async function seedLawDemo(userId: string, today = new Date()) {
  const supabase = getSupabase();
  const orgId = await OrganizationService.createOrganization({
    name: LAW_DEMO_NAME, legalName: LAW_DEMO_NAME, country: 'Kenya', baseCurrency: 'KES', edition: 'law',
  } as any, userId);
  const { error: demoError } = await supabase.from('organizations').update({ is_demo: true }).eq('id', orgId);
  if (demoError) throw demoError;

  const officeBank = await AccountService.getAccountByCode(orgId, '1000');
  if (!officeBank) throw new Error('The demo chart has no office bank account (1000).');
  const start = daysFrom(today, -60);
  const on = (days: number) => isoDay(daysFrom(start, days));

  const client = (displayName: string) => CustomerService.createCustomer(orgId, { displayName } as any);
  const clients = {
    achieng: await client('Achieng Mfano'),
    baraka: await client('Baraka Mfano Holdings Ltd'),
    neema: await client('Neema Mfano'),
    tumaini: await client('Tumaini Mfano Co-operative Society'),
    zawadi: await client('Zawadi Mfano'),
  };

  const open = (input: Record<string, unknown>) => MatterService.create(orgId, userId, { openedOn: on(0), ...input } as any);
  const matters = {
    land: await open({ title: 'Mfano v Mfano, boundary dispute', clientId: clients.achieng, matterType: 'LITIGATION', billingMethod: 'HOURLY', defaultRateCents: 1_500_000, court: 'ELC Nairobi', stage: 'Pleadings' }),
    contract: await open({ title: 'Baraka Mfano Holdings v Supplier, breach of contract', clientId: clients.baraka, matterType: 'LITIGATION', billingMethod: 'HOURLY', defaultRateCents: 2_000_000, court: 'High Court Commercial Division', stage: 'Hearing' }),
    employment: await open({ title: 'Neema Mfano, unfair termination claim', clientId: clients.neema, matterType: 'LITIGATION', billingMethod: 'FIXED', fixedFeeCents: 15_000_000, court: 'ELRC Nairobi', stage: 'Mention' }),
    purchase: await open({ title: 'Purchase of plot by the society', clientId: clients.tumaini, matterType: 'CONVEYANCING', billingMethod: 'FIXED', fixedFeeCents: 12_000_000, stage: 'Searches' }),
    sale: await open({ title: 'Sale of apartment', clientId: clients.zawadi, matterType: 'CONVEYANCING', billingMethod: 'FIXED', fixedFeeCents: 9_000_000, stage: 'Completion' }),
  };

  // Litigation: parties, court dates and time.
  await MatterService.addParty(orgId, matters.land, userId, { name: 'Opposing party (demo)', role: 'OPPOSING_PARTY' } as any);
  await MatterService.update(orgId, matters.land, { responsibleUserId: userId } as any);
  await MatterService.update(orgId, matters.contract, { responsibleUserId: userId } as any);
  await CourtEventService.create(orgId, userId, { matterId: matters.land, eventType: 'MENTION', startsAt: `${on(65)}T09:00:00+03:00`, court: 'ELC Nairobi' } as any);
  await CourtEventService.create(orgId, userId, { matterId: matters.contract, eventType: 'HEARING', startsAt: `${on(62)}T10:00:00+03:00`, court: 'High Court Commercial Division' } as any);
  await CourtEventService.create(orgId, userId, { matterId: matters.employment, eventType: 'MENTION', startsAt: `${on(70)}T09:30:00+03:00`, court: 'ELRC Nairobi' } as any);
  for (const [matterId, entries] of [
    [matters.land, [[2, 2.5, 'Drafting the plaint'], [9, 1, 'Client meeting'], [20, 1.5, 'Preparing the list of documents']]],
    [matters.contract, [[5, 3, 'Reviewing the supply contract'], [30, 2, 'Witness statements']]],
  ] as Array<[string, Array<[number, number, string]>]>) {
    for (const [day, hours, description] of entries) {
      await MatterService.logTime(orgId, matterId, userId, { entryDate: on(day), hours, description, billable: true } as any);
    }
  }

  // The land matter is billed: time and a search fee, part paid from client money.
  await ClientAccountService.receipt(orgId, userId, { matterId: matters.land, amountCents: 5_000_000, receiptDate: on(3), method: 'BANK', reference: 'EFT-DEMO-1', idempotencyKey: key() } as any);
  await DisbursementService.recordOffice(orgId, userId, { matterId: matters.land, amountCents: 150_000, incurredOn: on(4), description: 'Search fees (demo)', paidFromAccountId: officeBank.id, idempotencyKey: key() } as any);
  const unbilled = await MatterService.unbilled(orgId, matters.land);
  const feeNote = await FeeNoteService.create(orgId, userId, {
    matterId: matters.land, issueDate: on(25), dueDate: on(39),
    timeEntryIds: unbilled.timeEntries.map((entry: any) => entry.id),
    disbursementIds: unbilled.disbursements.map((entry: any) => entry.id),
    vatRatePercent: 0, idempotencyKey: key(),
  } as any);
  await ClientAccountService.transfer(orgId, userId, { matterId: matters.land, invoiceId: feeNote, amountCents: 3_000_000, transferDate: on(26), officeAccountId: officeBank.id, idempotencyKey: key() } as any);

  // Conveyancing: deposits held for the clients, and stamp duty paid out of client money.
  await ClientAccountService.receipt(orgId, userId, { matterId: matters.purchase, amountCents: 60_000_000, receiptDate: on(10), method: 'BANK', reference: 'EFT-DEMO-2', idempotencyKey: key() } as any);
  await ClientAccountService.payment(orgId, userId, { matterId: matters.purchase, amountCents: 2_400_000, paymentDate: on(15), payee: 'Stamp duty (demo)', purpose: 'Stamp duty on transfer', asDisbursement: true, idempotencyKey: key() } as any);
  await ClientAccountService.receipt(orgId, userId, { matterId: matters.sale, amountCents: 85_000_000, receiptDate: on(40), method: 'BANK', reference: 'EFT-DEMO-3', idempotencyKey: key() } as any);

  return { orgId, matters: Object.keys(matters).length };
}
