import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { activeInstance, validCapabilities } from '../entry/src/main/ets/common/network/InstanceConfig.ts';
import { aiSettingsSupport, parseAiSettingsSummary } from '../entry/src/main/ets/app/AiSettingsSummary.ts';

const first = '11111111-1111-1111-1111-111111111111', second = '22222222-2222-2222-2222-222222222222';
const summary = { instanceId: first, revision: 3, operationId: null, provider: 'deepseek', endpointDisplay: 'https://api.deepseek.com',
  hasEndpoint: true, hasKey: true, model: 'synthetic-main', lightModel: '', contextWindowTokens: '1000', thinking: 'disabled',
  toolCallingVerified: false, statusVerificationEnabled: false, source: 'instance' };
const features = Object.fromEntries(['aiWriting', 'aiHighlighting', 'aiNoteExtraction', 'aiTaxonomy', 'rag'].map(key => [key, { supported: true, configured: false }]));
const capabilities = { instanceId: first, apiContractVersion: 1, features, settings: { ai: {
  protocolVersion: 1, readable: true, writable: true, reauthRequired: true, reason: 'enabled' } } };
class ApiError extends Error { constructor(message, statusCode, code = '') { super(message); this.statusCode = statusCode; this.code = code; } }
class ReadCancellation { cancelled = false; cancel() { this.cancelled = true; } }
const source = await readFile(new URL('../entry/src/main/ets/app/AiSettingsEditor.ets', import.meta.url), 'utf8');
const module = { exports: {} };
const dependencies = { '@kit.ArkTS': { util: { generateRandomUUID: randomUUID } }, '../common/network/ApiClient': { ApiError },
  '../common/network/InstanceConfig': { activeInstance, validCapabilities }, '../common/network/ReadCancellation': { ReadCancellation },
  './AiSettingsSummary': { aiSettingsSupport, parseAiSettingsSummary } };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText,
  { module, exports: module.exports, Error, JSON, Observed: value => value, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
const { AiSettingsEditor } = module.exports;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(shared = new Map()) {
  activeInstance.activate('https://synthetic.invalid', first, capabilities);
  let binding = 'A:1', current = { ...summary }, caps = structuredClone(capabilities), write, post;
  const requests = [];
  const transport = { getConnectionBinding: () => binding,
    get: async path => { requests.push({ path }); return caps; },
    getForInstance: async (path, instanceId) => { requests.push({ path, instanceId }); return current; },
    putForInstance: async (path, body, instanceId, cancellation) => {
      requests.push({ path, body, instanceId, cancellation, method: 'PUT' });
      if (write) return write(body);
      current = { ...current, operationId: body.operationId, revision: body.expectedRevision + 1,
        model: body.model, lightModel: body.lightModel, hasKey: body.keyAction !== 'remove', provider: body.provider };
      return current;
    },
    postForInstance: async (path, body, instanceId, cancellation) => {
      requests.push({ path, body, instanceId, cancellation, method: 'POST' });
      if (post) return post(path, body);
      return path.endsWith('models') ? { instanceId, revision: current.revision, models: ['synthetic-main', 'synthetic-light'] } : { instanceId, revision: current.revision, ok: true };
    } };
  const store = { readAiSettingsPending: async namespace => shared.get(namespace) || '',
    writeAiSettingsPending: async (namespace, raw) => shared.set(namespace, raw) };
  const editor = new AiSettingsEditor(transport, store);
  return { editor, transport, store, shared, requests, current: value => current = value,
    caps: value => caps = value, binding: value => binding = value, write: value => write = value, post: value => post = value,
    open: () => editor.open(summary) };
}

test('exit confirms meaningful edits or pending writes, while an untouched form exits directly', async () => {
  const f = fixture(); await f.open();
  assert.equal(f.editor.hasUnsavedChanges(), false);
  f.editor.change('model', 'changed'); assert.equal(f.editor.hasUnsavedChanges(), true);
  f.editor.change('model', summary.model); assert.equal(f.editor.hasUnsavedChanges(), false);
  f.editor.change('keyAction', 'remove'); assert.equal(f.editor.hasUnsavedChanges(), true);
  f.editor.change('keyAction', 'keep'); assert.equal(f.editor.hasUnsavedChanges(), false);
  f.editor.change('lightModel', 'light'); assert.equal(f.editor.hasUnsavedChanges(), true);
  await f.open(); f.editor.change('contextWindowTokens', '200000'); assert.equal(f.editor.hasUnsavedChanges(), true);
  await f.open(); f.editor.change('thinking', 'low'); assert.equal(f.editor.hasUnsavedChanges(), true);
  await f.open(); f.editor.pending = { instanceId: first, operationId: randomUUID(), expectedRevision: 3 };
  assert.equal(f.editor.hasUnsavedChanges(), true); assert.match(f.editor.leaveMessage(), /继续核对/);
  f.editor.dispose(); assert.equal(f.editor.hasUnsavedChanges(), false);
});

test('remote edits are capability-gated on entry and again on every explicit operation, never automatically probed', async () => {
  for (const ai of [undefined, { ...capabilities.settings.ai, writable: false }, { ...capabilities.settings.ai, protocolVersion: 2 }, { ...capabilities.settings.ai, reauthRequired: false }]) {
    const f = fixture(); f.caps({ ...capabilities, settings: { ai } }); await f.open();
    assert.equal(f.editor.writable, false); await f.editor.save('synthetic-password'); await f.editor.probe('test', 'synthetic-password');
    assert.equal(f.requests.filter(request => request.method).length, 0);
  }
  const f = fixture(); await f.open(); assert.equal(f.requests.filter(request => request.method).length, 0);
  f.caps({ ...capabilities, settings: { ai: { ...capabilities.settings.ai, writable: false } } });
  await f.editor.save('synthetic-password'); assert.equal(f.requests.filter(request => request.method).length, 0);
});

test('save uses one immutable operation and explicit key actions, stores only non-secret pending identity', async () => {
  for (const action of ['keep', 'replace', 'remove']) {
    const f = fixture(); await f.open(); f.editor.change('keyAction', action);
    if (action === 'replace') f.editor.change('key', 'synthetic-new-key');
    let persisted;
    f.write(body => {
      persisted = f.shared.get(first);
      f.current({ ...summary, revision: 4, operationId: body.operationId, hasKey: action !== 'remove' });
    });
    await f.editor.save('synthetic-password');
    const request = f.requests.find(item => item.method === 'PUT');
    assert.equal(request.body.password, 'synthetic-password'); assert.equal(request.instanceId, first);
    assert.equal(request.body.expectedRevision, 3); assert.equal(request.body.keyAction, action);
    assert.equal(request.body.key, action === 'replace' ? 'synthetic-new-key' : undefined);
    assert.deepEqual(Object.keys(JSON.parse(persisted)).sort(), ['expectedRevision', 'instanceId', 'operationId']);
    assert.ok(!persisted.includes('synthetic')); assert.equal(f.shared.get(first), '');
    assert.equal(f.editor.pending, undefined); assert.equal(f.editor.key, ''); assert.match(f.editor.message, /已保存/);
  }
});

test('target changes invalidate old key and checks; masked endpointDisplay never becomes the submitted full address', async () => {
  const f = fixture(); await f.open(); f.editor.probeStatus = 'old'; f.editor.change('provider', 'custom');
  assert.equal(f.editor.keyAction, 'replace'); assert.equal(f.editor.key, ''); assert.equal(f.editor.probeStatus, '');
  f.editor.change('endpoint', 'https://provider.invalid/private/path?synthetic=secret'); f.editor.change('keyAction', 'keep');
  await f.editor.save('synthetic-password'); assert.equal(f.requests.filter(item => item.method).length, 0);
  f.editor.change('keyAction', 'replace'); f.editor.change('key', 'synthetic-key');
  await f.editor.save('synthetic-password');
  const body = f.requests.find(item => item.method === 'PUT').body;
  assert.equal(body.endpoint, 'https://provider.invalid/private/path?synthetic=secret');
  assert.equal(body.key, 'synthetic-key'); assert.equal(body.provider, 'custom');
});

test('lost save responses never trigger a write retry; explicit GET confirms only matching operationId with a new revision', async () => {
  const f = fixture(); await f.open();
  f.write(body => { f.current({ ...summary, revision: 4, operationId: body.operationId }); throw new ApiError('synthetic network loss', 0); });
  await f.editor.save('synthetic-password'); assert.ok(f.editor.pending); assert.match(f.editor.message, /无法确认/);
  assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1);
  await f.editor.checkSave(); assert.equal(f.editor.pending, undefined); assert.match(f.editor.message, /已保存/);
  assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1);
});

