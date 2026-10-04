// End-to-end checks of SalesOrderService through PostgREST against a local
// Postgres with every migration applied and the shared fixture loaded.
import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesOrderService } from '../../src/server/salesOrders';
import { InvoiceService } from '../../src/server/invoices';

import { ORG, OWNER, SALES, CUSTOMER, CEMENT, DELIVERY, sql } from './helpers';

const stock = (id: string) => Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${id}'`));

let orderId = '';
let orderNumber = '';

test('an order is recorded and listed with its customer, lines and stock items', async () => {
  const key = crypto.randomUUID();
  const input = {
    orgId: ORG, customerId: CUSTOMER, orderDate: '2026-10-02', promisedDate: '2026-10-05',
    notes: 'Deliver to site gate B', idempotencyKey: key, createdBy: OWNER,
    lines: [
      { description: 'Cement 50kg', accountId: SALES, inventoryItemId: CEMENT, quantity: 2, unitPriceCents: 75_000, taxRate: 16 },
      { description: 'Delivery', accountId: SALES, inventoryItemId: DELIVERY, quantity: 1, unitPriceCents: 50_000, taxRate: 0 },
      { description: 'Labour', accountId: SALES, quantity: 1.5, unitPriceCents: 2_001 },
    ],
  };
  const created = await SalesOrderService.createOrder(input);
  assert.match(created.orderNumber, /^SO-2026-\d{5}$/);
  assert.equal(created.totalCents, 150_000 + 24_000 + 50_000 + 3_002);
  orderId = created.id;
  orderNumber = created.orderNumber;

  // A retry with the same key returns the same order rather than a second one.
  const replay = await SalesOrderService.createOrder(input);
  assert.equal(replay.id, created.id);

  const orders = await SalesOrderService.getOrders(ORG);
  const order = orders.find((o) => o.id === orderId)!;
  assert.ok(order, 'the new order is listed');
  assert.equal(order.status, 'OPEN');
  assert.equal(order.customerName, sql(`SELECT display_name FROM public.customers WHERE id = '${CUSTOMER}'`));
  assert.equal(order.promisedDate, '2026-10-05');
  assert.equal(order.notes, 'Deliver to site gate B');
  assert.equal(order.invoiceNumber, null);
  assert.deepEqual(order.lines.map((l) => [l.description, l.quantity, l.amountCents, l.taxCents, l.itemName, l.itemType]), [
    ['Cement 50kg', 2, 150_000, 24_000, 'Cement 50kg', 'Physical Product'],
    ['Delivery', 1, 50_000, 0, 'Delivery', 'Digital Service'],
    ['Labour', 1.5, 3_002, 0, null, null],
  ]);
  assert.equal(order.lines[0].quantityOnHand, 5);
});

test('a bad order is refused with a readable reason', async () => {
  await assert.rejects(SalesOrderService.createOrder({
    orgId: ORG, customerId: CUSTOMER, orderDate: '2026-10-02', idempotencyKey: crypto.randomUUID(), createdBy: OWNER,
    lines: [{ description: 'Cement', accountId: SALES, inventoryItemId: CEMENT, quantity: 1.5, unitPriceCents: 75_000 }],
  }), (err: any) => /whole/i.test(err.message));
});

test('start, complete, reopen and complete again move stock exactly once each way', async () => {
  assert.equal((await SalesOrderService.setStatus(ORG, orderId, 'IN_PROGRESS', undefined, OWNER)).status, 'IN_PROGRESS');
  assert.equal(stock(CEMENT), 5);

  const done = await SalesOrderService.setStatus(ORG, orderId, 'COMPLETED', undefined, OWNER);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(stock(CEMENT), 3);
  assert.equal(stock(DELIVERY), 0, 'services are not counted');
  assert.deepEqual(done.stockChanges.map((c) => [c.itemId, c.quantity, c.quantityOnHand]), [[CEMENT, -2, 3]]);

  // Asking again is a no-op, not a second deduction.
  await SalesOrderService.setStatus(ORG, orderId, 'COMPLETED', undefined, OWNER);
  assert.equal(stock(CEMENT), 3);

  const reopened = await SalesOrderService.setStatus(ORG, orderId, 'IN_PROGRESS', undefined, OWNER);
  assert.equal(reopened.status, 'IN_PROGRESS');
  assert.equal(stock(CEMENT), 5);

  await SalesOrderService.setStatus(ORG, orderId, 'COMPLETED', undefined, OWNER);
  assert.equal(stock(CEMENT), 3);
  const listed = (await SalesOrderService.getOrders(ORG)).find((o) => o.id === orderId)!;
  assert.equal(listed.status, 'COMPLETED');
  assert.ok(listed.completedAt);
  assert.equal(listed.lines[0].quantityOnHand, 3);
});

