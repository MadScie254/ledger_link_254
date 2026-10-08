import { z } from 'zod';
import { isoDate, optionalUuid, positiveCents, text } from './schemas';

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
