import assert from 'node:assert/strict';
import test from 'node:test';
import { givingStatement } from './memberGiving.ts';

test('giving statement includes only posted gifts within inclusive dates', () => {
  const gifts = [
    { id: 'late', received_on: '2026-02-01', amount_cents: 2000, journal_entry_id: 'journal-late' },
    { id: 'first', received_on: '2026-01-01', amount_cents: 1000, journal_entry_id: 'journal-first' },
    { id: 'last', received_on: '2026-01-31', amount_cents: 3500, journal_entry_id: 'journal-last' },
    { id: 'unposted', received_on: '2026-01-12', amount_cents: 900, journal_entry_id: null },
  ];
  const statement = givingStatement(gifts, '2026-01-01', '2026-01-31');
  assert.deepEqual(statement.gifts.map((gift) => gift.id), ['first', 'last']);
  assert.equal(statement.totalCents, 4500);
});

test('giving statement refuses an inverted date range', () => {
  assert.throws(() => givingStatement([], '2026-02-01', '2026-01-01'), /starts after/);
});
