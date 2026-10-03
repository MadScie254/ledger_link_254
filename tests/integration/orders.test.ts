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
