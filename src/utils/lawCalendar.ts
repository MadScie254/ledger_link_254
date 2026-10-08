export type CalendarEvent = {
  id: string;
  startsAt: string;
  eventType: string;
  matterNumber: string;
  matterTitle: string;
  court?: string | null;
  courtroom?: string | null;
};

const escapeText = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

export function renderLawCalendar(events: CalendarEvent[], generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ledger Link//Mizani Court Diary//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    const start = new Date(event.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    lines.push('BEGIN:VEVENT', `UID:${event.id}@ledgerlink`, `DTSTAMP:${stamp}`,
      `DTSTART:${start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      `SUMMARY:${escapeText(`${event.eventType}: ${event.matterNumber} ${event.matterTitle}`)}`,
      `LOCATION:${escapeText([event.court, event.courtroom].filter(Boolean).join(', '))}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