test('invoicing an order posts one invoice and shows it on the order', async () => {
  const first = await SalesOrderService.invoiceOrder(ORG, orderId, '2026-10-02', '2026-11-01', OWNER);
  assert.match(first.invoiceNumber, /^INV-/);
  const again = await SalesOrderService.invoiceOrder(ORG, orderId, '2026-10-02', '2026-11-01', OWNER);
  assert.equal(again.invoiceId, first.invoiceId, 'a second click returns the same invoice');

  const listed = (await SalesOrderService.getOrders(ORG)).find((o) => o.id === orderId)!;
  assert.equal(listed.invoiceNumber, first.invoiceNumber);
  assert.ok(listed.invoiceStatus && listed.invoiceStatus !== 'VOID');

  const invoices = await InvoiceService.getInvoices(ORG);
  const invoice = (invoices as any[]).find((i) => i.id === first.invoiceId);
  assert.equal(invoice.totalCents, 227_002);

  const [lineCount, balance] = sql(`SELECT count(*) || '|' || coalesce(sum(debit) - sum(credit), -1) FROM public.journal_lines jl JOIN public.journal_entries je ON je.id = jl.journal_entry_id WHERE je.org_id = '${ORG}' AND je.source_id = '${first.invoiceId}'`).split('|').map(Number);
  assert.ok(lineCount >= 3, 'the invoice posted a journal entry');
  assert.equal(balance, 0, 'the invoice journal balances');

  // Every count change is a movement: the opening count, then out, back, out.
  const movements = sql(`SELECT string_agg(source_type || ':' || quantity, ',' ORDER BY created_at, id) FROM public.inventory_movements WHERE item_id = '${CEMENT}'`);
  assert.equal(movements, 'OPENING:5,SALES_ORDER:-2,SALES_ORDER:2,SALES_ORDER:-2');

  // Cancelling is refused while the invoice stands.
  await assert.rejects(SalesOrderService.setStatus(ORG, orderId, 'IN_PROGRESS', undefined, OWNER).then(() =>
    SalesOrderService.setStatus(ORG, orderId, 'CANCELLED', 'Customer withdrew', OWNER)), (err: any) => /invoice/i.test(err.message));
});

test('an order whose invoice was voided can be invoiced again', async () => {
  const listed = (await SalesOrderService.getOrders(ORG)).find((o) => o.id === orderId)!;
  const firstInvoiceId = sql(`SELECT invoice_id FROM public.sales_orders WHERE id = '${orderId}'`);
  await InvoiceService.voidInvoice(ORG, firstInvoiceId, OWNER, '2026-10-03');
  const second = await SalesOrderService.invoiceOrder(ORG, orderId, '2026-10-03', '2026-11-02', OWNER);
  assert.notEqual(second.invoiceId, firstInvoiceId);
  assert.notEqual(second.invoiceNumber, listed.invoiceNumber);
  const relisted = (await SalesOrderService.getOrders(ORG)).find((o) => o.id === orderId)!;
  assert.equal(relisted.invoiceNumber, second.invoiceNumber);
  assert.notEqual(relisted.invoiceStatus, 'VOID');
});

test('cancelling needs a reason and is final', async () => {
  const created = await SalesOrderService.createOrder({
    orgId: ORG, customerId: CUSTOMER, orderDate: '2026-10-02', idempotencyKey: crypto.randomUUID(), createdBy: OWNER,
    lines: [{ description: 'Cement 50kg', accountId: SALES, inventoryItemId: CEMENT, quantity: 1, unitPriceCents: 75_000 }],
  });
  await assert.rejects(SalesOrderService.setStatus(ORG, created.id, 'CANCELLED', '  ', OWNER), (err: any) => /reason/i.test(err.message));
  const cancelled = await SalesOrderService.setStatus(ORG, created.id, 'CANCELLED', 'Customer withdrew', OWNER);
  assert.equal(cancelled.status, 'CANCELLED');
  await assert.rejects(SalesOrderService.setStatus(ORG, created.id, 'IN_PROGRESS', undefined, OWNER));
  await assert.rejects(SalesOrderService.invoiceOrder(ORG, created.id, '2026-10-02', '2026-11-01', OWNER), (err: any) => /cancel/i.test(err.message));
  const listed = (await SalesOrderService.getOrders(ORG)).find((o) => o.id === created.id)!;
  assert.equal(listed.cancelReason, 'Customer withdrew');
});

test('the list reads past PostgREST\'s 1,000-row page', async () => {
  sql(`INSERT INTO public.sales_orders (org_id, order_number, customer_id, order_date, currency, subtotal_cents, total_cents, idempotency_key)
       SELECT '${ORG}', 'SO-BULK-' || g, '${CUSTOMER}', DATE '2026-01-01' + (g % 200), 'KES', 100, 100, 'bulk-' || g
       FROM generate_series(1, 1205) g`);
  const expected = Number(sql(`SELECT count(*) FROM public.sales_orders WHERE org_id = '${ORG}'`));
  assert.ok(expected > 1_200);
  const orders = await SalesOrderService.getOrders(ORG);
  assert.equal(orders.length, expected);
  assert.equal(new Set(orders.map((o) => o.id)).size, expected, 'no order is listed twice');
  assert.equal(orders[0].orderDate >= orders[orders.length - 1].orderDate, true, 'newest first');
  assert.ok(orders.some((o) => o.orderNumber === orderNumber));
});

import { EstimateService } from '../../src/server/estimates';

