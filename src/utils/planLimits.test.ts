import assert from 'node:assert/strict';
import test from 'node:test';
import { canAddMember, canAddUser, limitMessage, nextPlanFor, type PlanLimits } from './planLimits.ts';

const plans: PlanLimits[] = [
  { id: 'law_solo', edition: 'law', name: 'Solo', maxUsers: 2, maxMembers: null, isActive: true },
  { id: 'law_firm', edition: 'law', name: 'Firm', maxUsers: 5, maxMembers: null, isActive: true },
  { id: 'law_inhouse', edition: 'law', name: 'In-house', maxUsers: 5, maxMembers: null, isActive: true },
  { id: 'law_practice', edition: 'law', name: 'Practice', maxUsers: 15, maxMembers: null, isActive: true },
  { id: 'church_seed', edition: 'church', name: 'Seed', maxUsers: null, maxMembers: 150, isActive: true },
  { id: 'church_grow', edition: 'church', name: 'Grow', maxUsers: null, maxMembers: 600, isActive: true },
  { id: 'church_large', edition: 'church', name: 'Large', maxUsers: null, maxMembers: 2000, isActive: true },
];

test('nullable limits and absent business plans are unlimited', () => {
  assert.equal(canAddUser(null, 100), true);
  assert.equal(canAddUser(plans[4], 100), true);
  assert.equal(canAddMember(plans[0], 100), true);
});

test('a user or member at the plan limit cannot be added', () => {
  assert.equal(canAddUser(plans[0], 1), true);
  assert.equal(canAddUser(plans[0], 2), false);
  assert.equal(canAddMember(plans[4], 149), true);
  assert.equal(canAddMember(plans[4], 150), false);
});

test('the refusal names the current limit and the next available plan', () => {
  const nextLaw = nextPlanFor(plans[0], plans, 'users');
  const nextChurch = nextPlanFor(plans[4], plans, 'members');
  assert.equal(nextLaw?.id, 'law_firm');
  assert.equal(nextChurch?.id, 'church_grow');
  assert.equal(limitMessage(plans[0], nextLaw, 'users'), 'The Solo plan includes 2 users. Move to Firm for up to 5.');
  assert.equal(limitMessage(plans[4], nextChurch, 'members'), 'The Seed plan includes 150 members. Move to Grow for up to 600.');
  assert.equal(nextPlanFor(plans[6], plans, 'members'), null);
});
