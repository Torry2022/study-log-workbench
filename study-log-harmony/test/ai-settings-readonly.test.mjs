import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { aiSettingsSupport, parseAiSettingsSummary } from '../entry/src/main/ets/app/AiSettingsSummary.ts';
import { validCapabilities } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

const first = '11111111-1111-1111-1111-111111111111', second = '22222222-2222-2222-2222-222222222222';
const features = Object.fromEntries(['aiWriting', 'aiHighlighting', 'aiNoteExtraction', 'aiTaxonomy', 'rag']
  .map(key => [key, { supported: true, configured: false }]));
const settings = { protocolVersion: 1, readable: true, writable: false, reason: 'deployment_managed', reauthRequired: true };
const caps = ai => ({ instanceId: first, apiContractVersion: 1, features, ...(ai !== undefined ? { settings: { ai } } : {}) });
const summary = { instanceId: first, revision: 3, provider: 'custom', endpointDisplay: 'https://provider.invalid',
  hasEndpoint: true, model: 'synthetic-main', hasKey: true, lightModel: '', contextWindowTokens: '', thinking: '',
  toolCallingVerified: false, statusVerificationEnabled: false, source: 'instance' };
class ApiError extends Error { constructor(message, statusCode, code) { super(message); this.statusCode = statusCode; this.code = code; } }
class ReadCancellation { cancelled = false; cancel() { this.cancelled = true; } }
const source = await readFile(new URL('../entry/src/main/ets/app/AiSettingsController.ets', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  experimentalDecorators: true } }).outputText;
const module = { exports: {} };
const dependencies = { '../common/network/ApiClient': { ApiError },
  '../common/network/InstanceConfig': { validCapabilities }, '../common/network/ReadCancellation': { ReadCancellation },
  './AiSettingsSummary': { aiSettingsSupport, parseAiSettingsSummary } };