test('unchanged revision can explicitly retry identical payload with the same operationId and a fresh password', async () => {
  const f = fixture(); await f.open(); f.editor.change('keyAction', 'replace'); f.editor.change('key', 'synthetic-key');
  f.write(() => { throw new ApiError('synthetic offline', 0); }); await f.editor.save('synthetic-password'); await f.editor.checkSave();
  const original = f.requests.find(item => item.method === 'PUT').body;
  f.editor.change('model', 'must-not-change'); assert.equal(f.editor.model, summary.model); assert.equal(f.editor.canRetry(), true);
  f.write(body => f.current({ ...summary, revision: 4, operationId: body.operationId }));
  await f.editor.save('synthetic-fresh-password', true);
  const retry = f.requests.filter(item => item.method === 'PUT')[1].body;
  assert.equal(retry.operationId, original.operationId); assert.equal(retry.key, original.key);
  assert.equal(retry.password, 'synthetic-fresh-password'); assert.equal(f.editor.pending, undefined);
});

test('newer different operation and version conflicts preserve form until the user explicitly chooses latest', async () => {
  for (const uncertain of [true, false]) {
    const f = fixture(); await f.open(); f.editor.change('model', 'synthetic-draft');
    f.write(() => { f.current({ ...summary, revision: 7, operationId: randomUUID(), model: 'other-device' });
      throw new ApiError('模型设置已在另一处更新', uncertain ? 0 : 409, 'AI_SETTINGS_CONFLICT'); });
    await f.editor.save('synthetic-password');
    if (uncertain) { await f.editor.checkSave(); assert.ok(f.editor.pending); assert.equal(f.editor.canRetry(), false); }
    else { assert.match(f.editor.error, /另一处/); await f.editor.reviewLatest(); }
    assert.equal(f.editor.model, 'synthetic-draft'); assert.equal(f.editor.latest.model, 'other-device');
    await f.editor.useLatest(); assert.equal(f.editor.model, 'other-device'); assert.equal(f.editor.pending, undefined);
  }
});

