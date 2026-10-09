// Foreign-currency invoices and bills settled at the day's rate, through the
// services and PostgREST: the receivable or payable clears at its booked
// rate and the difference posts to 8100 as a realized gain or loss.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InvoiceService } from '../../src/server/invoices';
import { BillService } from '../../src/server/bills';
import { ORG, OWNER, CUSTOMER, VENDOR, BANK, SALES, OPEX, sql, uuid, refused } from './helpers';

const fxBalance = () => Number(sql(`SELECT COALESCE(sum(l.credit - l.debit), 0) FROM public.journal_lines l
  JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${ORG}' AND a.code = '8100'`));

test('a dollar invoice paid in two parts realizes a loss, then a gain', async () => {
  // USD 1,000 booked at KES 100 to the dollar.
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'USD', exchangeRate: 0.01,
    lines: [{ description: 'Export consultancy', accountId: SALES, amountCents: 10_000_000, foreignAmountCents: 100_000 }],
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  // USD 400 that came to KES 39,200: KES 800 short of the booked KES 40,000.
  const first = await InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 3_920_000, foreignAmountCents: 40_000, paymentDate: '2026-09-15', depositAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal(first.status, 'PARTIALLY_PAID');
  assert.equal(first.amountDueCents, 6_000_000);
  await refused(InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 6_000_000, foreignAmountCents: 60_001, paymentDate: '2026-09-20', depositAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  }), /still owing/);
  // The other USD 600 came to KES 61,800: KES 1,800 more than booked.
  const second = await InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 6_180_000, foreignAmountCents: 60_000, paymentDate: '2026-09-25', depositAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal(second.status, 'PAID');
  assert.equal(fxBalance(), 100_000);

  const invoice = await InvoiceService.getInvoice(ORG, invoiceId);
  assert.deepEqual(invoice.payments.map((payment: any) => [payment.amountCents, payment.foreignAmountCents, payment.realizedFxCents]).sort(),
    [[3_920_000 + 80_000, 40_000, -80_000], [6_180_000 - 180_000, 60_000, 180_000]].sort());
  assert.equal(invoice.amountDueCents, 0);
});

test('a dollar bill paid at a dearer rate realizes a loss, and a shilling bill is refused', async () => {
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-02', dueDate: '2026-09-30', currency: 'USD', exchangeRate: 0.01,
    lines: [{ description: 'Software licence', accountId: OPEX, amountCents: 5_000_000, foreignAmountCents: 50_000 } as any],
    idempotencyKey: uuid(), createdBy: OWNER,
  } as any);
  const before = fxBalance();
  // USD 500 that cost KES 51,000 against KES 50,000 booked.
  const paid = await BillService.recordPayment(ORG, billId, {
    amountCents: 5_100_000, foreignAmountCents: 50_000, paymentDate: '2026-09-28', sourceAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal(paid.status, 'PAID');
  assert.equal(fxBalance() - before, -100_000);
  assert.equal(sql(`SELECT realized_fx_cents FROM public.bill_payments WHERE bill_id = '${billId}'`), '-100000');

  const shillings = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-03', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Stationery', accountId: OPEX, amountCents: 20_000 } as any], idempotencyKey: uuid(), createdBy: OWNER,
  } as any);
  await refused(BillService.recordPayment(ORG, shillings, {
    amountCents: 20_000, foreignAmountCents: 20_000, paymentDate: '2026-09-04', sourceAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER,
  }), /usual way/);
  assert.equal(Number(sql(`SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = '${ORG}'`)), 0);
});
