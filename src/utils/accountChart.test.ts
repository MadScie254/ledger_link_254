import test from 'node:test';
import assert from 'node:assert/strict';
import { chartFor, STANDARD_ACCOUNTS } from './accountChart.ts';

test('business organizations keep their standard chart and currency behavior', () => {
  const chart = chartFor(null, 'KES');
  assert.deepEqual(chart.map((account) => account.code), STANDARD_ACCOUNTS.map((account) => account.code));
  assert.equal(chart.find((account) => account.code === '1000')?.isBankAccount, true);
  assert.equal(chart.find((account) => account.code === '1010')?.currency, 'USD');
  assert.equal(chart.find((account) => account.code === '1100')?.isBankAccount, false);
});

test('law and church charts add their own accounts in one unique set', () => {
  const law = chartFor('services', 'KES', 'law');
  const church = chartFor('general', 'KES', 'church');
  assert.ok(law.some((account) => account.code === '1060' && account.isBankAccount));
  assert.ok(law.some((account) => account.code === '2200' && account.type === 'LIABILITY'));
  assert.ok(church.some((account) => account.code === '1040' && account.isBankAccount));
  assert.ok(church.some((account) => account.code === '3200' && account.type === 'EQUITY'));
  for (const chart of [law, church]) {
    assert.equal(new Set(chart.map((account) => account.code)).size, chart.length);
  }
});

test('church plus nonprofit refuses the overlapping fund codes', () => {
  assert.throws(() => chartFor('nonprofit', 'KES', 'church'), /church.*nonprofit/i);
});
