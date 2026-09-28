import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyInitials } from './companyMark.ts';

test('two words take the first letter of each', () => {
  assert.equal(companyInitials('Riverside Hardware Ltd'), 'RL');
});

test('one word takes its first two letters', () => {
  assert.equal(companyInitials('Bunifu'), 'BU');
});

test('extra whitespace and case are handled', () => {
  assert.equal(companyInitials('  the counter book  '), 'TB');
});

test('a missing name never throws', () => {
  assert.equal(companyInitials(undefined), '?');
  assert.equal(companyInitials(null), '?');
  assert.equal(companyInitials('   '), '?');
});

test('the same name always gives the same mark', () => {
  assert.equal(companyInitials('Athi River Cement Traders'), companyInitials('Athi River Cement Traders'));
});
