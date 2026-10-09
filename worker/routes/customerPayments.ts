import { CustomerPaymentService } from '../../src/server/customerPayments';
import { bodyOf, respondError } from '../http';
import { customerPaymentSchema, optionalUuid, reversalSchema, uuid } from '../schemas';
import type { Api } from './types';

/** Payments from customers across their invoices: listed, received, reversed. */
export function registerCustomerPaymentRoutes(api: Api) {
  api.get('/customer-payments', async (c) => {
    try {
      return c.json({
        payments: await CustomerPaymentService.list(c.get('orgId'), { customerId: optionalUuid.parse(c.req.query('customerId')) }),
      });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/customer-payments', async (c) => {
    try {
      const body = customerPaymentSchema.parse(await bodyOf(c));
      return c.json(await CustomerPaymentService.receive({
        orgId: c.get('orgId'), customerId: body.customerId, paymentDate: body.paymentDate, depositAccountId: body.depositAccountId,
        amountCents: body.amountCents, allocations: (body.allocations ?? null) as Array<{ invoiceId: string; amountCents: number }> | null, reference: body.reference, memo: body.memo,
        actor: c.get('userId'), idempotencyKey: body.idempotencyKey,
      }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/customer-payments/:id/reverse', async (c) => {
    try {
      const body = reversalSchema.parse(await bodyOf(c));
      return c.json(await CustomerPaymentService.reverse(c.get('orgId'), uuid.parse(c.req.param('id')), body.reversalDate, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
}
