/**
 * "Kanisa la Mfano (demo)": a fictional Kundi church with 60 members in 15
 * households, its four funds, and three months of giving: an M-Pesa
 * statement each month placed by the giving rules, Sunday cash, a few bank
 * gifts, and fund-tagged spending. Everything posts through the services
 * the app uses. No real names, phone numbers or ID numbers: members are
 * named "Mfano" ("example") and carry no contact details.
 *
 * Sunday cash is counted by two people when a second user is given
 * (secondUserId, an existing Supabase Auth user, added as accountant);
 * otherwise it is recorded as cash gifts.
 */
import { getSupabase } from '../../src/server/supabase';
import { OrganizationService } from '../../src/server/organizations';
import { MembersService } from '../../src/server/members';
import { GivingService } from '../../src/server/giving';
import { CollectionsService } from '../../src/server/collections';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { CashTransactionService } from '../../src/server/cashTransactions';
import { AccountService } from '../../src/server/accounts';
import { runWithRequestContext } from '../../src/server/requestContext';
import { sundayOnOrBefore } from '../../src/utils/churchReports';
import { countTotalCents, type Counts } from '../../src/utils/cashCount';
import type { ImportedMember } from '../../src/utils/memberImport';

export const CHURCH_DEMO_NAME = 'Kanisa la Mfano (demo)';

const GIVEN_NAMES = ['Amani', 'Baraka', 'Neema', 'Imani', 'Zawadi', 'Furaha', 'Tumaini', 'Upendo', 'Rehema', 'Faraja', 'Wema', 'Shukuru'];
const key = () => crypto.randomUUID();
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return isoDay(date); };

/** A small, repeatable spread of amounts so the demo looks the same each time. */
const pick = (seed: number, values: number[]) => values[Math.abs(seed) % values.length];

/** Notes and coins for an amount in whole shillings, largest first. */
function countsFor(shillings: number): Counts {
  const counts: Counts = {};
  let left = shillings;
  for (const value of [1000, 500, 200, 100, 50, 20, 10, 5, 1]) {
    const count = Math.floor(left / value);
    if (count > 0) { counts[String(value)] = count; left -= count * value; }
  }
  return counts;
}