test('closing, switching instances, and reopening never apply an A draft or late result to B; pending identity survives without secrets', async () => {
  const shared = new Map(), f = fixture(shared); await f.open(); const late = deferred(); f.write(() => late.promise);
  f.editor.change('keyAction', 'replace'); f.editor.change('key', 'synthetic-key');
  const work = f.editor.save('synthetic-password'); while (!f.requests.some(item => item.method === 'PUT')) await Promise.resolve();
  const operation = f.editor.pending.operationId; f.editor.dispose(); f.binding('B:2'); activeInstance.activate('https://other.invalid', second);
  late.resolve({}); await work; assert.equal(f.editor.editing, false); assert.equal(f.editor.key, ''); assert.equal(f.editor.endpoint, '');
  assert.ok(shared.has(first)); assert.equal(shared.has(second), false); assert.ok(!shared.get(first).includes('synthetic-key'));
  const returned = fixture(shared); returned.current({ ...summary, revision: 4, operationId: operation }); await returned.open();
  assert.match(returned.editor.message, /已保存/); assert.equal(shared.get(first), '');
  assert.equal(returned.requests.filter(item => item.method).length, 0);
});

test('model and paid probes require explicit invocation, password, matching instance/revision, and reset on draft edits', async () => {
  const f = fixture(); await f.open(); await f.editor.probe('models', ''); assert.equal(f.requests.filter(item => item.method).length, 0);
  await f.editor.probe('models', 'synthetic-password'); assert.equal(f.editor.models.length, 2);
  await f.editor.probe('test', 'synthetic-password'); assert.match(f.editor.probeStatus, /生成检查通过/);
  f.editor.change('model', 'synthetic-other'); assert.equal(f.editor.probeStatus, '');
  f.post(() => ({ instanceId: second, revision: 3, ok: true })); await f.editor.probe('test', 'synthetic-password');
  assert.match(f.editor.error, /已变化/); assert.equal(f.editor.probeStatus, '');
  f.editor.change('keyAction', 'remove'); const count = f.requests.length; await f.editor.probe('test', 'synthetic-password');
  assert.equal(f.requests.slice(count).filter(item => item.method).length, 0);
});

