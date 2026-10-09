// Tax withheld at payment, through the services and PostgREST: an invoice
// paid net of income tax and VAT the customer withheld, printed with both,
// and a bill paid net of tax this business owes to KRA.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InvoiceService } from '../../src/server/invoices';
import { BillService } from '../../src/server/bills';
import { DocumentPrintService } from '../../src/server/documentPrint';
import { ORG, OWNER, CUSTOMER, VENDOR, BANK, SALES, OPEX, sql, uuid, refused } from './helpers';

const balance = (code: string) => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l
  JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${ORG}' AND a.code = '${code}'`));

test('an invoice paid net of tax withheld settles in full and prints what was withheld', async () => {
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Consultancy', accountId: SALES, amountCents: 10_000_000, taxCents: 1_600_000 } as any],
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  await refused(InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 10_900_000, whtCents: 500_000, wvatCents: 200_000, paymentDate: '2026-09-20', depositAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  }), /withholding tax certificate/);
  const paid = await InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 10_900_000, whtCents: 500_000, wvatCents: 200_000, whtCertificate: 'WHT-0001', wvatCertificate: 'WVAT-0001',
    paymentDate: '2026-09-20', depositAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal(paid.status, 'PAID');
  assert.equal(balance('1170'), 500_000);
  assert.equal(balance('1175'), 200_000);
  const printed = await DocumentPrintService.printModel(ORG, 'invoice', invoiceId);
  assert.deepEqual(printed.totals.map((total) => [total.label, total.cents]), [
    ['Subtotal', 10_000_000], ['VAT', 1_600_000], ['Total', 11_600_000],
    ['Paid', -10_900_000], ['Income tax withheld', -500_000], ['VAT withheld', -200_000], ['Balance due', 0],
  ]);
  assert.equal(printed.stamp, 'PAID');
});

test('a bill paid net of tax withheld leaves the tax owed to KRA', async () => {
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-02', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Audit fees', accountId: OPEX, amountCents: 5_000_000, taxCents: 800_000 } as any],
    idempotencyKey: uuid(), createdBy: OWNER,
  } as any);
  await refused(BillService.recordPayment(ORG, billId, {
    amountCents: 5_500_000, whtCents: 250_000, wvatCents: 100_000, paymentDate: '2026-09-25', sourceAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  }), /exceed|more than is due/);
  const paid = await BillService.recordPayment(ORG, billId, {
    amountCents: 5_450_000, whtCents: 250_000, wvatCents: 100_000, paymentDate: '2026-09-25', sourceAccountId: BANK,
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal(paid.status, 'PAID');
  assert.equal(-balance('2150'), 250_000);
  assert.equal(-balance('2155'), 100_000);
  assert.equal(sql(`SELECT wht_cents || ':' || wvat_cents FROM public.bill_payments WHERE bill_id = '${billId}'`), '250000:100000');
  // A payment without withholding still goes through the plain path.
  const plain = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-03', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Stationery', accountId: OPEX, amountCents: 20_000 } as any], idempotencyKey: uuid(), createdBy: OWNER,
  } as any);
  assert.equal((await BillService.recordPayment(ORG, plain, { amountCents: 20_000, paymentDate: '2026-09-04', sourceAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER })).status, 'PAID');
  assert.equal(Number(sql(`SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = '${ORG}'`)), 0);
});
