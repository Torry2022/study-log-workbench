import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { activeInstance, normalizeInstanceOrigin, validCapabilities } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

const root = new URL('../entry/src/main/ets/', import.meta.url);
const id = '11111111-1111-1111-1111-111111111111';
const capabilities = { instanceId: id, apiContractVersion: 1, features: Object.fromEntries(
  ['aiWriting', 'aiHighlighting', 'aiNoteExtraction', 'aiTaxonomy', 'rag'].map(key => [key, { supported: true, configured: false }])) };
async function load(file, dependencies) {
  const source = await readFile(new URL(file + '.ets', root), 'utf8'), module = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Error, Map, Uint8Array, JSON, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return module.exports;
}
const loginSource = await readFile(new URL('app/LoginPage.ets', root), 'utf8');
const names = ['aboutToAppear', 'aboutToDisappear', 'cancelCheck', 'requestBack', 'submit'];
const methods = names.map(name => {
  const start = loginSource.search(new RegExp(`^  (?:private )?(?:async )?${name}\\(`, 'm'));
  const next = loginSource.slice(start + 1).search(/^  (?:private |aboutTo|@|build\()/m);
  assert.ok(start >= 0 && next >= 0, name);
  return loginSource.slice(start, start + next + 1);
}).join('\n');
const loginCode = ts.transpileModule(`export class Login { ${methods} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

async function fixture() {
  activeInstance.activate('', '');
  const values = new Map(), assets = new Map(), calls = [], warnings = [];
  let pointer, pointerError, assetError, restoredCapabilities = capabilities;
  let restoreError;
  class ApiError extends Error { constructor(statusCode) { super('synthetic authentication failure'); this.statusCode = statusCode; } }
  let probe = async () => ({ origin: 'https://synthetic.invalid', localHttp: false, token: 'synthetic-token', capabilities });
  const util = { generateRandomUUID: randomUUID,
    TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } },
    TextDecoder: class { decodeToString(value) { return new TextDecoder().decode(value); } } };
  const { InstanceStore } = await load('common/storage/InstanceStore', {
    '@kit.ArkData': { preferences: { getPreferences: async () => ({ get: async (key, fallback) => values.get(key) ?? fallback,
      put: async (key, value) => values.set(key, value), flush: async () => {} }) } },
    '@kit.ArkTS': { util }, '../network/InstanceConfig': { activeInstance, normalizeInstanceOrigin },
    './ConnectionSelectionStore': { ConnectionSelectionStore: class { read() { return pointer; } write(raw) {
      if (pointerError) throw pointerError;
      calls.push('commit'); pointer = raw;
    } } }
  });
  const alias = query => new TextDecoder().decode(query.get('alias'));
  const asset = { Tag: { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'return', ACCESSIBILITY: 'access', SYNC_TYPE: 'sync' },
    ReturnType: { ALL: 1 }, Accessibility: { DEVICE_FIRST_UNLOCKED: 1 }, SyncType: { NEVER: 0 },
    query: async query => assets.has(alias(query)) ? [assets.get(alias(query))] : [],
    add: async attrs => { if (assetError) throw assetError; assets.set(alias(attrs), attrs); },
    remove: async query => { calls.push('remove:' + alias(query)); assets.delete(alias(query)); } };
  const { TokenStore } = await load('common/storage/TokenStore', {
    '@kit.AssetStoreKit': { asset }, '@kit.ArkTS': { util }, '../network/InstanceConfig': { activeInstance }
  });
  const store = new InstanceStore(); await store.initialize({ filesDir: '/synthetic' });
  const { ReadCancellation } = await load('common/network/ReadCancellation', {});
  let token = '';
  function page(options = {}) {
    const module = { exports: {} };
    runInNewContext(loginCode, { module, exports: module.exports, Error, instanceStore: store, activeInstance, TokenStore,
      ReadCancellation, ConnectionProbe: class { check(input, cancellation) { calls.push('probe'); return probe(input, cancellation); } },
      appFeedback: { show: text => warnings.push(text) }, ApiError,
      loginErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
      validCapabilities, apiClient: { setToken: value => token = value, get: async () => {
        calls.push('capabilities'); if (restoreError) throw restoreError; return restoredCapabilities;
      } } });
    const login = new module.exports.Login();
    Object.assign(login, { generation: 0, restoreOnAppear: true, ready: false, committing: false,
      observeTopInset: async () => {}, formKeyboard: { clear() {} }, formScroller: { scrollTo() {} },
      getUIContext: () => ({ getHostContext: () => ({ filesDir: '/synthetic' }), getFocusController: () => ({ clearFocus() {} }) }),
      onConnected: () => calls.push('connected'), onInitialReady: () => calls.push('intro-ready'), ...options });
    login.onBackHandler = handler => login.back = handler;
    return login;
  }
  return { page, store, values, assets, calls, warnings, token: () => token, TokenStore,
    probe: handler => probe = handler, restoreCapabilities: value => restoredCapabilities = value,
    rejectRestore: status => restoreError = new ApiError(status),
    failCommit: error => pointerError = error, failAsset: error => assetError = error,
    legacy: raw => { pointer = undefined; values.set('current', JSON.stringify(raw)); } };
}

test('first launch can connect from the welcome screen without configuring AI', async () => {
  const f = await fixture(), first = f.page(); await first.aboutToAppear();
  assert.equal(first.ready, true); assert.deepEqual(f.calls, ['intro-ready']);
  assert.equal(f.calls.includes('probe'), false); assert.equal(f.calls.includes('capabilities'), false);
  const connect = first;
  connect.origin = 'https://synthetic.invalid'; connect.password = 'synthetic-password'; connect.localHttp = false;
  await connect.submit();
  assert.equal(f.calls.at(-1), 'connected'); assert.equal(await f.store.connectionDeferred(), false);
  assert.equal(f.token(), 'synthetic-token'); assert.equal((await f.store.restore()).instanceId, id);
  assert.equal(connect.password, ''); assert.ok(!JSON.stringify([...f.values]).includes('synthetic-password'));
});

test('fresh and previously opened launches keep the form on the same screen after failure', async () => {
  const f = await fixture(), page = f.page(); await page.aboutToAppear();
  assert.equal(page.ready, true); assert.ok(!f.calls.includes('probe'));
  await page.submit(); assert.ok(!f.calls.includes('probe'));
  page.origin = 'https://synthetic.invalid'; page.password = 'synthetic-password';
  f.probe(async () => { throw Error('synthetic offline'); });
  await page.submit(); assert.match(page.errorMessage, /offline/);
  assert.equal(page.origin, 'https://synthetic.invalid'); assert.equal(page.password, 'synthetic-password');
  f.values.set('connection-entry-seen', true);
  const restart = f.page(); await restart.aboutToAppear();
  assert.equal(restart.ready, true); assert.equal(restart.back(), false);
  assert.equal(await f.store.connectionDeferred(), false);
});

test('the old deferred preference opens the same form with settings and skips automatic restore', async () => {
  const f = await fixture(); await f.store.setConnectionDeferred(true);
  const page = f.page(); await page.aboutToAppear();
  assert.equal(page.ready, true); assert.equal(page.showLocalSettings, true);
  assert.deepEqual(f.calls, ['intro-ready']);
  assert.equal(f.assets.size, 0);
});

test('old saved connections without a token or with restore failure stay on the connection form, not the first entry', async () => {
  for (const failed of [false, true]) {
    const f = await fixture(); const saved = { origin: 'https://synthetic.invalid', namespace: id, instanceId: id, localHttp: false };
    f.legacy(saved);
    if (failed) {
      activeInstance.activate(saved.origin, id, capabilities); await f.TokenStore.write('synthetic-token'); f.rejectRestore(401);
    }
    const page = f.page(); await page.aboutToAppear();
    assert.equal(page.ready, true); assert.equal(page.origin, saved.origin);
    assert.equal(f.values.has('connection-entry-seen'), false);
  }
});

test('first form Back cancels the candidate check and keeps credential commit intact', async () => {
  {
    const f = await fixture(); const page = f.page(); await page.aboutToAppear();
    let release; f.probe(() => new Promise(resolve => release = resolve)); page.password = 'synthetic-password';
    const work = page.submit(); while (!release) await Promise.resolve();
    const cancellation = page.loginCancellation;
    assert.equal(page.back(), true);
    assert.equal(cancellation.cancelled, true); assert.equal(page.password, '');
    release({ origin: 'https://synthetic.invalid', localHttp: false, token: 'synthetic-token', capabilities }); await work;
    assert.equal(await f.store.restore(), undefined); assert.equal(f.assets.size, 0); assert.ok(!f.calls.includes('connected'));
  }
  const f = await fixture(), page = await connectPage(f); let release; const stage = f.TokenStore.stage;
  f.TokenStore.stage = async token => { const credential = await stage(token); await new Promise(resolve => release = resolve); return credential; };
  const work = page.submit(); while (!release) await Promise.resolve();
  assert.equal(page.committing, true); assert.equal(page.back(), true);
  assert.equal(page.ready, true); assert.ok(!f.calls.includes('pending')); release(); await work;
  assert.equal(f.calls.at(-1), 'connected'); assert.equal(page.committing, false);
});

test('legacy valid connection with no new marker restores directly, without first-use prompts or extra probe', async () => {
  const f = await fixture();
  const saved = { origin: 'https://synthetic.invalid', namespace: id, instanceId: id, localHttp: false };
  f.legacy(saved); activeInstance.activate(saved.origin, id, capabilities); await f.TokenStore.write('synthetic-token');
  f.calls.length = 0;
  const page = f.page(); await page.aboutToAppear();
  assert.deepEqual(f.calls, ['capabilities', 'connected']); assert.equal(page.ready, true);
  assert.equal(f.values.has('connection-deferred'), false); assert.equal(f.token(), 'synthetic-token');
});

test('failed first connection retains the explicit pending choice and never activates a candidate', async () => {
  const f = await fixture(); await f.store.setConnectionDeferred(true);
  f.probe(async () => { throw Error('synthetic offline'); });
  const page = f.page({ restoreOnAppear: false }); await page.aboutToAppear();
  page.origin = 'https://synthetic.invalid'; page.password = 'synthetic-password';
  const revision = activeInstance.revision; await page.submit();
  assert.match(page.errorMessage, /offline/); assert.equal(activeInstance.revision, revision);
  assert.equal(await f.store.restore(), undefined); assert.equal(await f.store.connectionDeferred(), true);
  assert.equal(f.assets.size, 0); assert.ok(!f.calls.includes('connected'));
});

test('late login completion after leaving cannot navigate or persist credentials', async () => {
  const f = await fixture(); let release;
  f.probe(() => new Promise(resolve => release = resolve));
  const page = f.page(); await page.aboutToAppear(); page.password = 'synthetic-password';
  const work = page.submit(); while (!release) await Promise.resolve(); page.aboutToDisappear();
  release({ origin: 'https://synthetic.invalid', localHttp: false, token: 'synthetic-token', capabilities }); await work;
  assert.equal(page.loginCancellation.cancelled, true); assert.equal(f.assets.size, 0);
  assert.equal(await f.store.restore(), undefined); assert.ok(!f.calls.includes('connected'));
  assert.ok(!f.calls.includes('pending'));
});

async function connectPage(f) {
  const page = f.page({ restoreOnAppear: false }); await page.aboutToAppear();
  page.origin = 'https://synthetic.invalid'; page.password = 'synthetic-password'; return page;
}

test('reconnect after defer retires the persisted old credential only after the new pointer commits', async () => {
  const f = await fixture(); const first = await connectPage(f); await first.submit();
  const original = await f.store.restore();
  await f.store.setConnectionDeferred(true); activeInstance.activate('', '');
  assert.ok(f.assets.has('public-token-' + original.credentialId));
  const reconnect = await connectPage(f); await reconnect.submit();
  const current = await f.store.restore();
  assert.notEqual(current.credentialId, original.credentialId);
  assert.equal(current.namespace, original.namespace); assert.equal(f.assets.size, 1);
  assert.ok(f.assets.has('public-token-' + current.credentialId));
  const removed = f.calls.indexOf('remove:public-token-' + original.credentialId);
  assert.ok(removed > f.calls.lastIndexOf('commit'));
});

test('probe, credential and pointer failures preserve the previous credential and pointer; retry succeeds', async () => {
  for (const failure of ['probe', 'asset', 'pointer']) {
    const f = await fixture(); await (await connectPage(f)).submit();
    const original = await f.store.restore(); await f.store.setConnectionDeferred(true);
    if (failure === 'probe') f.probe(async () => { throw Error('synthetic probe failure'); });
    if (failure === 'asset') f.failAsset(Error('synthetic asset failure'));
    if (failure === 'pointer') f.failCommit(Error('synthetic pointer failure'));
    const page = await connectPage(f); await page.submit();
    assert.deepEqual(await f.store.restore(), original, failure);
    assert.ok(f.assets.has('public-token-' + original.credentialId), failure);
    assert.equal(f.assets.size, 1, failure); assert.ok(page.errorMessage, failure);
    assert.equal(await f.store.connectionDeferred(), true, failure);
    f.failAsset(undefined); f.failCommit(undefined);
    f.probe(async () => ({ origin: original.origin, localHttp: false, token: 'synthetic-retry', capabilities }));
    await page.submit(); assert.equal(f.assets.size, 1);
    assert.equal(f.assets.has('public-token-' + original.credentialId), false);
  }
});

test('cancelled reconnect preserves old credentials, including cancellation while the new credential is staged', async () => {
  for (const phase of ['probe', 'stage']) {
    const f = await fixture(); await (await connectPage(f)).submit();
    const original = await f.store.restore(); let release;
    if (phase === 'probe') f.probe(() => new Promise(resolve => release = resolve));
    else {
      const stage = f.TokenStore.stage;
      f.TokenStore.stage = async token => {
        const credential = await stage(token);
        await new Promise(resolve => release = resolve); return credential;
      };
    }
    const page = await connectPage(f); const work = page.submit();
    while (!release) await Promise.resolve(); page.aboutToDisappear();
    release({ origin: original.origin, localHttp: false, token: 'synthetic-late', capabilities }); await work;
    assert.deepEqual(await f.store.restore(), original); assert.equal(f.assets.size, 1);
    assert.ok(f.assets.has('public-token-' + original.credentialId));
  }
});

test('restoration identity mismatch does not delete A; same-origin B login commits a new namespace before retiring A', async () => {
  const f = await fixture(); await (await connectPage(f)).submit(); const original = await f.store.restore();
  const changed = { ...capabilities, instanceId: '22222222-2222-2222-2222-222222222222' };
  f.restoreCapabilities(changed);
  const restored = f.page(); await restored.aboutToAppear();
  assert.match(restored.errorMessage, /连接信息已变化/); assert.equal(f.token(), '');
  assert.ok(f.assets.has('public-token-' + original.credentialId));
  assert.deepEqual(await f.store.restore(), original);
  f.probe(async () => ({ origin: original.origin, localHttp: false, token: 'synthetic-B', capabilities: changed }));
  restored.password = 'synthetic-password'; await restored.submit();
  const current = await f.store.restore(); assert.equal(current.instanceId, changed.instanceId);
  assert.notEqual(current.namespace, original.namespace); assert.equal(f.assets.size, 1);
  assert.equal(f.assets.has('public-token-' + original.credentialId), false);
});

test('401 restoration preserves the captured credential until successful reauthentication commits', async () => {
  const f = await fixture(); await (await connectPage(f)).submit(); const original = await f.store.restore();
  f.rejectRestore(401); const page = f.page(); await page.aboutToAppear();
  assert.equal(page.errorMessage, '登录已过期，请重新输入密码'); assert.equal(f.token(), '');
  assert.deepEqual(await f.store.restore(), original); assert.ok(f.assets.has('public-token-' + original.credentialId));
  page.password = 'synthetic-password'; await page.submit();
  assert.equal(f.assets.size, 1); assert.equal(f.assets.has('public-token-' + original.credentialId), false);
});

test('legacy namespace alias is retained on identity mismatch and retired after successful replacement', async () => {
  const f = await fixture();
  const saved = { origin: 'https://synthetic.invalid', namespace: id, instanceId: id, localHttp: false };
  f.legacy(saved); activeInstance.activate(saved.origin, id, capabilities); await f.TokenStore.write('synthetic-token');
  f.restoreCapabilities({ ...capabilities, instanceId: '22222222-2222-2222-2222-222222222222' });
  const page = f.page(); await page.aboutToAppear(); assert.ok(f.assets.has('public-token-' + id));
  page.password = 'synthetic-password'; await page.submit();
  assert.equal(f.assets.size, 1); assert.equal(f.assets.has('public-token-' + id), false);
  assert.ok((await f.store.restore()).credentialId);
});

test('real first-use view shows the HTTP choice directly, keeps context explanations and both wide/narrow forms scrollable', async () => {
  const options = await readFile(new URL('app/components/ConnectionOptions.ets', root), 'utf8');
  assert.match(loginSource, /ConnectionOptions\(\{ localHttp: \$localHttp/);
  assert.match(options, /Button[\s\S]*this.localHttp = !this.localHttp/);
  assert.match(loginSource, /请输入工作台地址和访问密码/);
  assert.doesNotMatch(loginSource, /稍后连接|login_defer_connection|skipConnection/);
  assert.equal((loginSource.match(/Scroll\(this\.formScroller\)/g) || []).length, 1);
  assert.match(loginSource, /if \(!this\.wideLayout\(\)\) this\.mobileWelcome\(\)[\s\S]*this\.accessContent\(\)/);
  assert.match(loginSource, /AppLogo\(\{ iconSize: 52/);
  const index = await readFile(new URL('pages/Index.ets', root), 'utf8');
  assert.match(index, /else if \(!this\.replacingConnection\) \{\s*LoginPage\(/);
  assert.match(index, /this\.settingsBack\(\)/);
  assert.match(index, /!this\.connected && this\.firstConnectionBack\(\)/);
  assert.doesNotMatch(index, /PendingConnectionPage|firstConnectionOpen/);
});

test('saved connection recovery does not turn Back into a disconnect and unregisters on leaving', async () => {
  const f = await fixture(); const page = await connectPage(f); await page.submit();
  const restore = f.page({ restoreOnAppear: false }); await restore.aboutToAppear();
  assert.equal(restore.back(), false); assert.equal(await f.store.connectionDeferred(), false);
  assert.ok(!f.calls.includes('pending'));
  const count = f.calls.length; page.aboutToDisappear(); page.back();
  assert.equal(f.calls.length, count);
});

test('actual pending settings storage remains isolated by the captured namespace across a connection change', async () => {
  const f = await fixture(), first = '11111111-1111-1111-1111-111111111111', second = '22222222-2222-2222-2222-222222222222';
  const pending = JSON.stringify({ instanceId: first, operationId: randomUUID(), expectedRevision: 3 });
  await f.store.writeAiSettingsPending(first, pending); activeInstance.activate('https://other.invalid', second);
  assert.equal(await f.store.readAiSettingsPending(first), pending); assert.equal(await f.store.readAiSettingsPending(second), '');
  await f.store.writeAiSettingsPending(first, ''); assert.equal(await f.store.readAiSettingsPending(first), '');
});


test('opening with deferred connection preserves stored selection and pre-fills its address', async () => {
  const f = await fixture(); await (await connectPage(f)).submit();
  const original = await f.store.restore(); await f.store.setConnectionDeferred(true);
  const page = f.page({ restoreOnAppear: false });
  await page.aboutToAppear();
  assert.equal(page.ready, true); assert.equal(page.origin, original.origin);
  const before = f.calls.filter(call => call === 'capabilities').length;
  page.password = 'temporary'; assert.equal(page.requestBack(), false); page.aboutToDisappear();
  assert.equal(page.password, ''); assert.equal(f.calls.at(-1), 'intro-ready');
  assert.deepEqual(await f.store.restore(), original);
  assert.equal(await f.store.connectionDeferred(), true);
  assert.equal(f.calls.filter(call => call === 'capabilities').length, before);
});

test('Back with deferred connection cancels an in-flight probe and keeps the main form', async () => {
  const f = await fixture(); let release;
  await f.store.setConnectionDeferred(true);
  f.probe(() => new Promise(resolve => release = resolve));
  const page = f.page({ restoreOnAppear: false });
  await page.aboutToAppear(); page.password = 'temporary';
  const work = page.submit(); while (!release) await Promise.resolve();
  page.requestBack();
  assert.equal(page.ready, true); assert.equal(page.password, '');
  release({ origin: 'https://synthetic.invalid', localHttp: false, token: 'late', capabilities }); await work;
  assert.equal(await f.store.restore(), undefined); assert.equal(f.assets.size, 0);
  assert.ok(!f.calls.includes('connected'));
});

test('closing pending connection cannot interrupt the credential commit', async () => {
  const f = await fixture(); let release;
  const stage = f.TokenStore.stage;
  f.TokenStore.stage = async token => { await new Promise(resolve => release = resolve); return stage(token); };
  const page = f.page({ restoreOnAppear: false });
  await page.aboutToAppear(); page.password = 'temporary';
  const work = page.submit(); while (!release) await Promise.resolve();
  page.requestBack(); assert.ok(!f.calls.includes('pending'));
  release(); await work;
  assert.equal(f.calls.at(-1), 'connected'); assert.equal(f.assets.size, 1);
});
