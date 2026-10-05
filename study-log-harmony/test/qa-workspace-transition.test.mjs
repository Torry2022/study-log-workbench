import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const base = new URL('../entry/src/main/ets/', import.meta.url);
const rootSource = await readFile(new URL('pages/Index.ets', base), 'utf8');
const bridgeSource = await readFile(new URL('app/WorkspaceNavigationBridge.ets', base), 'utf8');
const surface = await readFile(new URL('app/components/WorkspaceSurface.ets', base), 'utf8');
const content = await readFile(new URL('app/components/WorkspaceContent.ets', base), 'utf8');

function method(name) {
  const start = rootSource.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing host handler ${name}`);
  const end = rootSource.slice(start + 1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
  assert.ok(end >= 0);
  return rootSource.slice(start, start + 1 + end);
}

test('QA session presentation callbacks reach the workspace host instead of default no-ops', () => {
  assert.match(surface, /onBeforeQaSessionChange:\s*\(\)\s*=>\s*this\.navigationCommands\.beforeQaSessionChange\(\)/);
  assert.match(surface, /onQaSessionReady:\s*\(\)\s*=>\s*this\.navigationCommands\.qaSessionReady\(\)/);
  assert.match(content, /onBeforeSessionChange:\s*\(\)\s*=>\s*this\.onBeforeQaSessionChange\(\)/);
  assert.match(content, /onSessionReady:\s*\(\)\s*=>\s*this\.onQaSessionReady\(\)/);
});

test('detail capture eligibility preserves compact layouts and other module boundaries', () => {
  const initializer = rootSource.match(/new WorkspaceTransitionCoordinator\(([\s\S]*?)\n  \}\);/);
  assert.ok(initializer);
  const module = { exports: {} };
  const code = ts.transpileModule(`export function view() { return ${initializer[1]}\n}; }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports });
  const root = { connected: true, selectedModule: 3, isWide: () => true };
  const view = module.exports.view.call(root);
  assert.equal(view.canCapture('detail:3'), true);
  root.selectedModule = 1;
  assert.equal(view.canCapture('detail:3'), false);
  root.selectedModule = 3; root.isWide = () => false;
  assert.equal(view.canCapture('detail:3'), false);
  root.isWide = () => true; root.connected = false;
  assert.equal(view.canCapture('detail:3'), false);
});

test('host captures only active QA details and obsolete workspace callbacks cannot finish a replacement transition', async () => {
  const module = { exports: {} };
  const code = ts.transpileModule(`${bridgeSource.replace(/^import .*;\r?\n/gm, '')}
    export class Root { ${method('registerWorkspaceNavigation')} ${method('coverQaSessionTransition')} }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports, AppStorage: { get: () => false } });
  const root = new module.exports.Root();
  const calls = [];
  Object.assign(root, { selectedModule: 3, modules: { outgoingTab: -1 }, sidebar: {},
    clearModuleNavigation() { this.workspaceNavigationView = undefined; },
    workspaceTransition: { snapshot: undefined, task: undefined,
      cover: async kind => calls.push(['cover', kind]), finish: kind => calls.push(['finish', kind]) } });
  const old = root.registerWorkspaceNavigation({});
  await old.beforeQaSessionChange();
  old.qaSessionReady();
  assert.deepEqual(calls, [['cover', 'detail:3'], ['finish', 'detail:3']]);
  for (const state of [{ selectedModule: 0 }, { selectedModule: 3, outgoingTab: 1 },
    { selectedModule: 3, outgoingTab: -1, snapshot: {} }, { selectedModule: 3, outgoingTab: -1, task: Promise.resolve() }]) {
    root.selectedModule = state.selectedModule;
    root.modules.outgoingTab = state.outgoingTab ?? -1;
    root.workspaceTransition.snapshot = state.snapshot;
    root.workspaceTransition.task = state.task;
    await old.beforeQaSessionChange();
  }
  assert.equal(calls.length, 2);
  root.registerWorkspaceNavigation({});
  await old.beforeQaSessionChange();
  old.qaSessionReady();
  assert.equal(calls.length, 2);
});
