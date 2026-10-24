import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SWAHILI } from './swahili.ts';
import { SWAHILI_INTERFACE, interfaceLanguage, localized, setInterfaceLanguage, text } from './language.ts';

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

const QUOTED = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const unquote = (match: RegExpMatchArray, first: number) =>
  (match[first] ?? match[first + 1]).replace(/\\(.)/g, '$1');

test('every label given in English has Swahili written for it', () => {
  const missing: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes("'TODO-SW'"), `${file} still has a TODO-SW placeholder`);
    const calls = [
      ...source.matchAll(new RegExp(String.raw`\b(?:say|label|localized)\((?:${QUOTED})\)`, 'g')),
    ].map((match) => unquote(match, 1));
    const items = file.endsWith('editions.ts')
      ? [...source.matchAll(new RegExp(String.raw`\bitem\((?:${QUOTED}),\s*(?:${QUOTED})`, 'g'))].map((match) => unquote(match, 3))
      : [];
    for (const en of [...calls, ...items]) if (!SWAHILI[en]?.trim()) missing.push(`${file.slice(SRC.length + 1)}: ${en}`);
  }
  assert.deepEqual(missing, []);
});

test('a label carries its Swahili, and English where none is written', () => {
  const [en, sw] = Object.entries(SWAHILI)[0];
  assert.deepEqual(localized(en), { en, sw });
  assert.deepEqual(localized('A sentence with no Swahili written'), { en: 'A sentence with no Swahili written', sw: 'A sentence with no Swahili written' });
});

test('labels show English until the Swahili interface is turned on', () => {
  const label = localized(Object.keys(SWAHILI)[0]);
  assert.equal(setInterfaceLanguage('sw'), SWAHILI_INTERFACE ? 'sw' : 'en');
  assert.equal(text(label), SWAHILI_INTERFACE ? label.sw : label.en);
  assert.equal(setInterfaceLanguage('en'), 'en');
  assert.equal(interfaceLanguage(), 'en');
  assert.equal(text(label), label.en);
  assert.equal(text(undefined), '');
});
