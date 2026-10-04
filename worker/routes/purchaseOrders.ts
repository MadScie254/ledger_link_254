import { PurchaseOrderService } from '../../src/server/purchaseOrders';
import { bodyOf, respondError, UserError } from '../http';
import { billPurchaseOrderSchema, optionalUuid, purchaseOrderSchema, purchaseOrderStatusSchema, uuid } from '../schemas';
import type { Api } from './types';

type SaveInput = Omit<Parameters<typeof PurchaseOrderService.save>[0], 'orgId' | 'actor' | 'id'>;

/** Orders placed with suppliers, and the bills made from them. */
export function registerPurchaseOrderRoutes(api: Api) {
  api.get('/purchase-orders', async (c) => {
    try {
      return c.json({ purchaseOrders: await PurchaseOrderService.list(c.get('orgId'), { vendorId: optionalUuid.parse(c.req.query('vendorId')) }) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/purchase-orders', async (c) => {
    try {
      const body = purchaseOrderSchema.parse(await bodyOf(c)) as SaveInput;
      if (!body.idempotencyKey) throw new UserError('Idempotency key is required.');
      return c.json(await PurchaseOrderService.save({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.put('/purchase-orders/:id', async (c) => {
    try {
      const body = purchaseOrderSchema.parse(await bodyOf(c)) as SaveInput;
      return c.json(await PurchaseOrderService.save({ ...body, id: uuid.parse(c.req.param('id')), orgId: c.get('orgId'), actor: c.get('userId') }));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/purchase-orders/:id/status', async (c) => {
    try {
      const body = purchaseOrderStatusSchema.parse(await bodyOf(c));
      return c.json(await PurchaseOrderService.setStatus(c.get('orgId'), uuid.parse(c.req.param('id')), body.status, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/purchase-orders/:id/bill', async (c) => {
    try {
      const body = billPurchaseOrderSchema.parse(await bodyOf(c));
      return c.json(await PurchaseOrderService.bill({
        orgId: c.get('orgId'), id: uuid.parse(c.req.param('id')), billDate: body.billDate, dueDate: body.dueDate,
        supplierReference: body.supplierReference, quantities: body.quantities as Array<{ position: number; quantity: number }> | undefined,
        actor: c.get('userId'), idempotencyKey: body.idempotencyKey,
      }), 201);
    } catch (err) { return respondError(c, err); }
  });
}
