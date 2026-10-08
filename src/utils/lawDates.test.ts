import assert from 'node:assert/strict';
import test from 'node:test';
import { printedDateTime, zonedLocalToIso, zonedParts } from './lawDates.ts';

test('a court time typed in Nairobi carries the Nairobi offset', () => {
  assert.equal(zonedLocalToIso('2026-10-15T09:00', 'Africa/Nairobi'), '2026-10-15T09:00:00+03:00');
  assert.equal(new Date(zonedLocalToIso('2026-10-15T09:00', 'Africa/Nairobi')).toISOString(), '2026-10-15T06:00:00.000Z');
  assert.equal(zonedLocalToIso('2026-01-15T09:30', 'Europe/London'), '2026-01-15T09:30:00+00:00');
  assert.equal(zonedLocalToIso('2026-07-15T09:30', 'Europe/London'), '2026-07-15T09:30:00+01:00');
  assert.equal(zonedLocalToIso('2026-10-15T09:00', null), '2026-10-15T09:00:00+03:00', 'Nairobi when no zone is set');
  assert.throws(() => zonedLocalToIso('15/10/2026 09:00', 'Africa/Nairobi'));
});

test('a stored court time reads back on the firm clock', () => {
  assert.deepEqual(zonedParts('2026-10-15T06:00:00Z', 'Africa/Nairobi'), { date: '2026-10-15', time: '09:00' });
  assert.deepEqual(zonedParts('2026-10-14T22:30:00Z', 'Africa/Nairobi'), { date: '2026-10-15', time: '01:30' }, 'after midnight in Nairobi is the next day');
  assert.equal(printedDateTime('2026-10-15T06:00:00Z', 'Africa/Nairobi'), '15/10/2026 09:00');
});
