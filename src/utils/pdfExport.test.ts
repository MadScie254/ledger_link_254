import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FinancialPDFEngine } from './pdfExport.ts';

test('formatAmount groups cents into a two-decimal amount, independent of currency', () => {
  assert.equal(FinancialPDFEngine.formatAmount(123456), '1,234.56');
  assert.equal(FinancialPDFEngine.formatAmount(0), '0.00');
  assert.equal(FinancialPDFEngine.formatAmount(100), '1.00');
});

test('formatAmount works the same whether the cents came from KES or a converted display currency', () => {
  // 1,234.56 KES converted to USD at a sample rate still formats the same way:
  // the caller converts the cents before calling this, the formatter itself
  // never assumes a currency.
  const usdCents = Math.round(123456 * 0.00775);
  assert.equal(FinancialPDFEngine.formatAmount(usdCents), (usdCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
});

test('formatKES is kept as a deprecated alias so existing callers still compile and behave the same', () => {
  assert.equal(FinancialPDFEngine.formatKES(123456), FinancialPDFEngine.formatAmount(123456));
});
