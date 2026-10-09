import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oldestDueFirst, shareOldestFirst } from './customerPayments.ts';

const invoices = [
  { id: 'c', invoiceNo: 'INV-3', date: '2026-09-20', dueDate: '2026-10-20', amountDueCents: 30_000 },
  { id: 'a', invoiceNo: 'INV-1', date: '2026-08-01', dueDate: '2026-08-31', amountDueCents: 10_000 },
  { id: 'b', invoiceNo: 'INV-2', date: '2026-09-01', dueDate: null, amountDueCents: 20_000 },
  { id: 'd', invoiceNo: 'INV-4', date: '2026-09-05', dueDate: '2026-10-05', amountDueCents: 0 },
];

test('invoices are taken oldest due first; one with no due date comes last', () => {
  assert.deepEqual(oldestDueFirst(invoices).map((i) => i.invoiceNo), ['INV-1', 'INV-4', 'INV-3', 'INV-2']);
});

test('a payment pays the oldest in full, part pays the next, and keeps nothing over', () => {
  assert.deepEqual(shareOldestFirst(invoices, 25_000), {
    shares: [
      { invoiceId: 'a', invoiceNo: 'INV-1', amountCents: 10_000, paysInFull: true },
      { invoiceId: 'c', invoiceNo: 'INV-3', amountCents: 15_000, paysInFull: false },
    ],
    creditCents: 0,
  });
});

test('more than is owed is kept as credit, and invoices dated after the payment are left alone', () => {
  const all = shareOldestFirst(invoices, 70_000);
  assert.equal(all.shares.length, 3);
  assert.equal(all.creditCents, 10_000);
  const early = shareOldestFirst(invoices, 70_000, '2026-08-15');
  assert.deepEqual(early.shares.map((s) => s.invoiceNo), ['INV-1']);
  assert.equal(early.creditCents, 60_000);
  assert.deepEqual(shareOldestFirst(invoices, 0), { shares: [], creditCents: 0 });
});