runInNewContext(code, { module, exports: module.exports, Error, Observed: value => value,
  require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
const { AiSettingsController } = module.exports;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(capabilities = caps(settings)) {
  const requests = []; let binding = 'A:1';
  const transport = { getConnectionBinding: () => binding,
    get: async (path, cancellation) => { requests.push({ path, cancellation }); return capabilities; },
    getForInstance: async (path, instanceId, cancellation) => { requests.push({ path, instanceId, cancellation }); return summary; },
    post() { assert.fail('read-only settings must never write or start a paid probe'); },
    put() { assert.fail('read-only settings must never write'); }, setToken() { assert.fail('settings cannot mutate auth'); } };
  return { data: new AiSettingsController(transport, () => capabilities), transport, requests, binding: value => binding = value };
}

test('settings extension is optional and safely blocks only unsupported settings, not the basic capabilities contract', () => {
  for (const [ai, expected] of [[undefined, 'legacy'], [settings, 'readable'],
    [{ ...settings, readable: false, reason: 'config_unavailable' }, 'unavailable'],
    [{ ...settings, protocolVersion: 2 }, 'unsupported'], [null, 'unsupported'],
    [{ ...settings, readable: 'true' }, 'unsupported']]) {
    assert.equal(aiSettingsSupport(caps(ai)), expected);
    assert.equal(validCapabilities(caps(ai)), true, 'optional settings cannot break existing logs/QA login');
  }
});

test('parse the actual ac099b7 server summary for instance and deployment without retaining keys, paths or extra fields', () => {
  const server = execFileSync('git', ['show', 'ac099b7:study-log-web/lib/ai-settings-reader.ts'], { encoding: 'utf8' });
  const start = server.indexOf('export function summarizeAiSettings('); assert.ok(start >= 0);
  const record = { instanceId: first, revision: 3, operationId: null, values: {
    CHAT_API_URL: 'https://provider.invalid/private/path?token=synthetic-private-query', CHAT_MODEL: 'synthetic-main', CHAT_API_KEY: 'synthetic-secret' } };
  const exports = { exports: {} };
  runInNewContext(ts.transpileModule(server.slice(start), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: exports, exports: exports.exports, URL, readAiSettingsRecord: () => record });
  for (const env of [{ AI_SETTINGS_ROOT: '/synthetic' }, record.values]) {
    const produced = exports.exports.summarizeAiSettings(first, env);
    const parsed = parseAiSettingsSummary({ ...produced, key: 'synthetic-secret', endpoint: record.values.CHAT_API_URL }, first);
    assert.equal(parsed.model, summary.model); assert.equal(parsed.endpointDisplay, summary.endpointDisplay);
    assert.equal(parsed.hasKey, true); assert.equal(parsed.source, env.AI_SETTINGS_ROOT ? 'instance' : 'deployment');
    assert.equal(parsed.revision, env.AI_SETTINGS_ROOT ? 3 : null);
    const raw = JSON.stringify(parsed);
    for (const secret of ['synthetic-secret', 'synthetic-private-query', 'private/path']) assert.ok(!raw.includes(secret));
  }
});

test('reject malformed summaries, another identity, and any display address containing credentials or a private path/query', () => {
  assert.deepEqual(parseAiSettingsSummary(summary, first), summary);
  for (const invalid of [null, {}, { ...summary, instanceId: second }, { ...summary, revision: null },
    { ...summary, revision: -1 }, { ...summary, hasKey: 'true' }, { ...summary, source: 'unknown' },
    ...['https://user:pass@provider.invalid', 'https://provider.invalid/private', 'https://provider.invalid?token=synthetic', 'file:///synthetic']
      .map(endpointDisplay => ({ ...summary, endpointDisplay }))]) assert.throws(() => parseAiSettingsSummary(invalid, first), /响应无效/);
});

test('old, unreadable and unknown services show maintenance without requesting the new endpoint', async () => {
  for (const ai of [undefined, { ...settings, readable: false, reason: 'config_unavailable' }, { ...settings, protocolVersion: 9 }]) {
    const f = fixture(caps(ai)); await f.data.load();
    assert.equal(f.requests.length, 0); assert.equal(f.data.summary, undefined); assert.equal(f.data.error, '');
    assert.equal(f.data.loading, false);
  }
});

test('readable service uses only a bound GET and refresh checks capabilities without mutating auth or business features', async () => {
  const capabilities = caps(settings), f = fixture(capabilities);
  await f.data.load();
  assert.equal(f.requests[0].path, '/settings/ai'); assert.equal(f.requests[0].instanceId, first);
  assert.ok(f.requests[0].cancellation instanceof ReadCancellation);
  assert.equal(f.data.summary.model, summary.model);
  await f.data.load(true);
  assert.deepEqual(f.requests.map(request => request.path), ['/settings/ai', '/capabilities', '/settings/ai']);
  assert.equal(capabilities.features.rag.configured, false); assert.equal(f.data.loading, false);
});

test('closing or replacing a workspace ignores late summary, 409 and capability results; duplicate reads are gated', async () => {
  for (const action of ['close', 'instance', '409', 'refresh']) {
    const f = fixture(), late = deferred();
    if (action === 'refresh') f.transport.get = () => late.promise;
    else f.transport.getForInstance = () => late.promise;
    const work = f.data.load(action === 'refresh');
    await f.data.load(); // Must not start another operation.
    if (action === 'instance') f.binding('B:2'); else f.data.dispose();
    if (action === '409') late.reject(new ApiError('stale', 409, 'AI_SETTINGS_INSTANCE_CHANGED'));
    else late.resolve(action === 'refresh' ? caps(settings) : summary);
    await work;
    assert.equal(f.data.summary, undefined); assert.equal(f.data.error, ''); assert.equal(f.data.loading, false);
  }
});

test('503 is not empty/unconfigured, identity change is explicit, and retry can recover a previously unavailable service', async () => {
  for (const [status, code, message] of [[503, 'AI_CONFIGURATION_INVALID', /无法读取/], [409, 'AI_SETTINGS_INSTANCE_CHANGED', /身份已变化/]]) {
    const f = fixture(); f.transport.getForInstance = async () => { throw new ApiError('synthetic', status, code); };
    await f.data.load(); assert.match(f.data.error, message); assert.equal(f.data.summary, undefined);
    f.transport.getForInstance = async () => summary; await f.data.load();
    assert.equal(f.data.error, ''); assert.equal(f.data.summary.hasKey, true);
  }
  const f = fixture(caps({ ...settings, readable: false, reason: 'config_unavailable' }));
  await f.data.load(); assert.equal(f.data.support, 'unavailable');
  f.transport.get = async () => caps(settings); await f.data.load(true);
  assert.equal(f.data.support, 'readable'); assert.equal(f.data.summary.model, summary.model);
  f.transport.get = async () => ({ ...caps(settings), instanceId: second }); await f.data.load(true);
  assert.match(f.data.error, /身份已变化/); assert.equal(f.data.summary, undefined);
});

test('actual native settings only mount read status on selection; lifecycle cancels it and exposes no editable secret or paid action', async () => {
  const panel = await readFile(new URL('../entry/src/main/ets/app/components/SettingsPanel.ets', import.meta.url), 'utf8');
  const status = await readFile(new URL('../entry/src/main/ets/app/components/AiSettingsStatus.ets', import.meta.url), 'utf8');
  const index = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  assert.match(panel, /section: string = 'reading'/);
  assert.match(panel, /if \(this\.section === 'ai'\) \{\s*AiSettingsStatus\(\)/);
  for (const item of ['settings_reading_size', 'settings_editor_size', 'settings_editor_wrap', 'settings_search_history', 'settings_reset']) assert.ok(panel.includes(item), item);
  assert.match(status, /aboutToAppear\(\): void \{ this\.data\.load\(\); \}/);
  assert.match(status, /aboutToDisappear\(\): void \{ this\.data\.dispose\(\); \}/);
  assert.doesNotMatch(status, /TextInput|setToken|\.post\(|\.put\(|apiKey|尝试生成|保存设置/);
  assert.match(index, /this\.replacingConnection = true;\s*this\.connected = false;\s*this\.settingsOpen = false;/);
});
