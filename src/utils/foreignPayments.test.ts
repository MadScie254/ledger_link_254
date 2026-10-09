import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseAtRate, bookedShareCents, realizedFxCents } from './foreignPayments.ts';

// USD 1,000 booked at KES 100 to the dollar: 0.01 dollars a shilling.
const balance = { foreignDueCents: 100_000, baseDueCents: 10_000_000, bookedRate: 0.01 };

test('a part payment clears its share at the booked rate; the last clears what is left', () => {
  assert.equal(bookedShareCents(balance, 40_000), 4_000_000);
  assert.equal(bookedShareCents(balance, 100_000), 10_000_000);
  assert.equal(bookedShareCents({ ...balance, baseDueCents: 9_999_999 }, 100_000), 9_999_999, 'the final payment takes the rounding');
});

test('receiving fewer shillings than booked is a loss on an invoice and a gain on a bill', () => {
  assert.equal(baseAtRate(40_000, 98), 3_920_000);
  assert.equal(realizedFxCents('invoice', 4_000_000, 3_920_000), -80_000);
  assert.equal(realizedFxCents('invoice', 6_000_000, baseAtRate(60_000, 103)), 180_000);
  assert.equal(realizedFxCents('bill', 5_000_000, baseAtRate(50_000, 102)), -100_000);
  assert.equal(realizedFxCents('bill', 5_000_000, baseAtRate(50_000, 99)), 50_000);
});
