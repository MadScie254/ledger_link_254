import assert from 'node:assert/strict';
import test from 'node:test';
import { givingPlanStatus } from './givingPlans.ts';

test('past months with no posted giving are missed, while the current month is due', () => {
  assert.equal(givingPlanStatus(50000, 0, '2026-09', '2026-10'), 'MISSED');
  assert.equal(givingPlanStatus(50000, 0, '2026-10', '2026-10'), 'DUE');
  assert.equal(givingPlanStatus(50000, 0, '2026-11', '2026-10'), 'PLANNED');
});

test('a plan compares posted cents with its monthly intention', () => {
  assert.equal(givingPlanStatus(50000, 25000, '2026-09', '2026-10'), 'PARTIAL');
  assert.equal(givingPlanStatus(50000, 50000, '2026-09', '2026-10'), 'MET');
  assert.equal(givingPlanStatus(50000, 75000, '2026-09', '2026-10'), 'MET');
});
