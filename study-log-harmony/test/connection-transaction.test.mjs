import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { activeInstance, normalizeInstanceOrigin, validCapabilities } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

const root = new URL('../entry/src/main/ets/', import.meta.url);
async function load(file, deps = {}, extra = {}) {
  const source = await readFile(new URL(file + '.ets', root), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Error, JSON, Date, Map, Uint8Array,
    Observed: value => value, ...extra,
    require(name) { assert.ok(name in deps, `Missing ${name}`); return deps[name]; } });
  return module.exports;
}
const { ReadCancellation } = await load('common/network/ReadCancellation');
const { ConnectionController } = await load('app/ConnectionController', {
  '../common/network/ReadCancellation': { ReadCancellation }
});
const first = '11111111-1111-1111-1111-111111111111', second = '22222222-2222-2222-2222-222222222222';
const capabilities = id => ({ instanceId: id, apiContractVersion: 1, features:
  Object.fromEntries(['aiWriting', 'aiHighlighting', 'aiNoteExtraction', 'aiTaxonomy', 'rag'].map(key => [key, { supported: true, configured: false }])) });
const candidate = { origin: 'https://b.example', localHttp: false, token: 'synthetic-b-token', capabilities: capabilities(second) };
const input = { origin: candidate.origin, password: 'synthetic', localHttp: false };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function controller(overrides = {}) {
  let binding = 'A', commits = 0, opened = 0, confirmations = 0;
  const actions = { binding: () => binding, check: async () => candidate,
    confirm: async () => { confirmations++; return true; },
    commit: async (_candidate, current) => { assert.ok(current()); commits++; binding = 'B'; },
    connected: () => opened++, ...overrides };
  return { data: new ConnectionController(actions), actions, binding: value => binding = value,
    stats: () => ({ commits, opened, confirmations }) };
}

test('candidate failure and rejected confirmation keep the active workspace untouched', async () => {
  const failure = controller({ check: async () => { throw Error('synthetic 401'); } });
  await failure.data.connect(input);
  assert.equal(failure.data.error, 'synthetic 401');
  assert.deepEqual(failure.stats(), { commits: 0, opened: 0, confirmations: 0 });
  const declined = controller({ confirm: async () => false });
  await declined.data.connect(input);
  assert.equal(declined.stats().commits, 0); assert.equal(declined.stats().opened, 0);
});

test('cancel ignores late success, 401/error and confirmation; no credential or workspace commit', async () => {
  for (const result of ['success', 'error', 'confirm']) {
    const late = deferred();
    const fixture = controller(result === 'confirm' ? { confirm: () => late.promise } : { check: () => late.promise });
    const work = fixture.data.connect(input);
    await Promise.resolve();
    assert.equal(fixture.data.cancel(), true);
    if (result === 'error') late.reject(Error('late 401'));
    else late.resolve(result === 'confirm' ? true : candidate);
    await work;
    assert.equal(fixture.stats().commits, 0); assert.equal(fixture.stats().opened, 0);
    assert.equal(fixture.data.error, ''); assert.equal(fixture.data.busy, false);
  }
});

test('a changed source binding invalidates the candidate; repeat submission and commit cancellation are gated', async () => {
  const late = deferred(), stale = controller({ check: () => late.promise });
  const work = stale.data.connect(input); stale.binding('expired'); late.resolve(candidate); await work;
  assert.equal(stale.stats().commits, 0);
  const commit = deferred(); let calls = 0;
  const accepted = controller({ commit: async () => { calls++; await commit.promise; } });
  const connection = accepted.data.connect(input);
  while (!accepted.data.committing) await Promise.resolve();
  await accepted.data.connect(input); assert.equal(calls, 1);
  assert.equal(accepted.data.cancel(), false);
  commit.resolve(); await connection;
  assert.equal(accepted.stats().opened, 1); assert.equal(accepted.data.busy, false);
});

