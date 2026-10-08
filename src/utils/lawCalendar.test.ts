import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLawCalendar } from './lawCalendar.ts';

test('court feed uses UTC timestamps and escapes matter and court text', () => {
  const feed = renderLawCalendar([{
    id: 'event-1', startsAt: '2026-10-15T09:00:00+03:00', eventType: 'HEARING',
    matterNumber: 'MAT-2026-0001', matterTitle: 'A, B; C', court: 'Court, Nairobi',
  }], new Date('2026-10-09T00:00:00Z'));
  assert.match(feed, /DTSTART:20261015T060000Z\r\n/);
  assert.match(feed, /SUMMARY:HEARING: MAT-2026-0001 A\\, B\\; C/);
  assert.match(feed, /LOCATION:Court\\, Nairobi/);
  assert.ok(feed.endsWith('END:VCALENDAR\r\n'));
});
