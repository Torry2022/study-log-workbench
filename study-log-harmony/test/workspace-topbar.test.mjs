import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const methods = ['workspaceShortcutBlocked', 'dismissTopLayer', 'onBackPress', 'handleWorkspaceKey'].map(name => {
  const start = source.search(new RegExp(`^  (?:private )?${name}\\(`, 'm'));
  const rest = source.slice(start + 1);
  const end = rest.search(/^  (?:private |onBackPress\(|@Builder|build\()/m);
  assert.ok(start >= 0 && end > 0);
  return source.slice(start, start + 1 + end);
}).join('\n');
function workspace() {
  const module = { exports: {} };
  const KeyCode = { KEYCODE_ESCAPE: 2070, KEYCODE_F6: 2095, KEYCODE_S: 2035, KEYCODE_DPAD_UP: 2012 };
  runInNewContext(ts.transpileModule(`export class Workspace { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, KeyCode, KeyType: { Down: 0 },
    appFeedback: { show: () => {} },
    workspaceKey: (event, code, ctrl = false, shift = false, alt = false) => event.type === 0 && event.keyCode === code && !!event.ctrl === ctrl && !!event.shift === shift && !!event.alt === alt });
  const page = new module.exports.Workspace();
  Object.assign(page, { connected: true, desktopCommands: { blocked: () => false, handleKey: () => { throw new Error('Application key delegated to log page'); }, closeMenu: () => false, closeOutline: () => false }, sidebar: {navigationOpen:false}, reading: {logsReadingMode:false}, modules: { topRequests: [0,0,0,0,0], noteSaveRevision: 0 }, qaNavigation: {},
    desktopThemeOpen: true, topMoreOpen: false, searchOpen: false,
    isWide: () => true, focusWorkspaceRegion: () => { throw new Error('Focus escaped open theme panel'); } });
  return page;
}
test('theme overlay blocks workspace shortcuts and Escape closes it before underlying search', () => {
  const page = workspace();
  page.searchOpen = true;
  assert.equal(page.workspaceShortcutBlocked(), true);
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2095 }), false);
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2070 }), true);
  assert.equal(page.desktopThemeOpen, false);
  assert.equal(page.searchOpen, true);
  assert.equal(page.desktopKeyboardFocus, true);
});
test('theme choice uses original close-after-selection behavior with the public theme callback', async () => {
  const theme = await readFile(new URL('../entry/src/main/ets/app/components/DesktopThemePanel.ets', import.meta.url), 'utf8');
  const action = theme.match(/\.onClick\(\(\) => \{([\s\S]*?)\}\)/)?.[1];
  assert.ok(action);
  const calls = [];
  const page = { onSetTheme: value => calls.push(value), onClose: () => calls.push('closed') };
  const execute = runInNewContext(`(function(value) { ${action} })`);
  execute.call(page, 'dark');
  assert.deepEqual(calls, ['dark', 'closed']);
});

test('desktop search candidates do not block the original F6 region cycle, while narrow search still blocks it', () => {
  const page = workspace(); page.desktopThemeOpen = false; page.searchOpen = true;
  let moves = 0; page.focusWorkspaceRegion = () => moves++;
  assert.equal(page.workspaceShortcutBlocked(), false);
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2095 }), true); assert.equal(moves, 1);
  page.isWide = () => false; assert.equal(page.workspaceShortcutBlocked(), true);
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2095 }), false); assert.equal(moves, 1);
});

test('ordinary note save and non-log top commands are dispatched without the log page', () => {
  const page = workspace(); page.desktopThemeOpen = false; page.selectedModule = 1;
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2035, ctrl: true }), true);
  assert.equal(page.modules.noteSaveRevision, 1);
  page.selectedModule = 4;
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2012, alt: true }), true);
  assert.deepEqual(Array.from(page.modules.topRequests), [0,0,0,0,1]);
});

test('unmodified save key is not consumed outside logs and does not trigger persistence', () => {
  const page = workspace(); page.desktopThemeOpen = false; page.selectedModule = 1;
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2035 }), false);
  assert.equal(page.modules.noteSaveRevision, 0);
});

test('Escape preserves application, local menu, calendar, local outline, search priority', () => {
  const page = workspace(); page.topMoreOpen = true; page.calendarOpen = true; page.searchOpen = true;
  let menu = true, outline = true;
  page.desktopCommands.closeMenu = () => { if (!menu) return false; menu = false; return true; };
  page.desktopCommands.closeOutline = () => { if (!outline) return false; outline = false; return true; };
  const escape = () => assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2070 }), true);
  escape(); assert.equal(page.desktopThemeOpen, false); assert.equal(page.topMoreOpen, true);
  escape(); assert.equal(page.topMoreOpen, false); assert.equal(menu, true);
  escape(); assert.equal(menu, false); assert.equal(page.calendarOpen, true);
  escape(); assert.equal(page.calendarOpen, false); assert.equal(outline, true);
  escape(); assert.equal(outline, false); assert.equal(page.searchOpen, true);
  let dismissed = 0; page.search = { dismissSearchResults: () => dismissed++ };
  escape(); assert.equal(page.searchOpen, false); assert.equal(dismissed, 1);
});

test('system Back dismisses the top layer before asking to exit', () => {
  const page = workspace();
  let terminations = 0;
  page.getUIContext = () => ({ getHostContext: () => ({ terminateSelf: () => terminations++ }) });
  page.helpOpen = true;
  page.searchOpen = true;
  page.search = { dismissSearchResults() {} };
  page.desktopThemeOpen = false;
  assert.equal(page.onBackPress(), true);
  assert.equal(page.helpOpen, false);
  assert.equal(page.searchOpen, true);
  assert.equal(page.onBackPress(), true);
  assert.equal(page.searchOpen, false);
  assert.equal(terminations, 0);
  assert.equal(page.onBackPress(), true);
  assert.equal(terminations, 0);
  assert.equal(page.onBackPress(), true);
  assert.equal(terminations, 1);
});

test('theme initial focus waits for a mounted frame and ignores closed or superseded panels', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/app/components/DesktopThemePanel.ets', import.meta.url), 'utf8');
  const start = source.indexOf('  private focusPanel('), end = source.indexOf('  @Builder', start);
  assert.ok(start >= 0 && end > start);
  const module = { exports: {} }, frames = [], focused = [];
  runInNewContext(ts.transpileModule(`export class Panel { ${source.slice(start, end)} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, FrameAction: class { constructor(action) { this.action = action; } },
    focusControl: { requestFocus: id => focused.push(id) } });
  const panel = new module.exports.Panel(); panel.focusRevision = 0;
  panel.getUIContext = () => ({ postFrameCallback: frame => frames.push(frame.action) });
  panel.focusPanel(); assert.deepEqual(focused, []); frames.shift()();
  assert.deepEqual(focused, ['desktop_theme_close']);
  panel.focusPanel(); panel.aboutToDisappear(); frames.shift()(); assert.equal(focused.length, 1);
  panel.focusPanel(); panel.focusPanel(); frames.shift()(); assert.equal(focused.length, 1);
  frames.shift()(); assert.equal(focused.length, 2);
});
