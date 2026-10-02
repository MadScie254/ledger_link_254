import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelBlockedByInvoice,
  isStockedItemType,
  lineAmounts,
  nextStatuses,
  orderTotals,
  quantityProblem,
  stockEffects,
  taxRateProblem,
} from './salesOrders.ts';

test('line amounts round exactly as Postgres does, halves away from zero', () => {
  // 1.115 x 100 cents is 111.5, which rounds to 112. Floating point gives 111.4999…
  assert.deepEqual(lineAmounts('1.115', 100, '0'), { amountCents: 112, taxCents: 0 });
  // 1.5 x 20.01 = 30.015 -> 30.02, the SQL test's Labour line.
  assert.deepEqual(lineAmounts('1.5', 2001, '0'), { amountCents: 3002, taxCents: 0 });
  // 2 x 750.00 with 16% VAT.
  assert.deepEqual(lineAmounts('2', 75000, '16'), { amountCents: 150000, taxCents: 24000 });
  // VAT halves round up too: 16% of 3.13 is 0.5008 -> 1 cent; 16% of 0.03 is 0.0048 -> 0.
  assert.deepEqual(lineAmounts('1', 313, '16'), { amountCents: 313, taxCents: 50 });
  assert.deepEqual(lineAmounts('1', 3, '16'), { amountCents: 3, taxCents: 0 });
  assert.deepEqual(lineAmounts('1', 25, '2'), { amountCents: 25, taxCents: 1 }); // 0.5 -> 1
  assert.equal(lineAmounts('3', 100, '').taxCents, 0);
});

test('large lines stay exact', () => {
  // 999999.999 x 999999999 = 999,999,998,000,000.001. Expected values are
  // Postgres's own: round(999999.999 * 999999999) and round(that * 16.5 / 100).
  assert.deepEqual(lineAmounts('999999.999', 999_999_999, '16.5'), {
    amountCents: 999_999_998_000_000,
    taxCents: 164_999_999_670_000,
  });
});

test('bad input is refused rather than guessed', () => {
  assert.throws(() => lineAmounts('-1', 100, '0'));
  assert.throws(() => lineAmounts('1e3', 100, '0'));
  assert.throws(() => lineAmounts('1', 1.5, '0'));
  assert.throws(() => lineAmounts('1', 100, 'abc'));
});

test('totals add lines and VAT', () => {
  assert.deepEqual(orderTotals([
    { amountCents: 150000, taxCents: 24000 },
    { amountCents: 50000, taxCents: 0 },
    { amountCents: 3002, taxCents: 0 },
  ]), { subtotalCents: 203002, taxCents: 24000, totalCents: 227002 });
});

test('quantity checks: decimals, size, and whole units for stock', () => {
  assert.equal(quantityProblem('2', true), null);
  assert.equal(quantityProblem('1.5', false), null);
  assert.equal(quantityProblem('0.125', false), null);
  assert.match(quantityProblem('1.5', true)!, /whole units/);
  assert.match(quantityProblem('1.2345', false)!, /three decimals/);
  assert.match(quantityProblem('0', false)!, /above zero/);
  assert.match(quantityProblem('', false)!, /Enter a quantity/);
  assert.match(quantityProblem('-2', false)!, /Enter a quantity/);
  assert.match(quantityProblem('2000000000', false)!, /too large/);
});

test('VAT rate checks', () => {
  assert.equal(taxRateProblem('16'), null);
  assert.equal(taxRateProblem(''), null);
  assert.equal(taxRateProblem('12.5'), null);
  assert.match(taxRateProblem('101')!, /above 100/);
  assert.match(taxRateProblem('7.125')!, /two decimals/);
  assert.match(taxRateProblem('x')!, /VAT rate/);
});

test('status moves follow the database rules', () => {
  assert.deepEqual(nextStatuses('OPEN'), ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
  assert.deepEqual(nextStatuses('IN_PROGRESS'), ['COMPLETED', 'CANCELLED']);
  assert.deepEqual(nextStatuses('COMPLETED'), ['IN_PROGRESS']);
  assert.deepEqual(nextStatuses('CANCELLED'), []);
  assert.equal(cancelBlockedByInvoice('SENT'), true);
  assert.equal(cancelBlockedByInvoice('PAID'), true);
  assert.equal(cancelBlockedByInvoice('VOID'), false);
  assert.equal(cancelBlockedByInvoice(null), false);
});

test('services are not stock', () => {
  assert.equal(isStockedItemType('Physical Product'), true);
  assert.equal(isStockedItemType('Raw Material'), true);
  assert.equal(isStockedItemType('Consumable'), true);
  assert.equal(isStockedItemType('Inventory'), true);
  assert.equal(isStockedItemType(null), true);
  assert.equal(isStockedItemType('Digital Service'), false);
  assert.equal(isStockedItemType('service'), false);
});

test('stock effects combine lines per item, skip services and show shortfalls', () => {
  assert.deepEqual(stockEffects([
    { itemId: 'cement', itemName: 'Cement 50kg', itemType: 'Physical Product', quantity: 4, quantityOnHand: 5 },
    { itemId: 'cement', itemName: 'Cement 50kg', itemType: 'Physical Product', quantity: 3, quantityOnHand: 5 },
    { itemId: 'delivery', itemName: 'Delivery', itemType: 'Digital Service', quantity: 1, quantityOnHand: 0 },
    { itemId: null, itemName: null, quantity: 9 },
    { itemId: 'bolts', itemName: 'Bolts', itemType: 'Consumable', quantity: 10, quantityOnHand: 100 },
  ]), [
    { itemId: 'bolts', name: 'Bolts', quantity: 10, onHand: 100, after: 90 },
    { itemId: 'cement', name: 'Cement 50kg', quantity: 7, onHand: 5, after: -2 },
  ]);
});

test('prices typed in shillings become exact cents', async () => {
  const { centsFromAmountText } = await import('./salesOrders.ts');
  assert.equal(centsFromAmountText('750'), 75000);
  assert.equal(centsFromAmountText('750.5'), 75050);
  assert.equal(centsFromAmountText('20.01'), 2001);
  assert.equal(centsFromAmountText(' 1,250.00 '), 125000);
  assert.equal(centsFromAmountText('0'), 0);
  assert.equal(centsFromAmountText('1.005'), null);
  assert.equal(centsFromAmountText('-5'), null);
  assert.equal(centsFromAmountText('abc'), null);
  assert.equal(centsFromAmountText(''), null);
});
