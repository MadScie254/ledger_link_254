// Documents as they are printed, read from the books through PostgREST: the
// figures as posted, a foreign invoice in its own currency, and only what a
// customer or supplier should see on each kind.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentPrintService } from '../../src/server/documentPrint';
import { OrganizationService } from '../../src/server/organizations';
import { InvoiceService } from '../../src/server/invoices';
import { CreditNoteService } from '../../src/server/creditNotes';
import { EstimateService } from '../../src/server/estimates';
import { SalesOrderService } from '../../src/server/salesOrders';
import { CashTransactionService } from '../../src/server/cashTransactions';
import { PurchaseOrderService } from '../../src/server/purchaseOrders';
import { buildDocumentPdf } from '../../src/utils/documentPdf';
import { ORG, OWNER, BANK, SALES, OPEX, CUSTOMER, VENDOR, CEMENT, sql, uuid, refused } from './helpers';

const pdfText = (model: Parameters<typeof buildDocumentPdf>[0]) => Buffer.from(buildDocumentPdf(model).output('arraybuffer')).toString('latin1');
const figures = (totals: Array<{ label: string; cents: number }>) => totals.map((total) => [total.label, total.cents]);

test('an invoice prints its lines, what was paid and credited, the balance and how to pay', async () => {
  await OrganizationService.updateOrganization(ORG, {
    paymentDetails: 'M-Pesa paybill 247247, account your invoice number.', documentFooter: 'Asante sana.', themeAccent: 'forest', taxId: 'P051234567X',
  });
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-02', dueDate: '2026-09-30', currency: 'KES', notes: 'Deliver to gate B',
    lines: [
      { description: 'Cement', accountId: SALES, amountCents: 100_000, taxCents: 16_000 },
      { description: 'Maize flour', accountId: SALES, amountCents: 20_000 },
    ],
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  await InvoiceService.receivePayment(ORG, invoiceId, { amountCents: 36_000, paymentDate: '2026-09-05', depositAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER });
  const credit = await CreditNoteService.issueCustomerCredit({
    orgId: ORG, customerId: CUSTOMER, invoiceId, date: '2026-09-06', memo: 'Price agreed down', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Discount on cement', accountId: SALES, quantity: 1, unitPriceCents: 10_000, taxRate: 0 }],
  });

  const printed = await DocumentPrintService.printModel(ORG, 'invoice', invoiceId);
  const number = sql(`SELECT invoice_number FROM public.invoices WHERE id = '${invoiceId}'`);
  assert.equal(printed.title, 'Invoice', 'not a tax invoice until eTIMS signs it');
  assert.equal(printed.number, number);
  assert.equal(printed.currency, 'KES');
  assert.equal(printed.accent, '#1F4B3A', 'the company\'s own accent');
  assert.equal(printed.company.taxId, 'P051234567X');
  assert.equal(printed.partyLabel, 'Bill to');
  assert.equal(printed.party?.name, 'Acme');
  assert.deepEqual(printed.facts, [{ label: 'Date', value: '02/09/2026' }, { label: 'Due', value: '30/09/2026' }]);
  assert.deepEqual(printed.lines.map((line) => [line.description, line.amountCents, line.taxCents, line.taxRate]), [
    ['Cement', 100_000, 16_000, 16],
    ['Maize flour', 20_000, 0, 0],
  ]);
  assert.deepEqual(figures(printed.totals), [
    ['Subtotal', 120_000], ['VAT', 16_000], ['Total', 136_000], ['Paid', -36_000], ['Credit applied', -10_000], ['Balance due', 90_000],
  ]);
  assert.equal(printed.notes, 'Deliver to gate B');
  assert.equal(printed.paymentDetails, 'M-Pesa paybill 247247, account your invoice number.');
  assert.equal(printed.footer, 'Asante sana.');
  assert.equal(printed.stamp, null);
  assert.equal(printed.etims, null);
  const pdf = pdfText(printed);
  assert.ok(pdf.startsWith('%PDF-'), 'drawn as a PDF');
  assert.ok(pdf.includes('(KES 900.00)'), 'with the balance due');

  // The credit note it carried prints against the invoice, all of it used.
  const note = await DocumentPrintService.printModel(ORG, 'credit-note', credit.id);
  assert.equal(note.title, 'Credit note');
  assert.equal(note.partyLabel, 'Credit to');
  assert.deepEqual(note.facts, [{ label: 'Date', value: '06/09/2026' }, { label: 'Against invoice', value: number }]);
  assert.deepEqual(figures(note.totals), [['Subtotal', 10_000], ['VAT', 0], ['Total credit', 10_000], ['Used', -10_000], ['Credit remaining', 0]]);
  assert.equal(note.notes, 'Price agreed down');
  assert.equal(note.paymentDetails, null, 'nothing to pay on a credit note');

  // Paid in full: stamped, nothing due, no payment details.
  await InvoiceService.receivePayment(ORG, invoiceId, { amountCents: 90_000, paymentDate: '2026-09-20', depositAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER });
  const paid = await DocumentPrintService.printModel(ORG, 'invoice', invoiceId);
  assert.equal(paid.stamp, 'PAID');
  assert.deepEqual(paid.totals.at(-1), { label: 'Balance due', cents: 0, emphasis: 'balance' });
  assert.equal(paid.paymentDetails, null);

  // Signed by eTIMS, it becomes a tax invoice carrying the control code.
  sql(`INSERT INTO public.etims_submissions (org_id, invoice_id, status, kra_control_code, qr_code_url)
       VALUES ('${ORG}', '${invoiceId}', 'VERIFIED', 'KRACU0100000123/7', 'https://etims.kra.go.ke/verify?d=1')`);
  const signed = await DocumentPrintService.printModel(ORG, 'invoice', invoiceId);
  assert.equal(signed.title, 'Tax invoice');
  assert.deepEqual(signed.etims, { controlCode: 'KRACU0100000123/7', qrCodeUrl: 'https://etims.kra.go.ke/verify?d=1' });
});