test('in-flight checks freeze related fields and ignore cancelled/late success after leaving', async () => {
  const f = fixture(); await f.open(); const late = deferred(); f.post(() => late.promise);
  const work = f.editor.probe('test', 'synthetic-password'); while (!f.requests.some(item => item.method === 'POST')) await Promise.resolve();
  f.editor.change('model', 'not-applied'); assert.equal(f.editor.model, summary.model);
  const request = f.requests.find(item => item.method === 'POST'); f.editor.dispose();
  assert.equal(request.cancellation.cancelled, true); late.resolve({ instanceId: first, revision: 3, ok: true }); await work;
  assert.equal(f.editor.probeStatus, ''); assert.equal(f.editor.editing, false);
});

test('deployment restore uses the actual preview shape and snapshot identity, not current draft secrets', async () => {
  const f = fixture(); await f.open();
  f.post(() => ({ instanceId: first, revision: 3, previewId: 'synthetic-preview', provider: 'custom', endpointDisplay: 'https://provider.invalid',
    hasEndpoint: true, model: 'deployment-model', hasKey: false, lightModel: '' }));
  await f.editor.previewDeployment('synthetic-password'); assert.equal(f.editor.preview.model, 'deployment-model');
  f.editor.keyAction = 'replace'; f.editor.key = ''; // Restoring must not demand a new key for the unrelated unsaved draft.
  f.write(body => f.current({ ...summary, revision: 4, operationId: body.operationId }));
  await f.editor.save('synthetic-new-password', false, true);
  const body = f.requests.find(item => item.method === 'PUT').body;
  assert.equal(body.mode, 'restore_deployment'); assert.equal(body.previewId, 'synthetic-preview');
  assert.equal(body.key, undefined); assert.equal(body.endpoint, undefined); assert.equal(f.editor.pending, undefined);
});

test('operation identity without a strictly newer revision cannot confirm a save; malformed pending identity cannot run a write', async () => {
  const f = fixture(); await f.open(); f.write(body => {
    f.current({ ...summary, operationId: body.operationId }); throw new ApiError('synthetic lost response', 0);
  });
  await f.editor.save('synthetic-password'); await f.editor.checkSave();
  assert.ok(f.editor.pending); assert.doesNotMatch(f.editor.message, /设置已保存/);
  const broken = fixture(new Map([[first, JSON.stringify({ instanceId: second, operationId: randomUUID(), expectedRevision: 3 })]]));
  await broken.open(); assert.match(broken.editor.error, /本机保存结果记录无效/);
  assert.equal(broken.requests.filter(item => item.method).length, 0);
});

test('password and reauth errors cannot write automatically or discard the editable draft; failed local tracking blocks writes', async () => {
  const f = fixture(); await f.open(); f.editor.change('model', 'synthetic-draft');
  await f.editor.save(''); assert.equal(f.requests.filter(item => item.method).length, 0);
  for (const [status, code] of [[403, 'AI_SETTINGS_REAUTH_FAILED'], [429, 'AI_SETTINGS_REAUTH_LIMIT']]) {
    f.write(() => { throw new ApiError('请重新确认访问密码', status, code); });
    await f.editor.save('synthetic-password'); assert.match(f.editor.error, /访问密码/);
    assert.equal(f.editor.pending, undefined); assert.equal(f.editor.model, 'synthetic-draft');
  }
  const count = f.requests.filter(item => item.method).length;
  f.store.writeAiSettingsPending = async () => { throw Error('synthetic storage failure'); };
  await f.editor.save('synthetic-password'); assert.equal(f.requests.filter(item => item.method).length, count);
  assert.equal(f.editor.model, 'synthetic-draft'); assert.ok(f.editor.error);
});

test('confirmed saves refresh readiness without changing the instance or session binding; refresh failure is not a failed save', async () => {
  for (const failed of [false, true]) {
    const f = fixture(); await f.open(); const instanceRevision = activeInstance.revision;
    const updated = { ...capabilities, features: { ...features, rag: { supported: true, configured: true } } };
    f.write(body => {
      f.current({ ...summary, revision: 4, operationId: body.operationId });
      if (failed) f.transport.get = async () => { throw Error('synthetic refresh failure'); };
      else f.caps(updated);
    });
    assert.equal(await f.editor.save('synthetic-password'), !failed);
    assert.equal(f.editor.pending, undefined); assert.equal(activeInstance.revision, instanceRevision);
    assert.match(f.editor.message, /设置已保存/);
    if (failed) assert.match(f.editor.message, /功能状态暂未更新/); else assert.equal(activeInstance.capabilities.features.rag.configured, true);
  }
});

