import assert from 'node:assert/strict';
import test from 'node:test';
import { depositReviewSummary } from './depositReview.ts';

test('deposit review separates counted, banked and statement-matched collections', () => {
  assert.deepEqual(depositReviewSummary([
    { status: 'AWAITING_SECOND_COUNT', total_cents: 1000, banked_cents: null, variance_cents: null, statementMatched: false },
    { status: 'COUNTED', total_cents: 2000, banked_cents: null, variance_cents: null, statementMatched: false },
    { status: 'BANKED', total_cents: 3000, banked_cents: 2800, variance_cents: -200, statementMatched: false },
    { status: 'BANKED', total_cents: 4000, banked_cents: 4000, variance_cents: 0, statementMatched: true },
  ]), { awaitingSecondCount: 1, awaitingBanking: 1, awaitingStatementMatch: 1,
    matched: 1, unbankedCents: 2000, varianceCents: -200 });
});
