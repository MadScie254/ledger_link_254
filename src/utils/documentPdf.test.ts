import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentPdf } from './documentPdf.ts';
import { latin1, printFileName, printedDate, printedMoney, printedQuantity, rateOf, type PrintDocument } from './printDocument.ts';

const invoice = (overrides: Partial<PrintDocument> = {}): PrintDocument => ({
  kind: 'invoice',
  title: 'Invoice',
  number: 'INV-0001',
  currency: 'KES',
  stamp: null,
  accent: '#1F4B3A',
  company: {
    name: 'Mama Mboga Traders',
    legalName: 'Mama Mboga Traders Limited',
    taxId: 'P051234567X',
    address: 'Moi Avenue\nShop 4',
    city: 'Nairobi',
    phone: '0712 345 678',
    email: 'sales@mamamboga.co.ke',
    website: null,
  },
  partyLabel: 'Bill to',
  party: { name: 'Acme Hardware', legalName: null, address: 'Industrial Area', city: 'Nairobi', kraPin: 'P000111222Q', email: null, phone: null },
  facts: [{ label: 'Date', value: '02/09/2026' }, { label: 'Due', value: '30/09/2026' }],
  priceLabel: 'Unit price',
  lines: [
    { description: 'Cement, 50 kg', quantity: 2, unitPriceCents: 50000, taxRate: 16, amountCents: 100000, taxCents: 16000 },
    { description: 'Maize flour (zero-rated)', quantity: null, unitPriceCents: null, taxRate: 0, amountCents: 20000, taxCents: 0 },
  ],
  totals: [
    { label: 'Subtotal', cents: 120000 },
    { label: 'VAT', cents: 16000 },
    { label: 'Total', cents: 136000, emphasis: 'total' },
    { label: 'Paid', cents: -36000 },
    { label: 'Balance due', cents: 100000, emphasis: 'balance' },
  ],
  notes: 'Delivered to the site gate.',
  paymentDetails: 'Equity Bank, account 0123456789.\nM-Pesa paybill 247247, account INV-0001.',
  footer: 'Thank you for your business.',
  etims: null,
  ...overrides,
});

/** The PDF as text: jsPDF writes its page streams uncompressed. */
const pdfText = (model: PrintDocument) => Buffer.from(buildDocumentPdf(model).output('arraybuffer')).toString('latin1');

test('figures, dates, rates and quantities are printed the same everywhere', () => {
  assert.equal(printedMoney(116000), '1,160.00');
  assert.equal(printedMoney(123456789), '1,234,567.89');
  assert.equal(printedMoney(5), '0.05');
  assert.equal(printedMoney(-36000), '-360.00');
  assert.equal(printedDate('2026-09-02'), '02/09/2026');
  assert.equal(printedDate(null), '');
  assert.equal(rateOf(100000, 16000), 16);
  assert.equal(rateOf(333, 53), 16, 'rounded VAT on a small line still reads as 16%');
  assert.equal(rateOf(20000, 0), 0);
  assert.equal(rateOf(10000, 1250), 12.5);
  assert.equal(rateOf(0, 0), 0);
  assert.equal(printedQuantity(2), '2');
  assert.equal(printedQuantity(2.5), '2.5');
  assert.equal(printedQuantity(null), '');
  assert.equal(printFileName({ title: 'Tax invoice', number: 'INV/2026/0001' }), 'Tax-invoice-INV-2026-0001.pdf');
});

test('text is made drawable by the PDF fonts', () => {
  assert.equal(latin1('“Acme” – Ltd…'), '"Acme" - Ltd...');
  assert.equal(latin1('Zoë Café'), 'Zoë Café', 'Latin-1 letters are kept');
  assert.equal(latin1('Ābdi źri'), 'Abdi zri', 'accents outside Latin-1 are dropped');
  assert.equal(latin1('Paid ✅'), 'Paid ?');
});

test('an invoice prints its heading, lines, totals, how to pay and footer', () => {
  const text = pdfText(invoice());
  assert.ok(text.startsWith('%PDF-'), 'a PDF file');
  for (const expected of [
    '(Invoice)', '(INV-0001)', '(Amounts in KES)', '(Mama Mboga Traders)',
    '(BILL TO)', '(Acme Hardware)', '(KRA PIN P000111222Q)', '(02/09/2026)', '(30/09/2026)',
    '(Cement, 50 kg)', '(500.00)', '(16%)', '(160.00)', '(1,000.00)',
    '(Balance due)', '(KES 1,000.00)', '(-360.00)', '(KES 1,360.00)',
    '(HOW TO PAY)', '(M-Pesa paybill 247247, account INV-0001.)', '(Thank you for your business.)',
    '(Invoice INV-0001  ·  Page 1 of 1)',
  ]) {
    assert.ok(text.includes(expected), `prints ${expected}`);
  }
});

test('a stamp, a long list of lines and an eTIMS signature', () => {
  const lines = Array.from({ length: 70 }, (_, i) => ({
    description: `Item ${i + 1}`, quantity: 1, unitPriceCents: 1000, taxRate: 16, amountCents: 1000, taxCents: 160,
  }));
  const text = pdfText(invoice({
    title: 'Tax invoice',
    stamp: 'PAID',
    lines,
    etims: { controlCode: 'KRACU0100000123/45', qrCodeUrl: 'https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=1' },
  }));
  assert.ok(text.includes('(PAID)'), 'stamped paid');
  assert.ok(text.includes('(Item 70)'), 'the last line is printed');
  assert.ok(/Page 1 of [2-9]/.test(text), 'more than one page');
  assert.ok(text.includes('(Control unit invoice number KRACU0100000123/45)'), 'the eTIMS control code');
  assert.ok(text.includes('etims.kra.go.ke'), 'a link to check it');

  const unsafe = pdfText(invoice({ etims: { controlCode: 'X1', qrCodeUrl: 'javascript:alert(1)' } }));
  assert.ok(!unsafe.includes('javascript:'), 'only https links are written');
});