test('incomplete configuration can save a model or address with no old key; checks still require complete credentials', async () => {
  for (const endpoint of ['', 'https://provider.invalid/v1/chat/completions']) {
    const f = fixture(); await f.editor.open({ ...summary, provider: 'custom', hasKey: false, hasEndpoint: false, endpointDisplay: '', model: '' });
    assert.equal(f.editor.keyAction, 'keep'); f.editor.change('model', 'synthetic-model');
    f.editor.change('endpoint', endpoint); assert.equal(f.editor.keyAction, 'keep');
    await f.editor.probe('test', 'synthetic-password'); assert.equal(f.requests.filter(item => item.method).length, 0);
    await f.editor.save('synthetic-password');
    const body = f.requests.find(item => item.method === 'PUT').body;
    assert.equal(body.keyAction, 'keep'); assert.equal(body.key, undefined); assert.equal(body.endpoint, endpoint || undefined);
    assert.equal(body.endpointAction, endpoint ? 'replace' : 'keep');
    assert.equal(body.model, 'synthetic-model'); assert.equal(f.editor.pending, undefined);
  }
});

test('stopping a check preserves editable fields, discards its late result and requires capabilities again for retry', async () => {
  const f = fixture(); await f.open(); const late = deferred(); f.post(() => late.promise);
  const work = f.editor.probe('test', 'synthetic-password'); while (!f.requests.some(item => item.method === 'POST')) await Promise.resolve();
  const request = f.requests.find(item => item.method === 'POST'); f.editor.cancelProbe();
  assert.equal(request.cancellation.cancelled, true); assert.equal(f.editor.busy, false); assert.equal(f.editor.editing, true);
  f.editor.change('model', 'synthetic-updated'); late.resolve({ instanceId: first, revision: 3, ok: true }); await work;
  assert.equal(f.editor.probeStatus, ''); assert.equal(f.editor.model, 'synthetic-updated');
  const before = f.requests.filter(item => item.path === '/capabilities').length;
  f.post(() => ({ instanceId: first, revision: 3, ok: true })); await f.editor.probe('test', 'synthetic-new-password');
  assert.equal(f.requests.filter(item => item.path === '/capabilities').length, before + 1); assert.equal(f.editor.probeStatus, '生成检查通过');
});

test('advanced fields stay omitted unless changed, capacity validates the actual range, key-only changes retain capacity', async () => {
  const f = fixture(); await f.editor.open({ ...summary, contextWindowTokens: '131072' });
  f.editor.change('keyAction', 'replace'); f.editor.change('key', 'synthetic-key');
  assert.equal(f.editor.contextWindowTokens, '131072'); await f.editor.save('synthetic-password');
  let body = f.requests.filter(item => item.method === 'PUT').at(-1).body;
  assert.equal(body.contextWindowTokens, undefined); assert.equal(body.thinking, undefined);
  for (const value of ['98304', '-1', '1.5', '9007199254740992']) {
    f.editor.change('contextWindowTokens', value); const before = f.requests.filter(item => item.method).length;
    await f.editor.save('synthetic-password'); assert.match(f.editor.error, /98304/);
    assert.equal(f.requests.filter(item => item.method).length, before);
  }
  f.editor.change('contextWindowTokens', '131072'); await f.editor.save('synthetic-password');
  body = f.requests.filter(item => item.method === 'PUT').at(-1).body; assert.equal(body.contextWindowTokens, '131072');
  f.editor.change('contextWindowTokens', ''); await f.editor.save('synthetic-password');
  body = f.requests.filter(item => item.method === 'PUT').at(-1).body; assert.equal(body.contextWindowTokens, '');
  f.editor.change('model', 'synthetic-new'); assert.equal(f.editor.contextWindowTokens, '');
});

