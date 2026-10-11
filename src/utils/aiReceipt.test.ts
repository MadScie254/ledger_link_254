import assert from 'node:assert/strict';
import test from 'node:test';
import { currencyCode, matchVendorName, receiptExpenseLine, receiptFromModel } from './aiReceipt.ts';

test('a model reply becomes a receipt in hundredths', () => {
  const receipt = receiptFromModel({
    vendorName: 'MLANGO SUPERMARKET LTD', date: '2026-09-14', total: 1752.5, tax: 241.72, currency: 'KES',
    items: [{ description: 'Jogoo Maize Flour 2kg', quantity: 2, unitPrice: 189, lineTotal: 378 }],
  }, 'KES');
  assert.deepEqual(receipt, {
    vendorName: 'MLANGO SUPERMARKET LTD', date: '2026-09-14', totalAmountCents: 175250, taxAmountCents: 24172, currency: 'KES',
    items: [{ description: 'Jogoo Maize Flour 2kg', quantity: 2, unitPriceCents: 18900, totalPriceCents: 37800 }],
  });
});

test('a rupiah total written with a dot between thousands comes through as the model read it', () => {
  // The model gives 28000 for "28.000"; the conversion to hundredths is done here, not by the model.
  assert.equal(receiptFromModel({ total: 28000, currency: 'IDR' }, 'KES')?.totalAmountCents, 2_800_000);
});

test('a reply without a usable total is refused, and doubtful fields are dropped', () => {
  assert.equal(receiptFromModel({ vendorName: 'Shop', total: 0 }, 'KES'), null);
  assert.equal(receiptFromModel({ vendorName: 'Shop' }, 'KES'), null);
  assert.equal(receiptFromModel(null, 'KES'), null);
  const odd = receiptFromModel({ vendorName: 42, date: '31/02/2026', total: '500', tax: 900, currency: 'shillings', items: 'none' }, 'KES')!;
  assert.equal(odd.vendorName, '');
  assert.equal(odd.date, null);
  assert.equal(odd.totalAmountCents, 50_000);
  assert.equal(odd.taxAmountCents, null, 'tax larger than the total is not believed');
  assert.equal(odd.currency, 'KES');
  assert.deepEqual(odd.items, []);
});

test('KSh and Kshs are read as shillings', () => {
  assert.equal(currencyCode('KSh'), 'KES');
  assert.equal(currencyCode('Kshs.'), 'KES');
  assert.equal(currencyCode('usd'), 'USD');
  assert.equal(currencyCode('dollars'), null);
});

test('a receipt with 16% VAT fills the line with its net amount at 16%', () => {
  // KES 1,752.50 including VAT of 241.72: the line is 1,510.78 at 16%, which adds back to 1,752.50.
  assert.deepEqual(receiptExpenseLine({ totalAmountCents: 175_250, taxAmountCents: 24_172 }), { netCents: 151_078, taxRate: '16' });
  const net = 151_078;
  assert.equal(net + Math.round(net * 0.16), 175_250);
});

test('a receipt without VAT, or with VAT that is not 16%, goes in whole at no VAT', () => {
  assert.deepEqual(receiptExpenseLine({ totalAmountCents: 350_000, taxAmountCents: null }), { netCents: 350_000, taxRate: '0' });
  // 8% VAT on petroleum products in an older period: not the standard rate, so not split.
  assert.deepEqual(receiptExpenseLine({ totalAmountCents: 108_000, taxAmountCents: 8_000 }), { netCents: 108_000, taxRate: '0' });
});

test('the supplier on a receipt is matched loosely to a vendor', () => {
  const vendors = [{ id: 'v1', displayName: 'Bidii Hardware & Supplies' }, { id: 'v2', displayName: 'Kilima Energy' }];
  assert.equal(matchVendorName(vendors, 'BIDII HARDWARE AND SUPPLIES LTD')?.id, 'v1');
  assert.equal(matchVendorName(vendors, 'Kilima Energy Service Station')?.id, 'v2');
  assert.equal(matchVendorName(vendors, 'Pwani Grill'), undefined);
  assert.equal(matchVendorName(vendors, 'Co'), undefined);
});