export async function seedChurchDemo(userId: string, options: { secondUserId?: string; today?: string } = {}) {
  const supabase = getSupabase();
  const today = options.today || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
  const orgId = await OrganizationService.createOrganization({
    name: CHURCH_DEMO_NAME, legalName: CHURCH_DEMO_NAME, country: 'Kenya', baseCurrency: 'KES', edition: 'church',
  } as any, userId);
  const { error: demoError } = await supabase.from('organizations').update({ is_demo: true }).eq('id', orgId);
  if (demoError) throw demoError;
  if (options.secondUserId) {
    const { error } = await supabase.from('memberships').insert({ org_id: orgId, user_id: options.secondUserId, role: 'accountant' });
    if (error) throw error;
  }

  // The register: 60 members in 15 households.
  const members: ImportedMember[] = Array.from({ length: 60 }, (_, i) => ({
    memberNumber: String(1001 + i),
    firstName: GIVEN_NAMES[i % GIVEN_NAMES.length],
    lastName: `Mfano ${Math.floor(i / GIVEN_NAMES.length) + 1}`,
    phone: null, email: null,
    status: i % 15 === 0 ? 'VISITOR' : i % 7 === 0 ? 'ADHERENT' : i % 3 === 0 ? 'BAPTISED_MEMBER' : 'MEMBER',
    household: `Nyumba ya Mfano ${Math.floor(i / 4) + 1}`,
    dateOfBirth: null, joinedOn: addDays(today, -400 - i * 7), consentMethod: null, notes: null,
  }));
  await MembersService.importMany(orgId, userId, members);

  const { data: funds, error: fundsError } = await supabase.from('funds').select('id,code').eq('org_id', orgId);
  if (fundsError) throw fundsError;
  const fund = (code: string) => {
    const found = (funds ?? []).find((row) => row.code === code);
    if (!found) throw new Error(`The demo church has no ${code} fund.`);
    return found.id as string;
  };
  const bank = await AccountService.getAccountByCode(orgId, '1000');
  const mpesa = await AccountService.getAccountByCode(orgId, '1050');
  const ministry = await AccountService.getAccountByCode(orgId, '6310');
  const welfare = await AccountService.getAccountByCode(orgId, '6320');
  if (!bank || !mpesa || !ministry || !welfare) throw new Error('The demo chart is missing a church account.');

  // Thirteen Sundays, the last one on or before today.
  const lastSunday = sundayOnOrBefore(today);
  const sundays = Array.from({ length: 13 }, (_, i) => addDays(lastSunday, -7 * (12 - i)));
  let receiptNumber = 0;
  const statements = new Map<string, { gifts: any[]; charges: any[] }>();
  for (const [week, sunday] of sundays.entries()) {
    const month = sunday.slice(0, 7);
    const statement = statements.get(month) ?? { gifts: [], charges: [] };
    statements.set(month, statement);
    // About twenty members give by M-Pesa each Sunday: tithe by member number,
    // some to the building fund (BLD) or missions (MSN), one with a reference
    // the rules cannot place, which waits in the queue.
    for (let m = 0; m < 20; m++) {
      const member = 1001 + ((week * 7 + m * 3) % 60);
      const reference = m % 6 === 0 ? `BLD ${member}` : m % 9 === 0 ? `MSN${member}` : m === 19 && week % 4 === 0 ? 'sadaka' : String(member);
      receiptNumber += 1;
      statement.gifts.push({
        transId: `TD${String(receiptNumber).padStart(8, '0')}`,
        transTime: `${sunday}T${String(8 + (m % 4)).padStart(2, '0')}:${String((m * 7) % 60).padStart(2, '0')}:00+03:00`,
        amountCents: pick(member + week, [50_000, 100_000, 150_000, 200_000, 250_000, 500_000]),
        billRefNumber: reference, msisdn: null, firstName: GIVEN_NAMES[(member - 1001) % GIVEN_NAMES.length].toUpperCase(),
      });
      receiptNumber += 1;
      statement.charges.push({ transId: `TD${String(receiptNumber).padStart(8, '0')}`, date: sunday, amountCents: 1_000 });
    }

    // Sunday cash: counted by two people when there is a second user.
    const shillings = 9_000 + pick(week, [0, 1_350, 2_700, 4_050, 680]);
    if (options.secondUserId) {
      const counts = countsFor(shillings);
      const started = await CollectionsService.start(orgId, userId, {
        serviceDate: sunday, serviceName: 'Main service', counts, totalCents: countTotalCents(counts), fundId: fund('GENERAL'), idempotencyKey: key(),
      });
      await CollectionsService.confirm(orgId, options.secondUserId, started.id, { counts, idempotencyKey: key() });
      // Banked on Monday, one week KES 50 short.
      await CollectionsService.bank(orgId, userId, started.id, {
        bankedCents: countTotalCents(counts) - (week === 5 ? 5_000 : 0), bankedOn: addDays(sunday, 1),
        bankAccountId: bank.id, bankReference: `DEP-DEMO-${week + 1}`, idempotencyKey: key(),
      });
    } else {
      await GivingService.recordGift(orgId, userId, {
        memberId: null, fundId: fund('GENERAL'), amountCents: shillings * 100, method: 'CASH', receivedOn: sunday, idempotencyKey: key(),
      });
    }

    // A thanksgiving cheque every fourth week, and welfare support paid out.
    if (week % 4 === 1) {
      const { data: member } = await supabase.from('members').select('id').eq('org_id', orgId).eq('member_number', String(1010 + week)).maybeSingle();
      await GivingService.recordGift(orgId, userId, {
        memberId: member?.id ?? null, fundId: fund('WELFARE'), amountCents: 1_000_000, method: 'CHEQUE', receivedOn: sunday, idempotencyKey: key(),
      });
      await runWithRequestContext({ actorId: userId, fundId: fund('WELFARE') }, () => CashTransactionService.recordExpense({
        orgId, payeeName: 'Welfare support (demo)', date: addDays(sunday, 2), paidFromAccountId: bank.id,
        lines: [{ description: 'Support to a family in need', accountId: welfare.id, amountCents: 600_000 }],
        actor: userId, idempotencyKey: key(),
      } as any));
    }
  }

  // Building materials from the building fund, and ministry costs from general.
  await runWithRequestContext({ actorId: userId, fundId: fund('BUILDING') }, () => CashTransactionService.recordExpense({
    orgId, payeeName: 'Hardware supplier (demo)', date: addDays(lastSunday, -30), paidFromAccountId: bank.id,
    lines: [{ description: 'Roofing sheets', accountId: ministry.id, amountCents: 4_500_000 }], actor: userId, idempotencyKey: key(),
  } as any));
  await runWithRequestContext({ actorId: userId }, () => CashTransactionService.recordExpense({
    orgId, payeeName: 'Youth camp (demo)', date: addDays(lastSunday, -20), paidFromAccountId: mpesa.id,
    lines: [{ description: 'Youth camp transport', accountId: ministry.id, amountCents: 1_200_000 }], actor: userId, idempotencyKey: key(),
  } as any));

  // One M-Pesa statement a month: gifts placed by the rules, charges posted once each.
  let posted = 0;
  let queued = 0;
  for (const statement of statements.values()) {
    const result = await MpesaC2bService.uploadStatement(orgId, userId, statement);
    posted += result.posted.length;
    queued += result.queued.length;
  }
  return { orgId, members: members.length, sundays: sundays.length, mpesaPosted: posted, mpesaQueued: queued };
}
