import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawTimeAmountCents } from './lawTime.ts';

test('time amounts round once to whole cents', () => {
  assert.equal(lawTimeAmountCents(1.25, 10_001), 12_501);
  assert.equal(lawTimeAmountCents(0.5, 101), 51);
  assert.equal(lawTimeAmountCents(2, 0), 0);
});

test('invalid or unsafe time amounts are refused', () => {
  assert.throws(() => lawTimeAmountCents(0, 1_000));
  assert.throws(() => lawTimeAmountCents(25, 1_000));
  assert.throws(() => lawTimeAmountCents(1, 0.5));
  assert.throws(() => lawTimeAmountCents(24, Number.MAX_SAFE_INTEGER));
});