test('DeepSeek thinking edits apply only to exact supported targets; hidden or unchanged values are not sent', async () => {
  const f = fixture(); await f.editor.open({ ...summary, model: 'deepseek-flash' });
  assert.equal(f.editor.thinkingSupported(), true); f.editor.change('thinking', 'low'); await f.editor.save('synthetic-password');
  assert.equal(f.requests.filter(item => item.method === 'PUT').at(-1).body.thinking, 'low');
  f.editor.change('thinking', 'disabled'); f.editor.change('model', 'synthetic-unsupported');
  assert.equal(f.editor.thinkingSupported(), false); await f.editor.save('synthetic-password');
  assert.equal(f.requests.filter(item => item.method === 'PUT').at(-1).body.thinking, undefined);
  f.editor.change('model', 'deepseek-v4-pro'); f.editor.change('thinking', ''); await f.editor.save('synthetic-password');
  assert.equal(f.requests.filter(item => item.method === 'PUT').at(-1).body.thinking, '');
});

test('retry reauthentication failures and errors after an accepted PUT cannot erase an uncertain operation identity', async () => {
  const f = fixture(); await f.open(); f.write(() => { throw new ApiError('synthetic lost response', 0); });
  await f.editor.save('synthetic-password'); const operation = f.editor.pending.operationId;
  await f.editor.save('', true); assert.equal(f.editor.pending.operationId, operation);
  f.write(() => { throw new ApiError('请重新确认访问密码', 403, 'AI_SETTINGS_REAUTH_FAILED'); });
  await f.editor.save('synthetic-password', true); assert.equal(f.editor.pending.operationId, operation);
  assert.equal(JSON.parse(f.shared.get(first)).operationId, operation);
  const accepted = fixture(); await accepted.open();
  accepted.write(() => { accepted.transport.getForInstance = async () => { throw new ApiError('工作台身份已变化', 409, 'AI_SETTINGS_INSTANCE_CHANGED'); }; });
  await accepted.editor.save('synthetic-password'); assert.ok(accepted.editor.pending); assert.ok(accepted.shared.get(first));
  assert.match(accepted.editor.message, /无法确认/); assert.match(accepted.editor.error, /身份已变化/);
});