test('candidate probe owns URLs, temporary credentials and cancellation without changing A', async () => {
  activeInstance.activate('https://a.example', first, capabilities(first));
  const binding = activeInstance.revision, requests = [];
  const rcp = { Request: class { constructor(url, method, headers, body) { Object.assign(this, { url, method, headers, body }); } },
    createSession: () => ({ cancel() {}, close() {}, fetch: async request => {
      requests.push(request);
      return { statusCode: 200, toString: () => JSON.stringify(request.method === 'POST' ?
        { ok: true, token: candidate.token, expiresAt: '2099-01-01T00:00:00Z' } : capabilities(second)) };
    } }) };
  class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
  const { ConnectionProbe } = await load('common/network/ConnectionProbe', {
    '@kit.RemoteCommunicationKit': { rcp }, './ApiClient': { ApiError },
    './InstanceConfig': { normalizeInstanceOrigin, validCapabilities }
  });
  const result = await new ConnectionProbe().check(input, new ReadCancellation());
  assert.equal(result.capabilities.instanceId, second);
  assert.deepEqual(requests.map(item => item.url), ['https://b.example/study-log/api/auth/app-login', 'https://b.example/study-log/api/capabilities']);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[1].headers.authorization, `Bearer ${candidate.token}`);
  assert.equal(activeInstance.origin, 'https://a.example'); assert.equal(activeInstance.revision, binding);
  const cancellation = new ReadCancellation(); cancellation.cancel();
  await assert.rejects(new ConnectionProbe().check(input, cancellation), /取消/);
  assert.equal(requests.length, 2);
});

async function storageFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'study-log-connection-synthetic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = { OpenMode: { CREATE: fs.constants.O_CREAT, READ_WRITE: fs.constants.O_RDWR, TRUNC: fs.constants.O_TRUNC },
    accessSync: fs.existsSync, readTextSync: file => fs.readFileSync(file, 'utf8'),
    openSync: (file, flags) => ({ fd: fs.openSync(file, flags) }), writeSync: fs.writeSync,
    fsyncSync: fs.fsyncSync, closeSync: file => fs.closeSync(file.fd), renameSync: fs.renameSync };
  const util = { generateRandomUUID: randomUUID, TextEncoder: class { encodeInto(raw) { return new TextEncoder().encode(raw); } } };
  const { ConnectionSelectionStore } = await load('common/storage/ConnectionSelectionStore', { '@kit.CoreFileKit': { fileIo: files }, '@kit.ArkTS': { util } });
  const values = new Map();
  const prefs = { get: async (key, fallback) => values.get(key) ?? fallback, put: async (key, value) => values.set(key, value), flush: async () => {} };
  const { InstanceStore } = await load('common/storage/InstanceStore', {
    '@kit.ArkData': { preferences: { getPreferences: async () => prefs } }, '@kit.ArkTS': { util },
    '../network/InstanceConfig': { activeInstance, normalizeInstanceOrigin }, './ConnectionSelectionStore': { ConnectionSelectionStore }
  });
  const store = new InstanceStore(); await store.initialize({ filesDir: directory });
  return { store, values, files, directory, ConnectionSelectionStore };
}

