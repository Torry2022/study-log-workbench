import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const methods = ['shortcutBlocked', 'handleWorkspaceKey'].map(name => {
  const start = source.indexOf(`  private ${name}(`);
  const rest = source.slice(start + 1);
  const end = rest.search(/^  (?:private |@Builder|build\()/m);
  assert.ok(start >= 0 && end > 0);
  return source.slice(start, start + 1 + end);
}).join('\n');
function workspace() {
  const module = { exports: {} };
  const KeyCode = { KEYCODE_ESCAPE: 2070, KEYCODE_F6: 2067 };
  runInNewContext(ts.transpileModule(`export class Workspace { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, KeyCode, KeyType: { Down: 0 },
    workspaceKey: (event, code) => event.type === 0 && event.keyCode === code });
  const page = new module.exports.Workspace();
  Object.assign(page, { ai: {}, documents: {}, modules: {}, qaNavigation: {},
    desktopThemeOpen: true, topMoreOpen: false, searchOpen: false,
    isWide: () => true, focusWorkspaceRegion: () => { throw new Error('Focus escaped open theme panel'); } });
  return page;
}
test('theme overlay blocks workspace shortcuts and Escape closes it before underlying search', () => {
  const page = workspace();
  page.searchOpen = true;
  assert.equal(page.shortcutBlocked(), true);
  assert.equal(page.handleWorkspaceKey({ type: 0, keyCode: 2067 }), false);
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
