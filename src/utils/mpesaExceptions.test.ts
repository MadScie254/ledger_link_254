import assert from 'node:assert/strict';
import test from 'node:test';
import { mpesaExceptionSummary } from './mpesaExceptions.ts';

test('M-Pesa exceptions are grouped from waiting receipts without posting them', () => {
  const summary = mpesaExceptionSummary([
    { amountCents: 1200, transTime: '2026-03-01T10:00:00Z', reason: 'The giver left the account reference blank.' },
    { amountCents: 2500, transTime: '2026-03-09T10:00:00Z', reason: 'No giving rule fits reference A1.' },
    { amountCents: 3000, transTime: '2026-03-08T10:00:00Z', reason: 'Reference X starts with Y, but Z is not a member number.' },
  ], '2026-03-10');
  assert.equal(summary.totalCents, 6700);
  assert.equal(summary.olderThanSevenDays, 1);
  assert.deepEqual(summary.groups.map((group) => [group.key, group.count]), [
    ['NO_REFERENCE', 1], ['NO_RULE', 1], ['UNKNOWN_MEMBER', 1],
  ]);
});
