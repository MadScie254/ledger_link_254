import { CashTransactionService, type CashKind } from '../../src/server/cashTransactions';

type Input<K extends 'recordSalesReceipt' | 'recordExpense' | 'recordTransfer'> =
  Omit<Parameters<(typeof CashTransactionService)[K]>[0], 'orgId' | 'actor'>;
import { bodyOf, respondError, UserError } from '../http';
import { expenseSchema, salesReceiptSchema, transferSchema, uuid, voidSchema } from '../schemas';
import type { Api } from './types';

const KINDS: CashKind[] = ['SALES_RECEIPT', 'EXPENSE', 'TRANSFER'];

/** Sales receipts, expenses and transfers: money in or out at once. */
export function registerCashRoutes(api: Api) {
  api.get('/cash-transactions', async (c) => {
    try {
      const kind = c.req.query('kind');
      if (kind && !KINDS.includes(kind as CashKind)) throw new UserError('Unknown kind of transaction.');
      return c.json({ transactions: await CashTransactionService.list(c.get('orgId'), (kind as CashKind) || undefined) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/sales-receipts', async (c) => {
    try {
      const body = salesReceiptSchema.parse(await bodyOf(c)) as Input<'recordSalesReceipt'>;
      return c.json(await CashTransactionService.recordSalesReceipt({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/expenses', async (c) => {
    try {
      const body = expenseSchema.parse(await bodyOf(c)) as Input<'recordExpense'>;
      return c.json(await CashTransactionService.recordExpense({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/transfers', async (c) => {
    try {
      const body = transferSchema.parse(await bodyOf(c)) as Input<'recordTransfer'>;
      return c.json(await CashTransactionService.recordTransfer({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }), 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/cash-transactions/:id/void', async (c) => {
    try {
      const body = voidSchema.parse(await bodyOf(c));
      return c.json(await CashTransactionService.void(c.get('orgId'), uuid.parse(c.req.param('id')), body.voidDate, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
}
