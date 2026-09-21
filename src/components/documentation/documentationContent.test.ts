import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentationSections, searchableSectionText } from './documentationContent.ts';

const ROOT = process.cwd();

test('documentation chapters have unique stable ids and complete metadata', () => {
  assert.ok(documentationSections.length >= 12, 'expected a substantial SaaS documentation set');
  const ids = documentationSections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, 'chapter ids must be unique');

  for (const section of documentationSections) {
    assert.match(section.id, /^[a-z0-9-]+$/);
    assert.ok(section.title.length >= 8);
    assert.ok(section.summary.length >= 20);
    assert.ok(section.audience.length > 0);
    assert.ok(section.minutes > 0);
    assert.ok(section.blocks.length > 0);
    assert.ok(searchableSectionText(section).includes(section.title.toLowerCase()));
  }
});

test('documentation actions only link to implemented application views', () => {
  const app = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8');
  const views = new Set(
    [...app.matchAll(/activeView === ["']([^"']+)["']/g)].map((match) => match[1]),
  );

  for (const section of documentationSections) {
    if (section.openView) {
      assert.ok(views.has(section.openView), `${section.id} links to missing view ${section.openView}`);
    }
  }
});

test('tables and tutorials are structurally complete', () => {
  for (const section of documentationSections) {
    for (const block of section.blocks) {
      if (block.type === 'steps') {
        assert.ok(block.steps.length >= 2, `${section.id}/${block.title} needs multiple steps`);
        for (const step of block.steps) {
          assert.ok(step.title.length > 0);
          assert.ok(step.detail.length >= 20);
        }
      }
      if (block.type === 'table') {
        assert.ok(block.columns.length >= 2);
        assert.ok(block.rows.length > 0);
        for (const row of block.rows) {
          assert.equal(row.length, block.columns.length, `${section.id}/${block.title} has a malformed row`);
        }
      }
    }
  }
});