test('native form keeps secret confirmation short-lived, clears on leaving, and routes explicit actions through the real controller', async () => {
  const form = await readFile(new URL('../entry/src/main/ets/app/components/AiSettingsForm.ets', import.meta.url), 'utf8');
  assert.match(form, /InputType.Password/); assert.match(form, /60000/); assert.match(form, /aboutToDisappear\(\): void \{ this.clearConfirmation\(\); this.keyboard.clear\(\); this.leaveConfirmation.settle\(false\); \}/);
  assert.match(form, /const action = this.action, password = this.password;\s*this.clearConfirmation\(\)/);
  assert.match(form, /将使用服务商额度/); assert.match(form, /this.editor.save\(password, action === 'retry', action === 'restore'\)/);
  assert.match(form, /settings_ai_confirmation/); assert.match(form, /this.keyboard.focus/);
  assert.doesNotMatch(form, /TokenStore|\.post\(|\.put\(|password.*preferences|password.*write/);
});

test('return to the calling feature requires this save to be confirmed and readiness to refresh', async () => {
  const form = await readFile(new URL('../entry/src/main/ets/app/components/AiSettingsForm.ets', import.meta.url), 'utf8');
  const start = form.indexOf('  private async saveAndReturn('), end = form.indexOf('  private perform()', start);
  const exports = { exports: {} };
  runInNewContext(ts.transpileModule(`export class Form { ${form.slice(start, end)} }`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: exports, exports: exports.exports });
  for (const scenario of ['success', 'uncertain', 'conflict', 'refresh-failure', 'disposed']) {
    const f = fixture(); await f.open(); const page = new exports.exports.Form();
    let returned = 0; page.editor = f.editor; page.onSaved = () => returned++;
    f.write(body => {
      if (scenario === 'disposed') { f.editor.dispose(); return; }
      if (scenario === 'conflict') {
        f.current({ ...summary, revision: 4, operationId: randomUUID() });
        throw new ApiError('AI 设置已在另一处更新', 409, 'AI_SETTINGS_CONFLICT');
      }
      if (scenario === 'uncertain') throw new ApiError('synthetic lost response', 0);
      f.current({ ...summary, revision: 4, operationId: body.operationId });
      if (scenario === 'refresh-failure') f.transport.get = async () => { throw Error('synthetic refresh failure'); };
    });
    await page.saveAndReturn('synthetic-password', 'save');
    assert.equal(returned, scenario === 'success' ? 1 : 0, scenario);
    if (scenario === 'uncertain') {
      const operationId = f.editor.pending.operationId;
      f.current({ ...summary, revision: 4, operationId });
      await page.saveAndReturn('', 'check'); assert.equal(returned, 1);
      assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1);
    }
  }
});

test('feature settings use a window cover above secondary pages and preserve their navigation state', async () => {
  const index = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  const start = index.indexOf('  private openAiSettings(): void'), end = index.indexOf('  @Builder', start);
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(`export class Page { ${index.slice(start, end)} }`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports });
  const page = new module.exports.Page();
  Object.assign(page, { connected: true, settingsOpen: false, selectedModule: 1, extracting: true, draft: 'retained' });
  page.openAiSettings();
  assert.equal(page.settingsOpen, true); assert.equal(page.settingsInitialSection, 'ai');
  assert.equal(page.selectedModule, 1); assert.equal(page.extracting, true); assert.equal(page.draft, 'retained');
  assert.match(index, /bindContentCover\(this\.settingsOpen[\s\S]*this\.settingsModal\(\)/);
  assert.match(index, /AppModalFrame\(\{ content: \(\): void => this\.settingsContent\(\)/);
  assert.match(index, /onWillDismiss: \(\) => this\.settingsBack\(\)/);
  assert.doesNotMatch(index, /if \(this\.settingsOpen[^\n]*\) \{\s*SettingsPanel/);
});

test('the actual native confirmation clears password before dispatch, expires at one minute, and cancels on leaving', async () => {
  const form = await readFile(new URL('../entry/src/main/ets/app/components/AiSettingsForm.ets', import.meta.url), 'utf8');
  const start = form.indexOf('  aboutToDisappear(): void'), end = form.indexOf('  @Builder', start);
  assert.ok(start >= 0 && end > start);
  const exports = { exports: {} }, timers = [], submitted = [], dialogs = [];
  runInNewContext(ts.transpileModule(`export class Form { ${form.slice(start, end)} }`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: exports, exports: exports.exports, setTimeout: (fn, delay) => { assert.equal(delay, 60000); timers.push(fn); return timers.length; }, clearTimeout() {} });
  const page = new exports.exports.Form(); page.keyboard = { clear() {} };
  page.leaveConfirmation = { settle: accepted => assert.equal(accepted, false) };
  page.confirmation = { open: () => dialogs.push('open'), close: () => dialogs.push('close') };
  page.editor = { busy: false, save: password => { assert.equal(page.password, ''); assert.equal(page.action, ''); submitted.push(password); } };
  page.confirm('save'); page.password = 'synthetic-password'; page.perform(); assert.deepEqual(submitted, ['synthetic-password']);
  page.confirm('save'); page.password = 'synthetic-second'; timers.at(-1)(); assert.equal(page.password, ''); assert.equal(page.action, '');
  page.confirm('save'); page.password = 'synthetic-third'; page.aboutToDisappear(); assert.equal(page.password, ''); assert.equal(submitted.length, 1);
  assert.equal(page.action, ''); assert.equal(dialogs.filter(value => value === 'open').length, 3);
  assert.equal(dialogs.at(-1), 'close');
});

test('AI choices and reauthentication use bounded native controls without an inline password section', async () => {
  const form = await readFile(new URL('../entry/src/main/ets/app/components/AiSettingsForm.ets', import.meta.url), 'utf8');
  assert.match(form, /new CustomDialogController\(\{/);
  assert.match(form, /customStyle: true, autoCancel: true, cancel: \(\) => this.clearConfirmation\(\)/);
  assert.match(form, /@CustomDialog\s+struct AiSettingsConfirmation/);
  assert.match(form, /maxWidth: 440, maxHeight: '84%'/);
  assert.match(form, /settings_ai_confirmation_scroll/);
  assert.match(form, /\.height\(44\).*\.borderRadius\(8\)/);
  assert.match(form, /arrowModifier\(this.selectArrow\(\)\)/);
  assert.doesNotMatch(form, / · /);
  const formBody = form.slice(form.indexOf('  build()'), form.indexOf('@CustomDialog'));
  assert.doesNotMatch(formBody, /settings_ai_password/);
  assert.match(form, /aboutToDisappear\(\): void \{ this.password = ''; this.keyboard.clear\(\); \}/);
});
