import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterPrefix, candidateMemberNumbers, compactReference, matchGiving, suggestMembers,
  type GivingFund, type GivingMember, type GivingRule,
} from './givingRules.ts';

// The rules a new church starts with (supabase/migrations/20261009000200).
const funds: GivingFund[] = [
  { id: 'general', code: 'GENERAL', name: 'General fund', isActive: true },
  { id: 'building', code: 'BUILDING', name: 'Building fund', isActive: true },
  { id: 'missions', code: 'MISSIONS', name: 'Missions fund', isActive: true },
  { id: 'welfare', code: 'WELFARE', name: 'Welfare fund', isActive: false },
];
const rules: GivingRule[] = [
  { id: 'r-member', priority: 100, matchType: 'MEMBER_NUMBER', pattern: null, fundId: 'general', incomeAccountId: 'tithes-4010' },
  { id: 'r-tithe', priority: 10, matchType: 'EXACT', pattern: 'TITHE', fundId: 'general', incomeAccountId: 'tithes-4010' },
  { id: 'r-bld', priority: 20, matchType: 'PREFIX', pattern: 'BLD', fundId: 'building', incomeAccountId: null },
  { id: 'r-msn', priority: 30, matchType: 'PREFIX', pattern: 'MSN', fundId: 'missions', incomeAccountId: null },
];
const members: GivingMember[] = [
  { id: 'm-1043', memberNumber: '1043', firstName: 'Amina' },
  { id: 'm-1044', memberNumber: '1044', firstName: 'Baraka' },
  { id: 'm-k7', memberNumber: 'k-77', firstName: 'Chebet' },
];

test('references are compared without case, spaces or a leading #', () => {
  assert.equal(compactReference(' bld 1043 '), 'BLD1043');
  assert.equal(compactReference('#1043'), '1043');
  assert.equal(compactReference(null), '');
  assert.equal(afterPrefix('BLD-1043', 'bld'), '1043');
  assert.equal(afterPrefix('BLD', 'BLD'), '');
  assert.equal(afterPrefix('TITHE', 'BLD'), null);
});

test('a member number lands on the member in GENERAL, credited to tithes', () => {
  const match = matchGiving('1043', rules, members, funds);
  assert.deepEqual(match, {
    matched: true, memberId: 'm-1043', fundId: 'general', incomeAccountId: 'tithes-4010', ruleId: 'r-member',
    explanation: 'Reference 1043: member 1043, General fund.',
  });
  assert.equal(matchGiving(' #1043 ', rules, members, funds).matched, true);
  // Member numbers are matched without case.
  const lower = matchGiving('K-77', rules, members, funds);
  assert.ok(lower.matched && lower.memberId === 'm-k7');
});

test('an exact word goes to its fund with no member', () => {
  const match = matchGiving('tithe', rules, members, funds);
  assert.ok(match.matched);
  assert.equal(match.memberId, null);
  assert.equal(match.ruleId, 'r-tithe');
  assert.equal(match.incomeAccountId, 'tithes-4010');
});

test('a prefix names the fund, and a member number after it names the giver', () => {
  const bare = matchGiving('BLD', rules, members, funds);
  assert.ok(bare.matched && bare.fundId === 'building' && bare.memberId === null);
  const withMember = matchGiving('bld-1044', rules, members, funds);
  assert.ok(withMember.matched && withMember.fundId === 'building' && withMember.memberId === 'm-1044');
  assert.equal(withMember.incomeAccountId, null, 'the fund keeps its own income account');
  const spaced = matchGiving('MSN 1043', rules, members, funds);
  assert.ok(spaced.matched && spaced.fundId === 'missions' && spaced.memberId === 'm-1043');
});

test('a prefix followed by an unknown number waits in the queue with the fund it named', () => {
  const match = matchGiving('BLD9999', rules, members, funds);
  assert.equal(match.matched, false);
  assert.ok(!match.matched);
  assert.equal(match.fundId, 'building');
  assert.equal(match.reason, 'Reference BLD9999 starts with BLD (Building fund), but 9999 is not a member number.');
});

test('nothing fits: blank, unknown words and unknown numbers wait in the queue', () => {
  assert.deepEqual(matchGiving('', rules, members, funds), { matched: false, reason: 'The giver left the account reference blank.' });
  assert.deepEqual(matchGiving('school fees', rules, members, funds), { matched: false, reason: 'No giving rule fits reference SCHOOLFEES.' });
  assert.equal(matchGiving('2001', rules, members, funds).matched, false);
});

test('rules are tried in priority order and the first that fits decides', () => {
  // A member numbered TITHE still gives through the EXACT rule, which comes first.
  const odd = [...members, { id: 'm-tithe', memberNumber: 'TITHE' }];
  const match = matchGiving('TITHE', rules, odd, funds);
  assert.ok(match.matched && match.ruleId === 'r-tithe' && match.memberId === null);
  // Inactive rules are skipped.
  const without = rules.map((rule) => (rule.id === 'r-tithe' ? { ...rule, isActive: false } : rule));
  const fallback = matchGiving('TITHE', without, odd, funds);
  assert.ok(fallback.matched && fallback.ruleId === 'r-member' && fallback.memberId === 'm-tithe');
});

test('a closed fund or a missing fund never posts', () => {
  const welfare: GivingRule = { id: 'r-wlf', priority: 5, matchType: 'PREFIX', pattern: 'WLF', fundId: 'welfare', incomeAccountId: null };
  const closed = matchGiving('WLF', [...rules, welfare], members, funds);
  assert.deepEqual(closed, { matched: false, reason: 'The Welfare fund is closed to new giving.', fundId: 'welfare', ruleId: 'r-wlf' });
  const ghost: GivingRule = { id: 'r-x', priority: 1, matchType: 'EXACT', pattern: 'X', fundId: 'gone', incomeAccountId: null };
  assert.equal(matchGiving('X', [ghost], members, funds).matched, false);
});

test('member lookups cover the whole reference and what follows each prefix', () => {
  assert.deepEqual(candidateMemberNumbers('bld-1043', rules), ['BLD-1043', '1043']);
  assert.deepEqual(candidateMemberNumbers('1043', rules), ['1043']);
  assert.deepEqual(candidateMemberNumbers('', rules), []);
  assert.deepEqual(candidateMemberNumbers('a reference that is far too long to be a number', rules), []);
});

test('suggestions come from a number in the reference, then the payer name', () => {
  const byNumber = suggestMembers({ billRefNumber: 'offering 1044 sunday', firstName: 'AMINA' }, members);
  assert.deepEqual(byNumber.map((s) => s.member.id), ['m-1044', 'm-1043']);
  assert.equal(byNumber[0].why, 'Member number 1044 is in the reference.');
  assert.equal(byNumber[1].why, "The payer's first name is AMINA.");
  assert.deepEqual(suggestMembers({ billRefNumber: '', firstName: '' }, members), []);
  assert.equal(suggestMembers({ billRefNumber: '1043 1044', firstName: 'Chebet' }, members, 2).length, 2);
});
