import { CustomerService } from '../../src/server/customers';
import { InvoiceService, type InvoiceInput, type InvoicePaymentInput } from '../../src/server/invoices';
import { SalesOrderService, type SalesOrderInput } from '../../src/server/salesOrders';
import { EstimateService, type EstimateInput } from '../../src/server/estimates';
import { bodyOf, respondError, UserError } from '../http';
import {
  convertEstimateSchema,
  createInvoiceSchema,
  estimateSchema,
  estimateStatusSchema,
  createSalesOrderSchema,
  customerSchema,
  customerUpdateSchema,
  invoicePaymentSchema,
  invoiceSalesOrderSchema,
  invoiceUpdateSchema,
  reversalSchema,
  salesOrderStatusSchema,
  uuid,
} from '../schemas';
import type { Api } from './types';

export function registerSalesRoutes(api: Api) {
  // --- Customers ---
  api.get('/customers', async (c) => {
    try {
      return c.json({ customers: await CustomerService.getCustomers(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/customers', async (c) => {
    try {
      const body = customerSchema.parse(await bodyOf(c));
      return c.json({ id: await CustomerService.createCustomer(c.get('orgId'), body) });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/customers/:id', async (c) => {
    try {
      const body = customerUpdateSchema.parse(await bodyOf(c));
      await CustomerService.updateCustomer(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  // --- Invoices ---
  api.get('/invoices', async (c) => {
    try {
      const customerId = c.req.query('customerId');
      return c.json({ invoices: await InvoiceService.getInvoices(c.get('orgId'), { customerId: customerId ? uuid.parse(customerId) : undefined }) });
    } catch (err) { return respondError(c, err); }
  });

  api.get('/invoices/:id', async (c) => {
    try {
      return c.json({ invoice: await InvoiceService.getInvoice(c.get('orgId'), uuid.parse(c.req.param('id'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/invoices', async (c) => {
    try {
      const body = createInvoiceSchema.parse(await bodyOf(c)) as Omit<InvoiceInput, 'orgId' | 'createdBy'>;
      const id = await InvoiceService.createInvoice({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') });
      return c.json({ id });
    } catch (err) { return respondError(c, err); }
  });

  api.patch('/invoices/:id', async (c) => {
    try {
      const invoiceId = uuid.parse(c.req.param('id'));
      await InvoiceService.updateInvoice(c.get('orgId'), invoiceId, invoiceUpdateSchema.parse(await bodyOf(c)));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/invoices/:id/payments', async (c) => {
    try {
      const invoiceId = uuid.parse(c.req.param('id'));
      const body = invoicePaymentSchema.parse(await bodyOf(c)) as Omit<InvoicePaymentInput, 'createdBy'>;
      const payment = await InvoiceService.receivePayment(c.get('orgId'), invoiceId, { ...body, createdBy: c.get('userId') });
      return c.json(payment, 201);
    } catch (err) { return respondError(c, err); }
  });

  api.post('/invoices/:id/payments/:paymentId/reverse', async (c) => {
    try {
      const body = reversalSchema.parse(await bodyOf(c));
      return c.json(await InvoiceService.reversePayment(
        c.get('orgId'), uuid.parse(c.req.param('id')), uuid.parse(c.req.param('paymentId')),
        body.reversalDate, body.reason, c.get('userId'),
      ));
    } catch (err) { return respondError(c, err); }
  });

  // --- Sales orders ---
  // An order is recorded, moved through its statuses (completion counts stock
  // out, reopening counts it back) and invoiced in one step. Each write is one
  // Postgres function call, one transaction.
  api.get('/sales-orders', async (c) => {
    try {
      return c.json({ orders: await SalesOrderService.getOrders(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/sales-orders', async (c) => {
    try {
      const body = createSalesOrderSchema.parse(await bodyOf(c)) as Omit<SalesOrderInput, 'orgId' | 'createdBy'>;
      return c.json(await SalesOrderService.createOrder({ ...body, orgId: c.get('orgId'), createdBy: c.get('userId') }));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/sales-orders/:id/status', async (c) => {
    try {
      const orderId = uuid.parse(c.req.param('id'));
      const body = salesOrderStatusSchema.parse(await bodyOf(c));
      return c.json(await SalesOrderService.setStatus(c.get('orgId'), orderId, body.status, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/sales-orders/:id/invoice', async (c) => {
    try {
      const orderId = uuid.parse(c.req.param('id'));
      const body = invoiceSalesOrderSchema.parse(await bodyOf(c));
      return c.json(await SalesOrderService.invoiceOrder(c.get('orgId'), orderId, body.issueDate, body.dueDate, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  // --- Estimates ---
  // Quotes: saved, sent, accepted or declined, and converted to an invoice or
  // a sales order in one step. An estimate posts nothing.
  api.get('/estimates', async (c) => {
    try {
      return c.json({ estimates: await EstimateService.getEstimates(c.get('orgId')) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/estimates', async (c) => {
    try {
      const body = estimateSchema.parse(await bodyOf(c)) as Omit<EstimateInput, 'orgId' | 'actor'>;
      if (!body.idempotencyKey) throw new UserError('An idempotency key is required.');
      return c.json(await EstimateService.saveEstimate({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }));
    } catch (err) { return respondError(c, err); }
  });

  api.put('/estimates/:id', async (c) => {
    try {
      const estimateId = uuid.parse(c.req.param('id'));
      const body = estimateSchema.parse(await bodyOf(c)) as Omit<EstimateInput, 'orgId' | 'actor'>;
      return c.json(await EstimateService.saveEstimate({ ...body, orgId: c.get('orgId'), actor: c.get('userId') }, estimateId));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/estimates/:id/status', async (c) => {
    try {
      const body = estimateStatusSchema.parse(await bodyOf(c));
      return c.json(await EstimateService.setStatus(c.get('orgId'), uuid.parse(c.req.param('id')), body.status, body.reason, c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/estimates/:id/convert', async (c) => {
    try {
      const body = convertEstimateSchema.parse(await bodyOf(c));
      return c.json(await EstimateService.convert(
        c.get('orgId'), uuid.parse(c.req.param('id')), body.target, body.date,
        body.target === 'INVOICE' ? body.dueDate : undefined, c.get('userId'),
      ));
    } catch (err) { return respondError(c, err); }
  });
}
