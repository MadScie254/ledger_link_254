import { RecurringService, type RecurringKind, type ScheduleInput } from '../../src/server/recurring';
import { bodyOf, respondError, UserError } from '../http';
import { recurringCreateSchema, recurringRunSchema, recurringStatusSchema, recurringUpdateSchema, uuid } from '../schemas';
import type { Api } from './types';

/** Invoices and bills that repeat on a schedule. */
export function registerRecurringRoutes(api: Api) {
  api.get('/recurring', async (c) => {
    try {
      const kind = c.req.query('kind');
      if (kind && kind !== 'INVOICE' && kind !== 'BILL') throw new UserError('Unknown kind of recurring document.');
      return c.json({ templates: await RecurringService.list(c.get('orgId'), (kind as RecurringKind) || undefined) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/recurring', async (c) => {
    try {
      const body = recurringCreateSchema.parse(await bodyOf(c)) as ScheduleInput & { kind: RecurringKind; sourceDocumentId: string };
      return c.json(await RecurringService.save({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.put('/recurring/:id', async (c) => {
    try {
      const body = recurringUpdateSchema.parse(await bodyOf(c)) as ScheduleInput;
      return c.json(await RecurringService.save({ ...body, id: uuid.parse(c.req.param('id')), orgId: c.get('orgId'), actor: c.get('userId') }));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/recurring/:id/status', async (c) => {
    try {
      const body = recurringStatusSchema.parse(await bodyOf(c));
      return c.json(await RecurringService.setStatus(c.get('orgId'), uuid.parse(c.req.param('id')), body.status, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/recurring/:id/run', async (c) => {
    try {
      const body = recurringRunSchema.parse(await bodyOf(c));
      return c.json(await RecurringService.runNow(c.get('orgId'), uuid.parse(c.req.param('id')), body.documentDate, c.get('userId')), 201);
    } catch (err) { return respondError(c, err); }
  });
}
