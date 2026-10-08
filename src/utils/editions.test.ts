import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_TYPES } from './businessTypes.ts';
import { STANDARD_ACCOUNTS } from './accountChart.ts';
import { KNOWN_VIEWS, PLANNED_SECTION_COPY } from './views.ts';
import { businessTypeAllowedForEdition, editionDefinition, EDITIONS, navigationGroupsFor, type Edition } from './editions.ts';

const STANDARD_CODES = new Set(STANDARD_ACCOUNTS.map((account) => account.code));

test('an unset edition is the existing Ledger Link business edition', () => {
  const business = editionDefinition(undefined);
  assert.equal(business.id, 'business');
  assert.equal(business.brandName, 'Ledger Link');
  assert.equal(business.poweredBy, false);
  assert.equal(business.defaultView, 'Home / Dashboard');
  assert.deepEqual(business.sidebar.map((group) => group.label.en), ['Money', 'Books', 'Office']);
  assert.deepEqual(business.sidebar.flatMap((group) => group.items.map((item) => item.view)), [
    'Home / Dashboard', 'Banking', 'Sales', 'Customer Hub', 'Expenses & Bills',
    'Accounting', 'Reports', 'Tax', 'Payroll', 'Inventory', 'Projects',
    'Business Feed', 'Team', 'Apps / Integrations', 'Audit Logs', 'Documentation', 'Settings',
  ]);
});

test('each edition has a distinct brand and the prescribed navigation groups', () => {
  assert.deepEqual(EDITIONS.map((edition) => edition.id), ['business', 'law', 'church']);
  assert.deepEqual(editionDefinition('law').sidebar.map((group) => group.label.en), ['Practice', 'Money', 'Office']);
  assert.deepEqual(editionDefinition('church').sidebar.map((group) => group.label.en), ['People', 'Money', 'Reports', 'Office']);
  assert.equal(editionDefinition('law').brandName, 'Mizani');
  assert.equal(editionDefinition('church').brandName, 'Kundi');
  assert.equal(editionDefinition('law').poweredBy, true);
  assert.equal(editionDefinition('church').poweredBy, true);
  assert.deepEqual(editionDefinition('law').sidebar.flatMap((group) => group.items.map((item) => item.view)), [
    'Home / Dashboard', 'Law / Matters', 'Law / Court diary', 'Law / Time',
    'Law / Fee notes', 'Law / Client account', 'Law / Disbursements', 'Customer Hub',
    'Team', 'Settings',
  ]);
  assert.deepEqual(editionDefinition('church').sidebar.flatMap((group) => group.items.map((item) => item.view)), [
    'Home / Dashboard', 'Church / Members', 'Church / Households',
    'Church / Giving', 'Church / Funds', 'Church / Cash count', 'Expenses & Bills',
    "Church / Treasurer's report", 'Church / Fund balances', 'Team', 'Settings',
  ]);
  // Law pages are built and open; church pages stay disabled until built.
  assert.ok(editionDefinition('law').sidebar.flatMap((group) => group.items).every((item) => item.available !== false), 'law pages are open');
  assert.ok(editionDefinition('church').sidebar.flatMap((group) => group.items)
    .filter((item) => item.view.startsWith('Church /'))
    .every((item) => item.available === false), 'church pages stay disabled until built');
});

test('all sidebar labels have Swahili placeholders and every view has a renderer key', () => {
  assert.equal(PLANNED_SECTION_COPY.sw, 'TODO-SW');
  const known = new Set<string>(KNOWN_VIEWS);
  for (const edition of EDITIONS) {
    assert.ok(known.has(edition.defaultView));
    for (const group of edition.sidebar) {
      assert.equal(group.label.sw, 'TODO-SW');
      for (const item of group.items) {
        assert.equal(item.name.sw, 'TODO-SW');
        assert.ok(known.has(item.view), `${edition.id}: missing renderer for ${item.view}`);
      }
    }
  }
});

test('edition account codes avoid the standard chart and duplicates within an edition', () => {
  for (const edition of EDITIONS) {
    const codes = edition.extraAccounts.map((account) => account.code);
    assert.equal(new Set(codes).size, codes.length, `${edition.id}: duplicate edition code`);
    assert.ok(codes.every((code) => !STANDARD_CODES.has(code)), `${edition.id}: standard code collision`);
  }
  const lawCodes = new Set(editionDefinition('law').extraAccounts.map((account) => account.code));
  for (const businessType of BUSINESS_TYPES) {
    assert.ok(businessType.extraAccounts.every((account) => !lawCodes.has(account.code)),
      `law and ${businessType.id} chart collide`);
    const churchCodes = new Set(editionDefinition('church').extraAccounts.map((account) => account.code));
    const collides = businessType.extraAccounts.some((account) => churchCodes.has(account.code));
    assert.equal(businessTypeAllowedForEdition('church', businessType.id), !collides,
      `church and ${businessType.id} must be accepted only when their chart is unique`);
  }
  assert.equal(businessTypeAllowedForEdition('church', 'nonprofit'), false);
  assert.equal(businessTypeAllowedForEdition('business', 'nonprofit'), true);
});

test('hostnames can be injected from environment without changing the shared definitions', () => {
  const hosts: Partial<Record<Edition, string[]>> = { law: ['mizani.example'], church: ['kundi.example'] };
  assert.deepEqual(editionDefinition('law', hosts).hostnames, ['mizani.example']);
  assert.deepEqual(editionDefinition('church', hosts).hostnames, ['kundi.example']);
  assert.deepEqual(editionDefinition('law').hostnames, []);
});

test('business book order still follows its business type', () => {
  const books = navigationGroupsFor('business', 'services', 'member').find((group) => group.label.en === 'Books');
  assert.equal(books?.items[0].view, 'Projects');
  assert.equal(books?.items.length, 6);
});

test('Full books belongs only to privileged law and church members', () => {
  for (const edition of ['law', 'church'] as const) {
    assert.ok(!navigationGroupsFor(edition, null, 'member').some((group) => group.label.en === 'Full books'));
    for (const role of ['owner', 'admin', 'accountant'] as const) {
      const books = navigationGroupsFor(edition, null, role).find((group) => group.label.en === 'Full books');
      assert.deepEqual(books?.items.map((item) => item.view), ['Accounting', 'Reports', 'Tax', 'Payroll']);
    }
  }
});
