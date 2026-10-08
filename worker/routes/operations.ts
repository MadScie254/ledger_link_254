import { InventoryService, type ItemInput } from '../../src/server/inventory';
import { ProjectService } from '../../src/server/projects';
import { MatterService } from '../../src/server/matters';
import { assertLawEdition } from '../../src/server/lawAccess';
import { bodyOf, respondError } from '../http';
import { itemSchema, itemUpdateSchema, projectSchema, projectUpdateSchema, stockAdjustmentSchema, timeEntrySchema, uuid } from '../schemas';
import { lawTimeSchema } from '../lawSchemas';
import type { Api } from './types';

/** Stock items, projects and time. */
export function registerOperationsRoutes(api: Api) {
  api.get('/inventory', async (c) => {
    try {
      return c.json({ items: await InventoryService.getItems(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/inventory', async (c) => {
    try {
      const body = itemSchema.parse(await bodyOf(c));
      return c.json({ id: await InventoryService.createItem(c.get('orgId'), body) });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/inventory/:id', async (c) => {
    try {
      const raw = await bodyOf(c);
      // A stock count is set through an adjustment, never by editing the item.
      const body = itemUpdateSchema.parse(raw);
      await InventoryService.updateItem(c.get('orgId'), uuid.parse(c.req.param('id')), {
        ...(body as ItemInput),
        ...(raw && raw.quantityOnHand !== undefined ? { quantityOnHand: raw.quantityOnHand } : {}),
      });
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/inventory/:id/adjustments', async (c) => {
    try {
      const body = stockAdjustmentSchema.parse(await bodyOf(c));
      return c.json(await InventoryService.adjustStock(
        c.get('orgId'), uuid.parse(c.req.param('id')), body.countedQuantity, body.reason, c.get('userId'), body.idempotencyKey,
      ));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/inventory/:id/movements', async (c) => {
    try {
      return c.json({ movements: await InventoryService.getMovements(c.get('orgId'), uuid.parse(c.req.param('id'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/projects', async (c) => {
    try {
      return c.json({ projects: await ProjectService.getProjects(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/projects', async (c) => {
    try {
      const body = projectSchema.parse(await bodyOf(c));
      return c.json({ id: await ProjectService.createProject(c.get('orgId'), body) });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/projects/:id', async (c) => {
    try {
      const body = projectUpdateSchema.parse(await bodyOf(c));
      await ProjectService.updateProject(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/time-entries', async (c) => {
    try {
      return c.json({ entries: await ProjectService.getTimeEntries(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/time-entries', async (c) => {
    try {
      const raw = await bodyOf(c);
      if (raw.matterId !== undefined) {
        await assertLawEdition(c.get('orgId'));
        const body = lawTimeSchema.parse(raw);
        return c.json({ id: await MatterService.logTime(
          c.get('orgId'), body.matterId, c.get('userId'), body,
        ) });
      }
      const body = timeEntrySchema.parse(raw);
      return c.json({ id: await ProjectService.submitTimeEntry(c.get('orgId'), c.get('userId'), body as { projectId: string; entryDate: string; hours: number; description?: string }) });
    } catch (err) { return respondError(c, err); }
  });
}
