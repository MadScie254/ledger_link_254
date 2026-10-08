import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedOriginsForBrands, brandForHost, configuredBrandHosts } from './publicBrand.ts';

const hosts = { law: ['mizani.example.test'], church: ['kundi.example.test'] };

test('exact configured hosts select their edition; other hosts keep business', () => {
  assert.deepEqual(brandForHost('mizani.example.test', 'https://mizani.example.test/api/public/brand', hosts),
    { edition: 'law', brandName: 'Mizani', poweredBy: true });
  assert.deepEqual(brandForHost('KUNDI.EXAMPLE.TEST', 'https://kundi.example.test/api/public/brand', hosts),
    { edition: 'church', brandName: 'Kundi', poweredBy: true });
  assert.deepEqual(brandForHost('mizani.example.test.evil.test', 'https://mizani.example.test.evil.test/api/public/brand', hosts),
    { edition: 'business', brandName: 'Ledger Link', poweredBy: false });
});

test('an untrusted Host header cannot select a different brand from the request URL', () => {
  assert.equal(brandForHost('mizani.example.test', 'https://ledger.example.test/api/public/brand', hosts).edition, 'business');
  assert.equal(brandForHost('mizani.example.test@evil.test', 'https://evil.test/api/public/brand', hosts).edition, 'business');
});

test('configured hosts and browser origins are exact and deduplicated', () => {
  const configured = configuredBrandHosts(' Mizani.example.test, , mizani.example.test ', 'kundi.example.test');
  assert.deepEqual(configured, hosts);
  assert.deepEqual(allowedOriginsForBrands('https://ledger.example.test', configured), [
    'https://ledger.example.test', 'https://mizani.example.test', 'https://kundi.example.test',
  ]);
});
