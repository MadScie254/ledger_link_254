import assert from 'node:assert/strict';
import test from 'node:test';
import { addDaysIso, isCalendarDate, isTimeZone, todayIn } from './dates.ts';

test('calendar dates are strict YYYY-MM-DD and real', () => {
  assert.equal(isCalendarDate('2026-10-04'), true);
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('1'), false);
  assert.equal(isCalendarDate('0'), false);
  assert.equal(isCalendarDate('10/02/2026'), false);
  assert.equal(isCalendarDate('2026-10-04T00:00:00Z'), false);
  assert.equal(isCalendarDate('+99999-01-01'), false);
});

test("today is the organization's day, not the server's", () => {
  // 22:30 UTC on 3 October is 01:30 on 4 October in Nairobi.
  const lateUtc = new Date('2026-10-03T22:30:00Z');
  assert.equal(todayIn('Africa/Nairobi', lateUtc), '2026-10-04');
  assert.equal(todayIn('UTC', lateUtc), '2026-10-03');
  assert.equal(todayIn('Not/AZone', lateUtc), '2026-10-04', 'unknown zones fall back to Nairobi');
  assert.equal(isTimeZone('Africa/Kampala'), true);
  assert.equal(isTimeZone('Mars/Olympus'), false);
});

test('adding days crosses months and years', () => {
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
});
