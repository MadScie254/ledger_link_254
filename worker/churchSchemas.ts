import { z } from 'zod';
import { idempotencyKey, isoDate, optionalUuid, positiveCents, requiredText, text, uuid } from './schemas';

const transId = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,30}$/, 'An M-Pesa receipt number is 6 to 30 letters and digits.');
const isoTime = z.string().trim().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)
  && !Number.isNaN(Date.parse(value)), 'Use a full date and time.');

// --- M-Pesa ----------------------------------------------------------------

export const mpesaIntegrationSchema = z.object({
  shortcode: z.string().trim().regex(/^[0-9]{5,10}$/, 'Enter the paybill or till number Safaricom gave the church (5 to 10 digits).'),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  consumerKey: text(200),
  consumerSecret: text(200),
  integrationActorId: optionalUuid.nullable(),
});

export const mpesaStatementSchema = z.object({
  gifts: z.array(z.object({
    transId,
    transTime: isoTime,
    amountCents: positiveCents,
    billRefNumber: text(100).nullable(),
    msisdn: text(100).nullable(),
    firstName: text(100).nullable(),
  })).max(5000, 'Upload at most 5,000 M-Pesa lines at a time.'),
  charges: z.array(z.object({ transId, date: isoDate, amountCents: positiveCents }))
    .max(5000, 'Upload at most 5,000 M-Pesa lines at a time.'),
}).refine((body) => body.gifts.length + body.charges.length > 0, 'The statement has no gifts or charges to upload.');

// --- Members and households ------------------------------------------------

const memberStatus = z.enum(['VISITOR', 'ADHERENT', 'MEMBER', 'BAPTISED_MEMBER', 'TRANSFERRED', 'DECEASED', 'INACTIVE']);
const memberNumber = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'A member number is 1 to 20 letters, digits or hyphens.');
const nullableText = (max: number) => text(max).nullable();

const memberFields = {
  memberNumber,
  firstName: requiredText(100, 'A first name'),
  lastName: nullableText(100),
  phone: nullableText(40),
  email: z.preprocess((value) => (value === '' ? null : value), z.string().trim().toLowerCase().email('Enter a valid email address.').max(320).nullable().optional()),
  householdId: optionalUuid.nullable(),
  status: memberStatus.optional(),
  dateOfBirth: isoDate.nullable().optional(),
  joinedOn: isoDate.nullable().optional(),
  consentMethod: nullableText(100),
  notes: nullableText(2000),
};
export const memberCreateSchema = z.object(memberFields);
export const memberUpdateSchema = z.object(memberFields).partial();
export const memberListSchema = z.object({ search: text(60), status: memberStatus.optional(), householdId: optionalUuid });
export const memberImportSchema = z.object({
  members: z.array(z.object({
    memberNumber,
    firstName: requiredText(100, 'A first name'),
    lastName: nullableText(100),
    phone: nullableText(40),
    email: z.string().trim().toLowerCase().email().max(320).nullable(),
    status: memberStatus,
    household: nullableText(200),
    dateOfBirth: isoDate.nullable(),
    joinedOn: isoDate.nullable(),
    consentMethod: nullableText(100),
    notes: nullableText(2000),
  })).min(1, 'The file has no members to import.').max(5000, 'Import at most 5,000 members at a time.'),
});
export const householdSchema = z.object({ name: requiredText(200, 'A household name'), address: nullableText(500), phone: nullableText(40) });

// --- Funds and giving rules --------------------------------------------------

export const fundCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'A fund code is 2 to 20 capital letters, digits or underscores, such as YOUTH.'),
  name: requiredText(100, 'A fund name'),
  restricted: z.boolean(),
  incomeAccountId: uuid,
});
export const fundUpdateSchema = z.object({
  name: requiredText(100, 'A fund name').optional(), restricted: z.boolean().optional(),
  isActive: z.boolean().optional(), incomeAccountId: uuid.optional(),
});
export const givingRuleSchema = z.object({
  priority: z.number().int().min(0).max(10000),
  matchType: z.enum(['MEMBER_NUMBER', 'PREFIX', 'EXACT']),
  pattern: z.string().trim().max(20).nullable().optional(),
  fundId: uuid,
  incomeAccountId: optionalUuid.nullable(),
});
export const givingRuleUpdateSchema = z.object({ priority: z.number().int().min(0).max(10000).optional(), isActive: z.boolean().optional() });

// --- Giving, queue and cash counts --------------------------------------------

export const queueAssignSchema = z.object({ memberId: optionalUuid.nullable(), fundId: uuid, incomeAccountId: optionalUuid.nullable() });
export const queueIgnoreSchema = z.object({ reason: requiredText(500, 'A reason').min(3, 'Say why this receipt is not giving.') });
export const contributionSchema = z.object({
  memberId: optionalUuid.nullable(), fundId: uuid, incomeAccountId: optionalUuid.nullable(),
  amountCents: positiveCents, method: z.enum(['CASH', 'BANK', 'CHEQUE']), receivedOn: isoDate, idempotencyKey,
});
const counts = z.record(z.string().regex(/^(1000|500|200|100|50|20|10|5|1)$/, 'Count Kenyan notes and coins only.'),
  z.number().int('Count notes and coins in whole numbers.').min(0).max(1_000_000));
export const collectionStartSchema = z.object({
  serviceDate: isoDate, serviceName: requiredText(100, 'The service'), counts, totalCents: positiveCents, fundId: uuid, idempotencyKey,
});
export const collectionConfirmSchema = z.object({ counts, idempotencyKey });
export const collectionBankSchema = z.object({
  bankedCents: positiveCents, bankedOn: isoDate, bankAccountId: uuid, bankReference: nullableText(100), idempotencyKey,
});
export const collectionListSchema = z.object({ status: z.enum(['AWAITING_SECOND_COUNT', 'COUNTED', 'BANKED']).optional() });
export const dayQuerySchema = z.object({ date: isoDate });
export const monthQuerySchema = z.object({ month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month as YYYY-MM.') });
export const periodQuerySchema = z.object({ from: isoDate, to: isoDate });
