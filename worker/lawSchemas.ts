import { z } from 'zod';
import { cents, idempotencyKey, isoDate, optionalUuid, positiveCents,
  requiredText, text, uuid } from './schemas';

const matterType = z.enum(['LITIGATION','CONVEYANCING','CORPORATE','PROBATE',
  'EMPLOYMENT','ADVISORY','OTHER']);
const matterStatus = z.enum(['OPEN','ON_HOLD','CLOSED']);
const billingMethod = z.enum(['HOURLY','FIXED','SCALE','RETAINER']);

export const matterCreateSchema = z.object({
  title: requiredText(200,'A matter title'), clientId: uuid,
  practiceArea: text(100), matterType: matterType.optional(), stage: text(100),
  responsibleUserId: optionalUuid, court: text(200), courtStation: text(200),
  caseNumber: text(100), judicialOfficer: text(200),
  billingMethod: billingMethod.optional(), defaultRateCents: cents.optional(),
  fixedFeeCents: cents.optional(), openedOn: isoDate.optional(), notes: text(4000),
});
export const matterUpdateSchema = matterCreateSchema.omit({ clientId: true, openedOn: true })
  .partial().extend({ status: matterStatus.optional(), closedOn: isoDate.optional().nullable() });
export const matterListSchema = z.object({
  search: text(100), status: matterStatus.optional(), stage: text(100),
});
export const conflictQuerySchema = requiredText(100,'A name to check').min(3);

export const matterPartySchema = z.object({
  name: requiredText(200,'A party name'),
  role: z.enum(['CLIENT','OPPOSING_PARTY','OPPOSING_ADVOCATE','WITNESS',
    'INTERESTED_PARTY','OTHER']),
  idOrRegNumber: text(100), phone: text(40), email: text(320),
});

const eventType = z.enum(['HEARING','MENTION','RULING','JUDGMENT','FILING_DEADLINE','OTHER']);
const eventStatus = z.enum(['SCHEDULED','DONE','ADJOURNED','CANCELLED']);
const startsAt = z.string().datetime({ offset: true });
export const courtEventSchema = z.object({
  matterId: uuid, eventType, startsAt,
  court: text(200), courtroom: text(100), judicialOfficer: text(200),
});
export const courtEventUpdateSchema = courtEventSchema.omit({ matterId: true })
  .partial().extend({ status: eventStatus.optional(), outcome: text(2000).nullable(),
    nextEventId: optionalUuid.nullable(), noFurtherDate: z.boolean().optional() });

export const lawTimeSchema = z.object({
  matterId: uuid, entryDate: isoDate, hours: z.number().gt(0).max(24),
  description: text(1000), billable: z.boolean().default(true),
  rateCents: cents.optional(),
});

export const clientReceiptSchema = z.object({
  matterId: uuid, amountCents: positiveCents, receiptDate: isoDate,
  method: requiredText(80,'A receipt method'),
  reference: requiredText(200,'A receipt reference'), idempotencyKey,
});
export const clientPaymentSchema = z.object({
  matterId: uuid, amountCents: positiveCents, paymentDate: isoDate,
  payee: requiredText(200,'A payee'), purpose: requiredText(500,'A purpose'),
  asDisbursement: z.boolean().default(false), idempotencyKey,
});
export const clientTransferSchema = z.object({
  matterId: uuid, invoiceId: uuid, amountCents: positiveCents,
  transferDate: isoDate, officeAccountId: uuid, idempotencyKey,
});
export const officeDisbursementSchema = z.object({
  matterId: uuid, amountCents: positiveCents, incurredOn: isoDate,
  description: requiredText(500,'A disbursement description'),
  paidFromAccountId: uuid, receiptReference: text(200), idempotencyKey,
});
export const feeNoteSchema = z.object({
  matterId: uuid, issueDate: isoDate, dueDate: isoDate,
  timeEntryIds: z.array(uuid).default([]), disbursementIds: z.array(uuid).default([]),
  vatRatePercent: z.number().min(0).max(100).default(0),
  notes: text(4000), idempotencyKey,
}).refine((value) => value.timeEntryIds.length+value.disbursementIds.length>0,
  'Select unbilled work for the fee note.');
export const feeNotePaymentSchema = z.object({
  cashCents: cents, whtCents: cents, whtCertificateNumber: text(100),
  paymentDate: isoDate, depositAccountId: uuid, idempotencyKey,
}).refine((value) => value.cashCents+value.whtCents>0,
  'Enter cash or withholding tax received.');
export const feeNoteEtimsSchema = z.object({ number: requiredText(100,'An eTIMS number') });
