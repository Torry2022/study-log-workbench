import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const base = '../entry/src/main/ets/';
const sources = await Promise.all(['app/WorkspaceModuleState.ets', 'features/qa/QaNavigationController.ets',
  'features/favorites/FavoritesController.ets', 'pages/Index.ets', 'app/WorkspaceSearchController.ets',
  'features/logs/LogSearchRepository.ets', 'features/logs/SearchHistoryStore.ets'].map(path => readFile(new URL(base + path, import.meta.url), 'utf8')));
const rootMethods = ['createQaNavigation', 'createWorkspaceSearch', 'invalidateModules', 'resetModules', 'connectedTo', 'changeServer'].map(name => {
  const start = sources[3].search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = sources[3].slice(start + 1).search(/^  (?:private |aboutTo|build\()/m);
  assert.ok(end >= 0, name);
  return sources[3].slice(start, start + end + 1);
}).join('\n');
const code = ts.transpileModule([...sources.slice(0, 3), ...sources.slice(4)].map(source =>
  source.replace(/^import .*;\r?\n/gm, '').replace('@Observed', '')).join('\n') +
  `\nexport class Root { ${rootMethods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function subject(api = {}) {
  const module = { exports: {} };
  const instance = { revision: 1, namespace: 'synthetic-a', activate() { this.revision++; this.namespace = ''; } };
  const transport = { setToken() {}, ...api };
  runInNewContext(code, { module, exports: module.exports, apiClient: transport, activeInstance: instance,
    LoadingHintPlacement: class {}, util: { generateRandomUUID: () => 'synthetic-mutation' },
    logDraftStore: { initialize: async () => {}, load: () => undefined },
    appFeedback: { show() {} } });
  const root = new module.exports.Root();
  Object.assign(root, { connected: true, selectedModule: 3,
    modules: new module.exports.WorkspaceModuleState(),
    favoritesData: new module.exports.FavoritesController(transport),
    preferencesReady: Promise.resolve(), drafts: new Map(), rememberSearch: false, searchOpen: false,
    getUIContext: () => ({ getHostContext: () => ({}) }) });
  root.qaNavigation = root.createQaNavigation();
  root.search = root.createWorkspaceSearch();
  return { root, instance };
}

test('successful connection resets module filters, drafts and controllers as one workspace lifetime', async () => {
  const { root } = subject();
  const old = root.modules, oldFavorites = root.favoritesData, oldQa = root.qaNavigation;
  old.notesDirty = true;
  old.noteYearFilter = '2026';
  old.qaPending = true;
  old.qaSessionId = 'old-session';
  old.statsMonth = '2026-02';
  old.taxonomyOpen = true;
  await root.connectedTo('', {});
  assert.notEqual(root.modules, old);
  assert.notEqual(root.favoritesData, oldFavorites);
  assert.notEqual(root.qaNavigation, oldQa);
  assert.equal(oldFavorites.generation(), 1);
  assert.equal(oldQa.qaMutationRevision, 1);
  assert.equal(root.modules.notesDirty, false);
  assert.equal(root.modules.noteYearFilter, 'all');
  assert.equal(root.modules.qaPending, false);
  assert.equal(root.modules.qaSessionId, '');
  assert.equal(root.modules.statsMonth, '');
  assert.equal(root.modules.taxonomyOpen, false);
  assert.equal(root.selectedModule, 0);
});

test('a superseded connection cannot reset the current workspace modules', async () => {
  const { root, instance } = subject();
  let release;
  root.preferencesReady = new Promise(resolve => { release = resolve; });
  const original = root.modules;
  const connecting = root.connectedTo('', {});
  instance.revision++;
  release();
  await connecting;
  assert.equal(root.modules, original);
  assert.equal(root.selectedModule, 3);
});

test('late QA navigation from the previous instance cannot populate the new workspace', async () => {
  let release;
  const { root } = subject({ get: () => new Promise(resolve => { release = resolve; }) });
  const old = root.qaNavigation;
  const pending = old.loadQaNavigation();
  root.changeServer();
  root.resetModules();
  root.connected = true;
  root.selectedModule = 3;
  release({ sessions: [{ id: 'old-session' }] });
  await pending;
  assert.equal(old.qaSessions.length, 0);
  assert.equal(root.qaNavigation.qaSessions.length, 0);
  assert.equal(root.modules.qaBusy, false);
});

test('late QA mutation cleanup cannot clear a new instance busy state or selected session', async () => {
  let release;
  const { root } = subject({ delete: () => new Promise(resolve => { release = resolve; }) });
  const old = root.qaNavigation;
  old.qaSessions = [{ id: 'old-session', version: 'v1' }];
  root.modules.qaSessionId = 'old-session';
  const pending = old.deleteQaSession('old-session');
  assert.equal(root.modules.qaBusy, true);
  root.changeServer();
  root.resetModules();
  root.connected = true;
  root.selectedModule = 3;
  root.modules.qaBusy = true;
  root.modules.qaSessionId = 'new-session';
  release({ ok: true });
  await pending;
  assert.equal(root.modules.qaBusy, true);
  assert.equal(root.modules.qaSessionId, 'new-session');
  assert.equal(root.modules.qaRequestRevision, 0);
});

test('late search response after changing instance cannot populate either workspace', async () => {
  let release;
  const { root } = subject({ get: () => new Promise(resolve => { release = resolve; }) });
  const old = root.search; old.changeLogSearchQuery('synthetic');
  const request = old.searchLogs(); assert.equal(root.searchOpen, true);
  root.changeServer(); root.resetModules(); root.connected = true;
  release({ results: [{ date: 'old-instance' }] }); await request;
  assert.equal(old.searchResults.length, 0); assert.equal(root.search.searchResults.length, 0);
  assert.equal(root.searchOpen, false); assert.equal(root.search.searchQuery, '');
});