test('a foreign-currency invoice prints in its own currency, payments included', async () => {
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-08', dueDate: '2026-10-08', currency: 'USD', exchangeRate: 0.01,
    lines: [{ description: 'Export consignment', accountId: SALES, amountCents: 1_000_000, foreignAmountCents: 10_000, taxCents: 160_000 }],
    idempotencyKey: uuid(), createdBy: OWNER,
  });
  await InvoiceService.receivePayment(ORG, invoiceId, { amountCents: 580_000, paymentDate: '2026-09-10', depositAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER });

  const printed = await DocumentPrintService.printModel(ORG, 'invoice', invoiceId);
  assert.equal(printed.currency, 'USD');
  assert.deepEqual(printed.lines.map((line) => [line.amountCents, line.taxCents, line.taxRate]), [[10_000, 1_600, 16]]);
  assert.deepEqual(figures(printed.totals), [['Subtotal', 10_000], ['VAT', 1_600], ['Total', 11_600], ['Paid', -5_800], ['Balance due', 5_800]]);
  assert.ok(pdfText(printed).includes('(USD 58.00)'));
});

test('estimates, orders, receipts and purchase orders print from their own lines', async () => {
  const estimate = await EstimateService.saveEstimate({
    orgId: ORG, customerId: CUSTOMER, estimateDate: '2026-10-01', expiryDate: '2026-10-31', notes: 'Prices hold for 30 days', idempotencyKey: uuid(), actor: OWNER,
    lines: [{ description: 'Cement 50kg', accountId: SALES, inventoryItemId: CEMENT, quantity: 3, unitPriceCents: 75_000, taxRate: 16 }],
  });
  const quote = await DocumentPrintService.printModel(ORG, 'estimate', estimate.id);
  assert.equal(quote.title, 'Estimate');
  assert.equal(quote.number, estimate.estimateNumber);
  assert.deepEqual(quote.facts, [{ label: 'Date', value: '01/10/2026' }, { label: 'Valid until', value: '31/10/2026' }]);
  assert.deepEqual(quote.lines, [{ description: 'Cement 50kg', quantity: 3, unitPriceCents: 75_000, taxRate: 16, amountCents: 225_000, taxCents: 36_000 }]);
  assert.deepEqual(quote.totals.at(-1), { label: 'Total', cents: 261_000, emphasis: 'total' });
  assert.ok(quote.paymentDetails, 'how to pay is on an estimate');

  const order = await SalesOrderService.createOrder({
    orgId: ORG, customerId: CUSTOMER, orderDate: '2026-10-02', promisedDate: '2026-10-05', notes: 'Gate B', idempotencyKey: uuid(), createdBy: OWNER,
    lines: [{ description: 'Delivery', accountId: SALES, quantity: 1, unitPriceCents: 50_000, taxRate: 0 }],
  });
  assert.equal((await DocumentPrintService.printModel(ORG, 'sales-order', order.id)).stamp, null);
  await SalesOrderService.setStatus(ORG, order.id, 'CANCELLED', 'Customer changed their mind', OWNER);
  const cancelled = await DocumentPrintService.printModel(ORG, 'sales-order', order.id);
  assert.equal(cancelled.stamp, 'CANCELLED');
  assert.equal(cancelled.paymentDetails, null);
  assert.deepEqual(cancelled.facts, [{ label: 'Date', value: '02/10/2026' }, { label: 'Promised by', value: '05/10/2026' }]);

  const receipt = await CashTransactionService.recordSalesReceipt({
    orgId: ORG, payeeName: 'Walk-in', date: '2026-09-15', depositAccountId: BANK, reference: 'QJK7', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Nails', accountId: SALES, quantity: 2, unitPriceCents: 5_000, taxRate: 16 }],
  });
  const sale = await DocumentPrintService.printModel(ORG, 'sales-receipt', receipt.id);
  assert.equal(sale.party?.name, 'Walk-in');
  assert.equal(sale.stamp, 'PAID');
  assert.deepEqual(sale.facts, [
    { label: 'Date', value: '15/09/2026' },
    { label: 'Paid into', value: sql(`SELECT name FROM public.accounts WHERE id = '${BANK}'`) },
    { label: 'Reference', value: 'QJK7' },
  ]);
  assert.deepEqual(figures(sale.totals), [['Subtotal', 10_000], ['VAT', 1_600], ['Total paid', 11_600]]);
  await CashTransactionService.void(ORG, receipt.id, '2026-09-16', 'Rang up twice', OWNER);
  assert.equal((await DocumentPrintService.printModel(ORG, 'sales-receipt', receipt.id)).stamp, 'VOID');

  const po = await PurchaseOrderService.save({
    orgId: ORG, vendorId: VENDOR, orderDate: '2026-10-01', expectedDate: '2026-10-08', memo: 'To the yard', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Cement 50kg', accountId: OPEX, inventoryItemId: CEMENT, quantity: 6, unitCostCents: 70_000, taxRate: 16 }],
  });
  const purchase = await DocumentPrintService.printModel(ORG, 'purchase-order', po.id);
  assert.equal(purchase.title, 'Purchase order');
  assert.equal(purchase.partyLabel, 'Supplier');
  assert.equal(purchase.party?.name, 'Kenya Power');
  assert.equal(purchase.priceLabel, 'Unit cost');
  assert.deepEqual(purchase.lines[0], { description: 'Cement 50kg', quantity: 6, unitPriceCents: 70_000, taxRate: 16, amountCents: 420_000, taxCents: 67_200 });
  assert.equal(purchase.paymentDetails, null, 'a supplier is not told how to pay us');
  assert.equal(purchase.notes, 'To the yard');
});

test('only documents a customer or supplier receives print, and only this organization\'s', async () => {
  const expense = await CashTransactionService.recordExpense({
    orgId: ORG, vendorId: VENDOR, date: '2026-09-16', paidFromAccountId: BANK, actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Tokens', accountId: OPEX, amountCents: 10_000, taxCents: 1_600 }],
  });
  await refused(DocumentPrintService.printModel(ORG, 'sales-receipt', expense.id), /Sales receipt not found/);

  const supplierCredit = await CreditNoteService.recordSupplierCredit({
    orgId: ORG, vendorId: VENDOR, date: '2026-09-17', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Overcharge', accountId: OPEX, amountCents: 5_000 }],
  });
  await refused(DocumentPrintService.printModel(ORG, 'credit-note', supplierCredit.id), /Credit note not found/);

  await refused(DocumentPrintService.printModel(ORG, 'invoice', uuid()), /Invoice not found in this organization/);
  const otherOrg = uuid();
  const invoiceId = sql(`SELECT id FROM public.invoices WHERE org_id = '${ORG}' LIMIT 1`);
  await refused(DocumentPrintService.printModel(otherOrg, 'invoice', invoiceId), /not found/);
});
