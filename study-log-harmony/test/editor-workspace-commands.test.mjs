import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const pageSource = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const callback = pageSource.match(/this\.editor\.onCommand = \(command: string\) => \{([\s\S]*?)\n    \};/)?.[1];
assert.ok(callback);
const dispatch = runInNewContext(`(function(command) { ${callback} })`);

test('the actual editor callback forwards workspace commands and preserves local save/link/search actions', () => {
  const calls = [];
  const page = { save: () => calls.push('save'), openLink: () => calls.push('internalLink'),
    searchOpen: false, searchFocusRevision: 0, shortcutBlocked: () => false,
    navigationCommands: { editorCommand: command => calls.push(command) } };
  for (const command of ['save', 'internalLink', 'help', 'focusNext', 'focusPrevious', 'menuFocus', 'newLog', 'newQa']) dispatch.call(page, command);
  assert.deepEqual(calls, ['save', 'internalLink', 'help', 'focusNext', 'focusPrevious', 'menuFocus', 'newLog', 'newQa']);
  dispatch.call(page, 'globalSearch');
  assert.equal(page.searchOpen, true);
  assert.equal(page.searchFocusRevision, 1);
});

const rootSource = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../entry/src/main/ets/app/WorkspaceNavigationBridge.ets', import.meta.url), 'utf8');
const methods = ['focusWorkspaceRegion', 'editorWorkspaceCommand', 'registerWorkspaceNavigation'].map(name => {
  const start = rootSource.indexOf(`  private ${name}(`);
  assert.ok(start >= 0);
  const end = rootSource.slice(start + 1).search(/^  private /m);
  return rootSource.slice(start, start + end + 1);
}).join('\n');
function fixture() {
  const module = { exports: {} }, focused = [], pending = [], actions = [];
  const code = `${bridgeSource.replace(/^import .*;\r?\n/gm, '')}\nexport class Root { ${methods} }`;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, AppStorage: { get: () => false },
      focusControl: { requestFocus: id => { focused.push(id); return true; } } });
  const root = new module.exports.Root();
  Object.assign(root, { connected: true, isWide: () => true, focusRegion: -1, selectedModule: 0,
    sidebar: { collapsedModules: [false, false, false, false, false] }, reading: { logsReadingMode: false },
    modules: {}, desktopWindowChrome: true, menuFocusRevision: 0, desktopCommands: { blocked: () => false },
    clearModuleNavigation: () => { root.workspaceNavigationView = undefined; },
    openHelp: () => actions.push('help'), requestModule: (tab, _notes, _qa, action) => pending.push({ tab, action }),
    switchQaSession: (id, focus) => actions.push(['qa', id, focus]) });
  const view = { openLogDatePicker: mode => actions.push(['log', mode]) };
  const commands = root.registerWorkspaceNavigation(view);
  return { root, commands, focused, pending, actions };
}

test('editor F6 uses the same application-owned forward/reverse and reading focus cycle', () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) f.commands.editorCommand('focusNext');
  f.commands.editorCommand('focusPrevious');
  assert.deepEqual(f.focused, ['global_log_search', 'sidebar_collapse', 'module_frame', 'sidebar_collapse']);
  f.root.sidebar.collapsedModules[0] = true;
  f.root.focusRegion = 0; f.commands.focusRegion(false);
  assert.equal(f.focused.at(-1), 'sidebar_rail_expand');
  f.root.reading.logsReadingMode = true; f.commands.editorCommand('focusNext');
  assert.equal(f.focused.at(-1), 'module_frame');
});

test('editor commands respect overlays, narrow focus rules, and stale view bindings', () => {
  for (const flag of ['settingsOpen', 'aboutOpen', 'helpOpen', 'previewImageSource', 'desktopMenuOpen']) {
    const f = fixture(); f.root[flag] = true;
    for (const command of ['help', 'focusNext', 'menuFocus', 'newLog', 'newQa']) f.commands.editorCommand(command);
    assert.equal(f.focused.length + f.pending.length + f.actions.length + f.root.menuFocusRevision, 0);
  }
  const f = fixture(); f.root.desktopCommands.blocked = () => true;
  f.commands.editorCommand('newLog'); assert.equal(f.pending.length, 0);
  f.root.desktopCommands.blocked = () => false; f.root.isWide = () => false;
  f.commands.focusRegion(false); assert.equal(f.focused.length, 0);
  f.root.registerWorkspaceNavigation({});
  f.commands.editorCommand('help'); f.commands.focusRegion(false);
  assert.equal(f.actions.length + f.focused.length, 0);
});

test('new-document commands wait for the shared leave-confirmation path and reject late continuation', () => {
  const f = fixture(); f.commands.editorCommand('help'); f.commands.editorCommand('menuFocus');
  assert.deepEqual(f.actions, ['help']); assert.equal(f.root.menuFocusRevision, 1);
  f.commands.editorCommand('newLog'); assert.equal(f.pending[0].tab, 0);
  assert.equal(f.actions.length, 1); f.pending[0].action();
  assert.deepEqual(f.actions.at(-1), ['log', 'create']);
  f.commands.editorCommand('newQa'); assert.equal(f.pending[1].tab, 3); f.pending[1].action();
  assert.deepEqual(f.actions.at(-1), ['qa', '', true]);
  f.root.modules.qaBusy = true; f.commands.editorCommand('newQa'); assert.equal(f.pending.length, 2);
  f.commands.editorCommand('newLog'); f.root.registerWorkspaceNavigation({}); f.pending[2].action();
  assert.equal(f.actions.length, 3);
});
