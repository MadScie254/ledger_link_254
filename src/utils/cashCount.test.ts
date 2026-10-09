import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankingVariance, countTotalCents, DENOMINATIONS, readCounts } from './cashCount.ts';

test('the sheet lists Kenyan notes and coins from the largest', () => {
  assert.deepEqual(DENOMINATIONS.map((d) => d.value), [1000, 500, 200, 100, 50, 20, 10, 5, 1]);
});

test('counts add up to cents, and blanks are nothing', () => {
  const { counts, problem } = readCounts({ 1000: '12', 500: '3', 50: ' 4 ', 20: '', 1: '7', 5: '0' });
  assert.equal(problem, null);
  assert.deepEqual(counts, { 1000: 12, 500: 3, 50: 4, 1: 7 });
  assert.equal(countTotalCents(counts), (12_000 + 1_500 + 200 + 7) * 100);
  assert.equal(countTotalCents({}), 0);
});

test('a count that is not a whole number is refused with the note named', () => {
  assert.equal(readCounts({ 200: '2.5' }).problem, 'Count the KES 200 notes in whole numbers.');
  assert.equal(readCounts({ 10: '-1' }).problem, 'Count the KES 10 coins in whole numbers.');
});

test('banking says what reached the bank against the count', () => {
  assert.deepEqual(bankingVariance(1_360_000, 1_350_000), {
    varianceCents: -10_000,
    sentence: 'The bank received KES 100.00 less than was counted. The shortfall posts to bank charges (6400).',
  });
  assert.equal(bankingVariance(100, 100).sentence, 'The bank received what was counted.');
  assert.equal(bankingVariance(100, 150).varianceCents, 50);
});
