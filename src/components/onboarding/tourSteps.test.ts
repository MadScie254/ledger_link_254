/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAPTERS, MAX_TOUR_STEPS, TOUR_STEPS, type Copy } from './tourSteps.ts';

const SRC = join(import.meta.dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).filter((path) => !path.includes(join('components', 'onboarding')));
const sources = files.map((path) => readFileSync(path, 'utf8')).join('\n');

/** Every `data-tour="x"` or `tourId="x"` literal that exists in the app's own source. */
const anchors = new Set(
  [...sources.matchAll(/(?:data-tour|tourId)=(?:\{)?["'`]([a-z-]+)["'`]/g)].map((match) => match[1]),
);

/** The pages App.tsx can actually render. */
const views = new Set(
  [...readFileSync(join(SRC, 'App.tsx'), 'utf8').matchAll(/activeView === ["']([^"']+)["']/g)].map((match) => match[1]),
);

const everyCopy = (step: (typeof TOUR_STEPS)[number]): Copy[] => [
  step.title,
  step.body,
  ...(step.points ?? []).flatMap((p) => [p.term, p.text]),
];

test('the tour fits the range the API accepts', () => {
  assert.ok(TOUR_STEPS.length > 0);
  assert.ok(TOUR_STEPS.length <= MAX_TOUR_STEPS, `${TOUR_STEPS.length} steps exceeds ${MAX_TOUR_STEPS}`);
});

test('step ids are unique', () => {
  const ids = TOUR_STEPS.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every step opens a page that exists', () => {
  assert.ok(views.size > 10, 'could not read the page list from App.tsx');
  for (const step of TOUR_STEPS) {
    if (step.view) assert.ok(views.has(step.view), `${step.id}: "${step.view}" is not a page in App.tsx`);
  }
});

test('every spotlight target exists in the source, so no step can point at nothing', () => {
  for (const step of TOUR_STEPS) {
    if (!step.target) continue;
    const match = step.target.match(/^\[data-tour="([a-z-]+)"\]$/);
    assert.ok(match, `${step.id}: target must be a [data-tour="…"] selector, got ${step.target}`);
    assert.ok(anchors.has(match![1]), `${step.id}: no data-tour="${match![1]}" anywhere in src`);
  }
});

test('a step that names a target also names the page it lives on', () => {
  for (const step of TOUR_STEPS) {
    if (step.target) assert.ok(step.view, `${step.id}: has a target but no view`);
  }
});

test('every page in the sidebar is covered by a step', () => {
  const sidebar = readFileSync(join(SRC, 'components', 'layout', 'Sidebar.tsx'), 'utf8');
  const sidebarViews = [...sidebar.matchAll(/view: '([^']+)'/g)].map((match) => match[1]);
  assert.ok(sidebarViews.length >= 15, 'could not read the sidebar');
  const covered = new Set(TOUR_STEPS.map((step) => step.view));
  for (const view of sidebarViews) assert.ok(covered.has(view), `no tour step visits "${view}"`);
});

test('every string is written in both English and Swahili', () => {
  for (const step of TOUR_STEPS) {
    for (const copy of everyCopy(step)) {
      assert.ok(copy.en.trim(), `${step.id}: empty English`);
      assert.ok(copy.sw.trim(), `${step.id}: empty Swahili`);
    }
    assert.ok(CHAPTERS[step.chapter], `${step.id}: unknown chapter ${step.chapter}`);
  }
});

test('copy follows the house rules: no exclamation marks, no app name typos', () => {
  for (const step of TOUR_STEPS) {
    for (const copy of everyCopy(step)) {
      for (const text of [copy.en, copy.sw]) {
        assert.ok(!text.includes('!'), `${step.id}: exclamation mark in "${text}"`);
        assert.ok(!/ledger-line/i.test(text), `${step.id}: the app is called Ledger Link`);
      }
    }
  }
});

test('the tour ends on a step with no spotlight, so the close-out sits centred', () => {
  assert.equal(TOUR_STEPS[TOUR_STEPS.length - 1].target, undefined);
});
