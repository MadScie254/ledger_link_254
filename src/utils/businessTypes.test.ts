import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_STEPS } from '../components/onboarding/tourSteps.ts';
import {
  BUSINESS_TYPES,
  extraAccountsFor,
  reorderByBusinessType,
  shouldSkipTourStep,
} from './businessTypes.ts';

const STANDARD_CODES = new Set([
  '1000', '1010', '1020', '1050', '1100', '1150', '1200',
  '2000', '2100', '2110', '2120', '2130', '2140',
  '3000', '3100', '4000', '4100', '5000',
  '6000', '6100', '6110', '6200', '8000', '8100',
]);

test('every business type id is unique', () => {
  const ids = BUSINESS_TYPES.map((type) => type.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('"general" carries no extra accounts, sidebar order or tour skips', () => {
  const general = BUSINESS_TYPES.find((type) => type.id === 'general')!;
  assert.equal(general.extraAccounts.length, 0);
  assert.equal(general.sidebarPriority.length, 0);
  assert.equal(general.skipTourSteps.length, 0);
});

test('no extra account code collides with the standard chart of accounts, across types', () => {
  const seen = new Set<string>();
  for (const type of BUSINESS_TYPES) {
    for (const account of type.extraAccounts) {
      assert.ok(!STANDARD_CODES.has(account.code), `${type.id}: "${account.code}" collides with a standard account`);
      assert.ok(!seen.has(account.code), `"${account.code}" is used by more than one business type`);
      seen.add(account.code);
    }
  }
});

test('every skipped tour step is a real step, and never the sidebar, welcome or closing step', () => {
  const stepIds = new Set(TOUR_STEPS.map((step) => step.id));
  for (const type of BUSINESS_TYPES) {
    for (const stepId of type.skipTourSteps) {
      assert.ok(stepIds.has(stepId), `${type.id}: no tour step "${stepId}"`);
      assert.ok(!['welcome', 'sidebar', 'done'].includes(stepId), `${type.id}: "${stepId}" must never be skippable`);
    }
  }
});

test('reordering promotes the priority views, in order, and drops nothing', () => {
  const views = [{ view: 'Accounting' }, { view: 'Reports' }, { view: 'Tax' }, { view: 'Payroll' }, { view: 'Inventory' }, { view: 'Projects' }];
  const reordered = reorderByBusinessType(views, 'services');
  assert.deepEqual(reordered.map((v) => v.view).sort(), views.map((v) => v.view).sort());
  assert.equal(reordered[0].view, 'Projects');
  assert.ok(reordered.findIndex((v) => v.view === 'Inventory') === reordered.length - 1);
});

test('an unset or "general" business type leaves the sidebar order untouched', () => {
  const views = [{ view: 'Accounting' }, { view: 'Reports' }];
  assert.deepEqual(reorderByBusinessType(views, null), views);
  assert.deepEqual(reorderByBusinessType(views, 'general'), views);
});

test('extraAccountsFor is empty for an unset type and non-empty for a real one', () => {
  assert.equal(extraAccountsFor(null).length, 0);
  assert.equal(extraAccountsFor(undefined).length, 0);
  assert.ok(extraAccountsFor('retail').length > 0);
});

test('shouldSkipTourStep only skips what that type actually lists', () => {
  assert.equal(shouldSkipTourStep('inventory', 'services'), true);
  assert.equal(shouldSkipTourStep('projects', 'services'), false);
  assert.equal(shouldSkipTourStep('inventory', null), false);
  assert.equal(shouldSkipTourStep('inventory', 'general'), false);
});
