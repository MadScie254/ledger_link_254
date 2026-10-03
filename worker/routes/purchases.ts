import { VendorService } from '../../src/server/vendors';
import { BillService, type BillBatchPaymentInput, type BillInput, type BillPaymentInput } from '../../src/server/bills';
import { bodyOf, respondError } from '../http';
import {
  batchBillPaymentSchema,
  billPaymentSchema,
  billUpdateSchema,
  createBillSchema,
  reversalSchema,
  uuid,
  vendorSchema,
  vendorUpdateSchema,
} from '../schemas';
import { requireOrganizationAdministrator } from '../auth';
import type { Api } from './types';

export function registerPurchaseRoutes(api: Api) {
  // --- Suppliers ---
  api.get('/vendors', async (c) => {
    try {
      return c.json({ vendors: await VendorService.getVendors(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/vendors', async (c) => {
    try {
      const body = vendorSchema.parse(await bodyOf(c));
      return c.json({ id: await VendorService.createVendor(c.get('orgId'), body) });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/vendors/:id', async (c) => {
    try {
      const body = vendorUpdateSchema.parse(await bodyOf(c));
      await VendorService.updateVendor(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  // --- Bills ---
  api.get('/bills', async (c) => {
    try {
      return c.json({ bills: await BillService.getBills(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/bills/:id', async (c) => {
    try {
      return c.json({ bill: await BillService.getBill(c.get('orgId'), uuid.parse(c.req.param('id'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/bills', async (c) => {
    try {
      const body = createBillSchema.parse(await bodyOf(c)) as Omit<BillInput, 'orgId' | 'createdBy'>;
      const id = await BillService.createBill({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
      return c.json({ id });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/bills/:id', async (c) => {
    try {
      await BillService.updateBill(c.get('orgId'), uuid.parse(c.req.param('id')), billUpdateSchema.parse(await bodyOf(c)));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/bills/:id/approve', requireOrganizationAdministrator, async (c) => {
    try {
      return c.json(await BillService.approveBill(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/bills/:id/payments', async (c) => {
    try {
      const billId = uuid.parse(c.req.param('id'));
      const body = billPaymentSchema.parse(await bodyOf(c)) as Omit<BillPaymentInput, 'createdBy'>;
      const payment = await BillService.recordPayment(c.get('orgId'), billId, { ...body, createdBy: c.get('userId') });
      return c.json(payment, 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/bills/:id/payments/:paymentId/reverse', async (c) => {
    try {
      const body = reversalSchema.parse(await bodyOf(c));
      return c.json(await BillService.reversePayment(
        c.get('orgId'), uuid.parse(c.req.param('id')), uuid.parse(c.req.param('paymentId')),
        body.reversalDate, body.reason, c.get('userId'),
      ));
    } catch (err) { return respondError(c, err); }
  });

  // Up to 40 bills per request, so a batch stays within the Worker's
  // subrequest budget; the screen sends larger selections in parts.
  api.post('/bills/batch-pay', async (c) => {
    try {
      const { payments } = batchBillPaymentSchema.parse(await bodyOf(c)) as { payments: BillBatchPaymentInput[] };
      return c.json(await BillService.recordBatchPayment(c.get('orgId'), payments, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
}