test('an estimate is saved, edited, accepted and converted through the service', async () => {
  const key = crypto.randomUUID();
  const input = {
    orgId: ORG, customerId: CUSTOMER, estimateDate: '2026-10-01', expiryDate: '2026-10-31', idempotencyKey: key, actor: OWNER,
    lines: [{ description: 'Cement 50kg', accountId: SALES, inventoryItemId: CEMENT, quantity: 3, unitPriceCents: 75_000, taxRate: 16 }],
  };
  const saved = await EstimateService.saveEstimate(input);
  assert.match(saved.estimateNumber, /^EST-2026-\d{5}$/);
  assert.equal((await EstimateService.saveEstimate(input)).id, saved.id);

  await EstimateService.saveEstimate({ ...input, lines: [{ ...input.lines[0], quantity: 4 }] }, saved.id);
  let [estimate] = (await EstimateService.getEstimates(ORG)).filter((e) => e.id === saved.id);
  assert.equal(estimate.totalCents, 348_000);
  assert.equal(estimate.lines[0].itemName, 'Cement 50kg');

  await EstimateService.setStatus(ORG, saved.id, 'ACCEPTED', undefined, OWNER);
  const converted = await EstimateService.convert(ORG, saved.id, 'INVOICE', '2026-10-02', '2026-11-01', OWNER);
  assert.match(converted.number, /^INV-/);
  [estimate] = (await EstimateService.getEstimates(ORG)).filter((e) => e.id === saved.id);
  assert.equal(estimate.status, 'CONVERTED');
  assert.equal(estimate.invoiceNumber, converted.number);
  await assert.rejects(EstimateService.saveEstimate(input, saved.id), (err: any) => /converted/.test(err.message));
});

import { PurchaseOrderService } from '../../src/server/purchaseOrders';
import { BillService } from '../../src/server/bills';
import { VENDOR, OPEX, uuid, refused } from './helpers';

test('a purchase order is billed in two parts, lists its bills, and a voided bill reopens it', async () => {
  const before = stock(CEMENT);
  const po = await PurchaseOrderService.save({
    orgId: ORG, vendorId: VENDOR, orderDate: '2026-10-01', expectedDate: '2026-10-08', memo: 'To the yard', actor: OWNER, idempotencyKey: uuid(),
    lines: [
      { description: 'Cement 50kg', accountId: OPEX, inventoryItemId: CEMENT, quantity: 6, unitCostCents: 70_000, taxRate: 16 },
      { description: 'Delivery', accountId: OPEX, quantity: 1, unitCostCents: 3_000 },
    ],
  });
  assert.match(po.number, /^PO-2026-/);
  assert.equal(po.totalCents, 420_000 + 67_200 + 3_000);

  const first = await PurchaseOrderService.bill({
    orgId: ORG, id: po.id, billDate: '2026-10-03', dueDate: '2026-11-02', supplierReference: 'KP-1001',
    quantities: [{ position: 1, quantity: 2 }, { position: 2, quantity: 0 }], actor: OWNER, idempotencyKey: uuid(),
  });
  assert.equal(first.status, 'OPEN');
  assert.equal(stock(CEMENT), before + 2);
  await refused(PurchaseOrderService.save({
    orgId: ORG, id: po.id, vendorId: VENDOR, orderDate: '2026-10-01', actor: OWNER,
    lines: [{ description: 'x', accountId: OPEX, quantity: 1, unitCostCents: 100 }],
  }), /can no longer be changed/);

  const second = await PurchaseOrderService.bill({
    orgId: ORG, id: po.id, billDate: '2026-10-05', dueDate: '2026-11-04', actor: OWNER, idempotencyKey: uuid(),
  });
  assert.equal(second.status, 'BILLED');
  assert.equal(stock(CEMENT), before + 6);

  const listed = (await PurchaseOrderService.list(ORG, { vendorId: VENDOR })).find((o) => o.id === po.id)!;
  assert.equal(listed.vendorName, 'Kenya Power');
  assert.equal(listed.status, 'BILLED');
  assert.deepEqual(listed.lines.map((l) => [l.quantityBilled, l.quantity]), [[6, 6], [1, 1]]);
  assert.deepEqual(listed.bills.map((b) => b.billNumber).sort(), [first.billNumber, second.billNumber].sort());
  assert.equal((await BillService.getBill(ORG, second.billId))!.purchaseOrderId, po.id);

  await BillService.voidBill(ORG, second.billId, OWNER, '2026-10-06');
  const reopened = (await PurchaseOrderService.list(ORG)).find((o) => o.id === po.id)!;
  assert.equal(reopened.status, 'OPEN');
  assert.deepEqual(reopened.lines.map((l) => l.quantityBilled), [2, 0]);
  assert.equal(stock(CEMENT), before + 2);

  await refused(PurchaseOrderService.setStatus(ORG, po.id, 'CLOSED', ' ', OWNER), /reason/);
  assert.equal((await PurchaseOrderService.setStatus(ORG, po.id, 'CLOSED', 'Supplier out of stock', OWNER)).status, 'CLOSED');
});
