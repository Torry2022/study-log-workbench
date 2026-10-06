import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeInstance, normalizeInstanceOrigin, validCapabilities } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

const identity = '12345678-1234-1234-1234-123456789abc';
const feature = { supported: true, configured: false };
const capabilities = { instanceId: identity, apiContractVersion: 1, features: {
  aiWriting: feature, aiHighlighting: feature, aiNoteExtraction: feature, aiTaxonomy: feature, rag: feature
} };

test('accept only a canonical origin and explicitly allowed local HTTP', () => {
  assert.equal(normalizeInstanceOrigin(' https://SERVER.example:443/study-log/ '), 'https://server.example');
  assert.equal(normalizeInstanceOrigin('https://server.example:8443'), 'https://server.example:8443');
  for (const input of ['https://user:pass@server.example', 'https://server.example/other',
    'https://server.example?token=a', 'https://server.example/#fragment', 'https://server.example:65536',
    'http://server.example', 'http://10.evil.example', 'http://192.168.evil.example', 'http://172.32.0.1',
    'http://010.1.2.3', 'http://10.300.0.1']) assert.throws(() => normalizeInstanceOrigin(input, true), input);
  for (const host of ['localhost', '[::1]', '127.0.0.1', '10.0.0.2', '192.168.1.2', '172.16.0.1', '172.31.255.255']) {
    assert.throws(() => normalizeInstanceOrigin('http://' + host));
    assert.equal(normalizeInstanceOrigin('http://' + host, true), 'http://' + host);
  }
});

test('require the current server identity and all five capability fields', () => {
  assert.equal(validCapabilities(capabilities), true);
  for (const invalid of [null, {}, { ...capabilities, apiContractVersion: 2 },
    { ...capabilities, instanceId: '../instance' },
    { ...capabilities, features: { ...capabilities.features, aiHighlighting: undefined } },
    { ...capabilities, features: { ...capabilities.features, rag: { supported: true, configured: 'false' } } }]) {
    assert.equal(validCapabilities(invalid), false);
  }
});

test('build API URLs only under the selected server and fixed prefix', () => {
  activeInstance.activate('https://one.example', 'one', capabilities);
  assert.equal(activeInstance.apiUrl('/logs/day?date=2026-01-01'),
    'https://one.example/study-log/api/logs/day?date=2026-01-01');
  for (const path of ['https://other.example', '//other.example', '/../auth', '/assets/../../x']) {
    assert.throws(() => activeInstance.apiUrl(path));
  }
  activeInstance.activate('https://two.example', 'two');
  assert.equal(activeInstance.apiUrl('/capabilities'), 'https://two.example/study-log/api/capabilities');
  assert.equal(activeInstance.capabilities, undefined);
});

test('provider configuration remains optional for older servers and validates when present', () => {
  assert.equal(validCapabilities(capabilities), true);
  for (const configured of [true, false]) {
    assert.equal(validCapabilities({ ...capabilities, aiConfiguration: { provider: { configured } } }), true);
  }
  for (const aiConfiguration of [null, {}, { provider: null }, { provider: { configured: 'false' } }]) {
    assert.equal(validCapabilities({ ...capabilities, aiConfiguration }), false);
  }
});