async function host(file, names, globals) {
  const source = await readFile(new URL(file + '.ets', root), 'utf8');
  const methods = names.map(name => {
    const start = source.search(new RegExp(`^  (?:private )?(?:async )?${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    const next = source.slice(start + 1).search(/^  (?:private |@|aboutTo|build\()/m);
    assert.ok(next >= 0, `${name} boundary`);
    return source.slice(start, start + next + 1);
  }).join('\n');
  const code = ts.transpileModule(`export class Host { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Error, Promise, ...globals });
  return new module.exports.Host();
}

test('actual Index commit protects A across credential, editor, note and pointer failures; retry and same-address isolation succeed', async t => {
  for (const fault of ['credential', 'snapshot', 'notes', 'log-storage', 'rename', 'stale']) {
    const { store, values, files } = await storageFixture(t);
    const assets = new Map(), aliasOf = query => new TextDecoder().decode(query.get('alias'));
    let failCredential = false, invalidateStage = false, bindingValid = true;
    const asset = { Tag: { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'return', ACCESSIBILITY: 'access', SYNC_TYPE: 'sync' },
      ReturnType: { ALL: 1 }, Accessibility: { DEVICE_FIRST_UNLOCKED: 1 }, SyncType: { NEVER: 0 },
      query: async query => assets.has(aliasOf(query)) ? [assets.get(aliasOf(query))] : [],
      remove: async query => { assets.delete(aliasOf(query)); },
      add: async attrs => { assets.set(aliasOf(attrs), attrs); if (invalidateStage) bindingValid = false;
        if (failCredential) throw Error('synthetic credential failure'); } };
    const { TokenStore } = await load('common/storage/TokenStore', {
      '@kit.AssetStoreKit': { asset }, '@kit.ArkTS': { util: { generateRandomUUID: randomUUID,
        TextEncoder: class { encodeInto(raw) { return new TextEncoder().encode(raw); } },
        TextDecoder: class { decodeToString(bytes) { return new TextDecoder().decode(bytes); } } } },
      '../network/InstanceConfig': { activeInstance }
    });
    const old = { origin: 'https://a.example', namespace: first, instanceId: first, localHttp: false };
    store.commit(old, capabilities(first));
    values.set(`instance:${old.origin}:${first}`, first);
    await TokenStore.write('synthetic-a-token');
    let token = 'synthetic-a-token', faultActive = true;
    const drafts = new Map(), noteDrafts = new Map();
    const page = await host('pages/Index', ['connectionCanLeave', 'commitConnection'], {
      activeInstance, instanceStore: store, TokenStore, apiClient: { setToken: value => token = value },
      logDraftStore: { save: draft => { if (fault === 'log-storage' && faultActive) throw Error('synthetic log storage failure');
        drafts.set(draft.namespace, draft); }, clear: namespace => drafts.delete(namespace) }
    });
    page.modules = { qaDirty: true, notesDirty: true, prepareNotesConnection: () => {
      if (fault === 'notes' && faultActive) throw Error('synthetic note storage failure');
      noteDrafts.set(first, 'synthetic note draft');
    } };
    page.captureDraft = async strict => {
      assert.equal(strict, true);
      if (fault === 'snapshot' && faultActive) throw Error('synthetic editor failure');
      return { namespace: first, date: '2026-01-02', text: 'synthetic unsaved log', baseVersion: 'synthetic-v1' };
    };
    const rename = files.renameSync;
    if (fault === 'rename') files.renameSync = () => { throw Error('synthetic pointer failure'); };
    failCredential = fault === 'credential';
    invalidateStage = fault === 'stale';
    const revision = activeInstance.revision;
    const replacement = { ...candidate, origin: old.origin }; // Same address, different server identity.
    await assert.rejects(page.commitConnection(replacement, () => bindingValid && activeInstance.revision === revision), /synthetic|工作台已变化/);
    assert.equal(activeInstance.origin, old.origin); assert.equal(activeInstance.namespace, first);
    assert.equal(activeInstance.revision, revision); assert.equal((await store.restore()).instanceId, first);
    assert.equal(await TokenStore.read(), 'synthetic-a-token'); assert.equal(token, 'synthetic-a-token');
    assert.equal(assets.size, 1, 'failed candidate never deletes A or retains its staged token');
    assert.equal(page.modules.qaDirty, true); assert.equal(page.modules.notesDirty, true);
    faultActive = false; failCredential = false; invalidateStage = false; bindingValid = true; files.renameSync = rename;
    await page.commitConnection(replacement, () => activeInstance.revision === revision);
    assert.equal(activeInstance.capabilities.instanceId, second); assert.notEqual(activeInstance.namespace, first);
    assert.equal(await TokenStore.read(), candidate.token); assert.equal(token, candidate.token);
    assert.equal((await store.restore()).credentialId, activeInstance.credentialId);
    assert.equal(page.connected, false); assert.equal(page.replacingConnection, true);
    assert.equal(drafts.get(first).text, 'synthetic unsaved log'); assert.equal(noteDrafts.get(first), 'synthetic note draft');
    assert.equal(assets.size, 1, 'successful commit retires only the captured old credential');
    assert.equal((await store.prepare(old.origin, capabilities(first), false)).namespace, first);
  }
});

test('actual confirmation reports same-address identity changes and does not discard any draft before a decision', async () => {
  activeInstance.activate('https://a.example', first, capabilities(first));
  const dialogs = [];
  const page = await host('pages/Index', ['connectionCanLeave', 'confirmConnection'], {
    activeInstance, AlertDialog: { show: options => dialogs.push(options) }
  });
  page.modules = { qaDirty: true, notesDirty: true };
  const result = page.confirmConnection({ ...candidate, origin: activeInstance.origin });
  assert.equal(dialogs[0].title, '工作台身份已变化'); assert.match(dialogs[0].message, /问答编辑将放弃/);
  assert.match(dialogs[0].message, /原草稿不会带入/);
  assert.equal(page.modules.qaDirty, true); assert.equal(page.modules.notesDirty, true);
  dialogs[0].primaryButton.action(); assert.equal(await result, false);
  const accepted = page.confirmConnection(candidate);
  dialogs[1].secondaryButton.action(); assert.equal(await accepted, true);
  assert.equal(page.modules.qaDirty, true); assert.equal(page.modules.notesDirty, true);
  page.modules.taxonomyDirty = true;
  assert.throws(() => page.confirmConnection(candidate), /先保存或放弃分类修改/);
});

test('actual log snapshot fails strictly for connection but keeps expiry fallback; notes unload stays in captured A', async () => {
  activeInstance.activate('https://a.example', first, capabilities(first));
  const log = await host('features/logs/LogsReaderPage', ['captureDraft'], { activeInstance });
  log.documents = {}; log.editorReady = true;
  log.session = { selectedDate: '2026-01-02', text: 'last observed', baseline: 'saved', baseVersion: 'v1', isDirty: () => true };
  log.editor = { command: async () => { throw Error('synthetic snapshot error'); } };
  await assert.rejects(log.captureDraft(true), /snapshot error/);
  assert.equal((await log.captureDraft()).text, 'last observed');
  log.editor.command = async () => ({ documentKey: 'different', text: 'wrong document' });
  await assert.rejects(log.captureDraft(true), /日志已变化/);
  const writes = [];
  const notes = await host('features/notes/NotesPage', ['preserveConnectionDraft', 'aboutToDisappear'], {
    activeInstance, noteDraftStore: { save: draft => writes.push(draft) }
  });
  Object.assign(notes, { draftNamespace: first, noteEditor: { editing: true, baseline: 'saved', revision: 0, draft: namespace => ({ namespace, body: 'synthetic note' }) },
    editorValue: () => 'synthetic note', data: { dispose() {} }, resultChanges: { reset() {} }, resultSurface: { clear() {} } });
  notes.preserveConnectionDraft();
  activeInstance.activate('https://b.example', second, capabilities(second));
  notes.aboutToDisappear();
  assert.deepEqual(writes.map(item => item.namespace), [first, first]);
  assert.throws(() => notes.preserveConnectionDraft(), /工作台已变化/);
});

test('disposing the actual controller invalidates a delayed credential-stage continuation', async () => {
  const staged = deferred(); let activated = false;
  const fixture = controller({ commit: async (_candidate, current) => { await staged.promise; if (current()) activated = true; } });
  const work = fixture.data.connect(input);
  while (!fixture.data.committing) await Promise.resolve();
  fixture.data.dispose(); staged.resolve(); await work;
  assert.equal(activated, false); assert.equal(fixture.stats().opened, 0);
});

test('actual connection completion waits for the old workspace unmount frame and never restores a superseded session', async () => {
  for (const superseded of [false, true]) {
    activeInstance.activate(candidate.origin, second, candidate.capabilities);
    const frames = []; let opened = 0, binding = 'committed-B';
    const page = await host('pages/Index', ['createConnectionController'], {
      activeInstance, apiClient: { getConnectionBinding: () => binding },
      ConnectionProbe: class {}, ConnectionController: class { constructor(actions) { this.actions = actions; } },
      FrameAction: class { constructor(action) { this.action = action; } }
    });
    page.connectionOpen = true; page.replacingConnection = true; page.connected = false;
    page.getUIContext = () => ({ postFrameCallback: frame => frames.push(frame.action) });
    page.connectedTo = async () => { opened++; page.connected = true; };
    const finished = page.createConnectionController().actions.connected();
    assert.equal(frames.length, 1); assert.equal(opened, 0); assert.equal(page.connected, false);
    if (superseded) binding = 'expired';
    frames.shift()(); await finished;
    assert.equal(opened, superseded ? 0 : 1);
    assert.equal(page.connectionOpen, false); assert.equal(page.replacingConnection, false);
  }
});

test('the real selection store preserves A through prepare/write/rename failures and restores B only after commit', async t => {
  const { store, values, files, directory } = await storageFixture(t);
  const old = { origin: 'https://a.example', namespace: first, instanceId: first, localHttp: false };
  values.set('current', JSON.stringify(old));
  assert.equal((await store.restore()).namespace, first); // Upgrade fallback, not a destructive migration.
  activeInstance.activate(old.origin, old.namespace, capabilities(first)); const revision = activeInstance.revision;
  const prepared = await store.prepare(candidate.origin, candidate.capabilities, false);
  assert.equal(activeInstance.revision, revision); assert.equal((await store.restore()).origin, old.origin);
  store.commit(old, capabilities(first));
  const rename = files.renameSync;
  files.renameSync = () => { throw Error('synthetic rename failure'); };
  assert.throws(() => store.commit(prepared, candidate.capabilities), /rename failure/);
  assert.equal(activeInstance.origin, old.origin); assert.equal((await store.restore()).namespace, first);
  files.renameSync = rename;
  const write = files.writeSync; files.writeSync = () => 0;
  assert.throws(() => store.commit(prepared, candidate.capabilities), /写入不完整/);
  assert.equal((await store.restore()).origin, old.origin); files.writeSync = write;
  prepared.credentialId = second;
  store.commit(prepared, candidate.capabilities);
  assert.equal(activeInstance.origin, candidate.origin); assert.equal(activeInstance.credentialId, second);
  const restored = await store.restore(); assert.equal(restored.instanceId, second); assert.equal(restored.credentialId, second);
  const raw = fs.readFileSync(path.join(directory, 'public-current-connection.json'), 'utf8');
  assert.ok(!raw.includes(candidate.token)); assert.ok(!raw.includes(input.password));
});

test('source panel wiring keeps A mounted, protects drafts before commit and routes Escape through cancellation', async () => {
  const index = await readFile(new URL('pages/Index.ets', root), 'utf8');
  const start = index.indexOf('    commands.changeServer = '), end = index.indexOf('    commands.refreshNavigation', start);
  assert.ok(start >= 0 && end > start);
  const open = index.slice(start, end);
  assert.match(open, /connectionOpen = true/); assert.doesNotMatch(open, /setToken|activate|confirmQaLeave|confirmNotesLeave|confirmLogLeave/);
  const commitStart = index.indexOf('  private async commitConnection('), commitEnd = index.indexOf('  private updateBreakpoint(', commitStart);
  assert.ok(commitStart >= 0 && commitEnd > commitStart);
  const commit = index.slice(commitStart, commitEnd);
  assert.ok(commit.indexOf('captureDraft(true)') < commit.indexOf('instanceStore.commit('));
  assert.ok(commit.indexOf('prepareNotesConnection?.()') < commit.indexOf('instanceStore.commit('));
  assert.match(commit, /if \(credentialId && !committed\) await TokenStore.removeCredential\(credentialId\)/);
  assert.match(commit, /this\.replacingConnection = true;\s*this\.connected = false;/);
  assert.match(index, /else if \(!this\.replacingConnection\) \{\s*LoginPage\(/);
  assert.match(index, /if \(capabilities\) await this\.connectedTo\(activeInstance\.origin, capabilities\)/);
  assert.match(index, /if \(this.connectionOpen\) \{ this.closeConnection\(\); return true; \}/);
  const notes = await readFile(new URL('features/notes/NotesPage.ets', root), 'utf8');
  const leaveStart = notes.indexOf('  aboutToDisappear()'), leaveEnd = notes.indexOf('  private localTimestamp(', leaveStart);
  assert.ok(leaveStart >= 0 && leaveEnd > leaveStart);
  assert.match(notes.slice(leaveStart, leaveEnd), /noteEditor\.draft\(this\.draftNamespace\)/);
  assert.doesNotMatch(notes.slice(leaveStart, leaveEnd), /noteEditor\.draft\(activeInstance\.namespace\)/);
});
