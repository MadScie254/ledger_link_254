import type { Context, Next } from 'hono';
import { MatterService } from '../../src/server/matters';
import { CourtEventService } from '../../src/server/courtEvents';
import { ClientAccountService } from '../../src/server/clientAccount';
import { DisbursementService } from '../../src/server/disbursements';
import { FeeNoteService } from '../../src/server/feeNotes';
import { assertLawEdition } from '../../src/server/lawAccess';
import { bodyOf, respondError } from '../http';
import { isoDate, uuid } from '../schemas';
import { clientPaymentSchema, clientReceiptSchema, clientTransferSchema,
  conflictQuerySchema, courtEventSchema, courtEventUpdateSchema,
  feeNoteEtimsSchema, feeNotePaymentSchema, feeNoteSchema, matterCreateSchema,
  matterListSchema, matterPartySchema, matterUpdateSchema,
  officeDisbursementSchema } from '../lawSchemas';
import type { Variables } from '../auth';
import type { Api } from './types';

async function requireLawEdition(c: Context<{ Variables: Variables }>, next: Next) {
  try { await assertLawEdition(c.get('orgId')); }
  catch (err) { return respondError(c, err); }
  await next();
}

// The project compiles without strictNullChecks, so Zod's parsed types come
// out all-optional; the schema has already enforced what the service needs.
type Input<F extends (...args: any[]) => any, N extends number> = Parameters<F>[N];
type PartyInput = Input<typeof MatterService.addParty, 3>;

