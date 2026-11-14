import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_REPORT_CONTENTS, reportContentsFor } from './reportContents.ts';

test('a business edition sees only the general books, unchanged', () => {
  assert.deepEqual(reportContentsFor('business'), BASE_REPORT_CONTENTS);
  assert.deepEqual(reportContentsFor(undefined), BASE_REPORT_CONTENTS);
  assert.deepEqual(reportContentsFor(null), BASE_REPORT_CONTENTS);
});

test('a law firm (Mizani) additionally sees client account reconciliation', () => {
  const sections = reportContentsFor('law');
  assert.deepEqual(sections.slice(0, BASE_REPORT_CONTENTS.length), BASE_REPORT_CONTENTS);
  const extra = sections[sections.length - 1];
  assert.equal(extra.section, 'Client account');
  assert.deepEqual(extra.reports.map((r) => r.name), ['Client account reconciliation']);
  assert.equal(extra.reports[0].navigate, 'Law / Client account');
});

test('a church (Kundi) additionally sees the treasurer and fund reports', () => {
  const sections = reportContentsFor('church');
  assert.deepEqual(sections.slice(0, BASE_REPORT_CONTENTS.length), BASE_REPORT_CONTENTS);
  const extra = sections[sections.length - 1];
  assert.equal(extra.section, 'Treasurer and funds');
  assert.deepEqual(extra.reports.map((r) => r.name), ["Treasurer's report", 'Fund balances']);
  assert.deepEqual(extra.reports.map((r) => r.navigate), ["Church / Treasurer's report", 'Church / Fund balances']);
});

test('every entry opens exactly one way: an internal report id, or a navigate target, never both or neither', () => {
  for (const edition of ['business', 'law', 'church'] as const) {
    for (const group of reportContentsFor(edition)) {
      for (const report of group.reports) {
        const hasId = typeof report.id === 'string';
        const hasNavigate = typeof report.navigate === 'string';
        assert.notEqual(hasId, hasNavigate, `"${report.name}" in "${group.section}" must have exactly one of id/navigate`);
      }
    }
  }
});
