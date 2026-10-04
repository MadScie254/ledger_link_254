import { CreditNoteService, type CreditKind } from '../../src/server/creditNotes';
import { bodyOf, respondError, UserError } from '../http';
import {
  applyCreditSchema, customerCreditSchema, optionalUuid, refundCreditSchema, reverseCreditUseSchema,
  supplierCreditSchema, uuid, voidSchema,
} from '../schemas';
import type { Api } from './types';

type Input<K extends 'issueCustomerCredit' | 'recordSupplierCredit'> =
  Omit<Parameters<(typeof CreditNoteService)[K]>[0], 'orgId' | 'actor'>;

const KINDS: CreditKind[] = ['CUSTOMER', 'SUPPLIER'];

/** Credit notes to customers, credits from suppliers, and each use of one. */
export function registerCreditRoutes(api: Api) {
  api.get('/credits', async (c) => {
    try {
      const kind = c.req.query('kind');
      if (kind && !KINDS.includes(kind as CreditKind)) throw new UserError('Unknown kind of credit.');
      return c.json({
        credits: await CreditNoteService.list(c.get('orgId'), {
          kind: (kind as CreditKind) || undefined,
          customerId: optionalUuid.parse(c.req.query('customerId')),
          vendorId: optionalUuid.parse(c.req.query('vendorId')),
        }),
      });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/credit-notes', async (c) => {
    try {
      const body = customerCreditSchema.parse(await bodyOf(c)) as Input<'issueCustomerCredit'>;
      return c.json(await CreditNoteService.issueCustomerCredit({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/supplier-credits', async (c) => {
    try {
      const body = supplierCreditSchema.parse(await bodyOf(c)) as Input<'recordSupplierCredit'>;
      return c.json(await CreditNoteService.recordSupplierCredit({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/credits/:id/apply', async (c) => {
    try {
      const body = applyCreditSchema.parse(await bodyOf(c));
      return c.json(await CreditNoteService.apply({
        orgId: c.get('orgId'), creditId: uuid.parse(c.req.param('id')), documentId: body.documentId,
        amountCents: body.amountCents, date: body.date, actor: c.get('userId'), idempotencyKey: body.idempotencyKey,
      }));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/credits/:id/refund', async (c) => {
    try {
      const body = refundCreditSchema.parse(await bodyOf(c));
      return c.json(await CreditNoteService.refund({
        orgId: c.get('orgId'), creditId: uuid.parse(c.req.param('id')), amountCents: body.amountCents, date: body.date,
        moneyAccountId: body.moneyAccountId, reference: body.reference, actor: c.get('userId'), idempotencyKey: body.idempotencyKey,
      }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/credit-uses/:id/reverse', async (c) => {
    try {
      const body = reverseCreditUseSchema.parse(await bodyOf(c));
      return c.json(await CreditNoteService.reverseUse(c.get('orgId'), uuid.parse(c.req.param('id')), body.reversalDate, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/credits/:id/void', async (c) => {
    try {
      const body = voidSchema.parse(await bodyOf(c));
      return c.json(await CreditNoteService.void(c.get('orgId'), uuid.parse(c.req.param('id')), body.voidDate, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
}