export function registerLawRoutes(api: Api) {
  api.use('/matters', requireLawEdition);
  api.use('/matters/*', requireLawEdition);
  api.use('/court-events', requireLawEdition);
  api.use('/court-events/*', requireLawEdition);
  api.use('/client-account/*', requireLawEdition);
  api.use('/disbursements', requireLawEdition);
  api.use('/fee-notes', requireLawEdition);
  api.use('/fee-notes/*', requireLawEdition);

  api.get('/matters/conflict-check', async (c) => {
    try {
      const query = conflictQuerySchema.parse(c.req.query('q'));
      return c.json({ matches: await MatterService.conflictCheck(c.get('orgId'), query) });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/matters', async (c) => {
    try {
      const filters = matterListSchema.parse(c.req.query());
      return c.json({ matters: await MatterService.list(c.get('orgId'), filters) });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/matters', async (c) => {
    try {
      const body = matterCreateSchema.parse(await bodyOf(c));
      return c.json({ id: await MatterService.create(c.get('orgId'), c.get('userId'), body) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.get('/matters/:id', async (c) => {
    try { return c.json({ matter: await MatterService.get(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });
  api.patch('/matters/:id', async (c) => {
    try {
      await MatterService.update(c.get('orgId'), uuid.parse(c.req.param('id')),
        matterUpdateSchema.parse(await bodyOf(c)));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/matters/:id/parties', async (c) => {
    try { return c.json({ parties: await MatterService.parties(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/matters/:id/parties', async (c) => {
    try {
      const body = matterPartySchema.parse(await bodyOf(c));
      return c.json({ id: await MatterService.addParty(c.get('orgId'),
        uuid.parse(c.req.param('id')), c.get('userId'), body as PartyInput) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.get('/matters/:id/unbilled', async (c) => {
    try { return c.json(await MatterService.unbilled(c.get('orgId'), uuid.parse(c.req.param('id')))); }
    catch (err) { return respondError(c, err); }
  });
  api.get('/matters/:id/time', async (c) => {
    try { return c.json({ entries: await MatterService.timeEntries(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });

  api.get('/court-events', async (c) => {
    try {
      const matterId = c.req.query('matterId');
      return c.json({ events: await CourtEventService.list(c.get('orgId'), {
        from: c.req.query('from'), to: c.req.query('to'),
        matterId: matterId ? uuid.parse(matterId) : undefined,
      }) });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/court-events', async (c) => {
    try {
      return c.json({ id: await CourtEventService.create(c.get('orgId'), c.get('userId'),
        courtEventSchema.parse(await bodyOf(c)) as Input<typeof CourtEventService.create, 2>) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.patch('/court-events/:id', async (c) => {
    try {
      await CourtEventService.update(c.get('orgId'), uuid.parse(c.req.param('id')),
        courtEventUpdateSchema.parse(await bodyOf(c)));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/court-events/calendar-token', async (c) => {
    try {
      const token = await CourtEventService.rotateCalendarToken(c.get('orgId'), c.get('userId'));
      return c.json({ token, path: `/api/court-events/calendar.ics?token=${token}` });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/client-account/balances', async (c) => {
    try {
      const asOf = isoDate.parse(c.req.query('asOf'));
      return c.json({ balances: await ClientAccountService.balances(c.get('orgId'), asOf) });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/client-account/entries', async (c) => {
    try {
      const matterId = uuid.parse(c.req.query('matterId'));
      return c.json({ entries: await ClientAccountService.entries(c.get('orgId'), matterId) });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/client-account/receipts', async (c) => {
    try { return c.json({ journalEntryId: await ClientAccountService.receipt(c.get('orgId'),
      c.get('userId'), clientReceiptSchema.parse(await bodyOf(c)) as Input<typeof ClientAccountService.receipt, 2>) }, 201); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/client-account/payments', async (c) => {
    try { return c.json({ journalEntryId: await ClientAccountService.payment(c.get('orgId'),
      c.get('userId'), clientPaymentSchema.parse(await bodyOf(c)) as Input<typeof ClientAccountService.payment, 2>) }, 201); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/client-account/transfers', async (c) => {
    try { return c.json({ journalEntryId: await ClientAccountService.transfer(c.get('orgId'),
      c.get('userId'), clientTransferSchema.parse(await bodyOf(c)) as Input<typeof ClientAccountService.transfer, 2>) }, 201); }
    catch (err) { return respondError(c, err); }
  });

  api.get('/disbursements', async (c) => {
    try {
      const matterId = c.req.query('matterId');
      return c.json({ disbursements: await DisbursementService.list(c.get('orgId'),
        matterId ? uuid.parse(matterId) : undefined) });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/disbursements', async (c) => {
    try { return c.json({ journalEntryId: await DisbursementService.recordOffice(c.get('orgId'),
      c.get('userId'), officeDisbursementSchema.parse(await bodyOf(c)) as Input<typeof DisbursementService.recordOffice, 2>) }, 201); }
    catch (err) { return respondError(c, err); }
  });

  api.get('/fee-notes', async (c) => {
    try {
      const matterId = c.req.query('matterId');
      return c.json({ feeNotes: await FeeNoteService.list(c.get('orgId'),
        matterId ? uuid.parse(matterId) : undefined) });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/fee-notes/:id', async (c) => {
    try { return c.json({ feeNote: await FeeNoteService.get(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/fee-notes', async (c) => {
    try { return c.json({ id: await FeeNoteService.create(c.get('orgId'), c.get('userId'),
      feeNoteSchema.parse(await bodyOf(c)) as Input<typeof FeeNoteService.create, 2>) }, 201); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/fee-notes/:id/payments', async (c) => {
    try { return c.json({ journalEntryId: await FeeNoteService.payment(c.get('orgId'),
      c.get('userId'), uuid.parse(c.req.param('id')),
      feeNotePaymentSchema.parse(await bodyOf(c)) as Input<typeof FeeNoteService.payment, 3>) }, 201); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/fee-notes/:id/etims', async (c) => {
    try {
      const body = feeNoteEtimsSchema.parse(await bodyOf(c));
      await FeeNoteService.recordEtims(c.get('orgId'), c.get('userId'),
        uuid.parse(c.req.param('id')), body.number);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
}
