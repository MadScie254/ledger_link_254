import { TrackingService, type TagKind } from '../../src/server/tracking';
import { bodyOf, respondError, UserError } from '../http';
import { trackingCategorySchema, trackingCategoryUpdateSchema, uuid } from '../schemas';
import type { Api } from './types';

/** Classes and locations, and the profit and loss cut by them. */
export function registerTrackingRoutes(api: Api) {
  api.get('/tracking-categories', async (c) => {
    try {
      return c.json({ categories: await TrackingService.list(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/tracking-categories', async (c) => {
    try {
      const body = trackingCategorySchema.parse(await bodyOf(c));
      return c.json({ category: await TrackingService.create(c.get('orgId'), body.kind, body.name as string, c.get('userId')) }, 201);
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/tracking-categories/:id', async (c) => {
    try {
      const body = trackingCategoryUpdateSchema.parse(await bodyOf(c));
      return c.json({ category: await TrackingService.update(c.get('orgId'), uuid.parse(c.req.param('id')), body as { name?: string; isActive?: boolean }) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/reports/pnl-by-tag', async (c) => {
    try {
      const kind = c.req.query('kind');
      if (kind !== 'CLASS' && kind !== 'LOCATION') throw new UserError('Choose classes or locations.');
      return c.json(await TrackingService.profitAndLossByTag(c.get('orgId'), kind as TagKind, c.req.query('dateRange') || 'This Year-to-date'));
    } catch (err) { return respondError(c, err); }
  });
}
