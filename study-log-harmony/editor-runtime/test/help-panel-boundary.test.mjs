import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../../entry/src/main/ets/${path}.ets`, import.meta.url), 'utf8');

test('help owns presentation while shell retains visibility, closing and transitions', async () => {
  const shell = await read('pages/Index');
  const panel = await read('app/components/HelpPanel');
  assert.match(shell, /HelpPanel\(\{ onClose: \(\) => this.helpOpen = false \}\)\.zIndex\(100\)/);
  assert.doesNotMatch(shell, /private (helpAction|desktopHelpDialog|compactHelpDialog|helpShortcut)\(/);
  assert.match(panel, /@Consume\('workspaceBreakpoint'\)/);
  assert.match(panel, /onClose: \(\) => void/);
  assert.match(panel, /AppModalScrim\(\{ onDismiss: this.onClose \}\)/);
  assert.doesNotMatch(panel, /apiClient|AppStorage|preferences|@Storage|@Link|closeHelp|floatingSurfaceTransition/);
  assert.equal((panel.match(/key\('help_close_button'\)/g) || []).length, 2);
  assert.match(panel, /width\('76%'\)\.height\('84%'\)\.constraintSize\(\{ maxWidth: 980, maxHeight: 780 \}\)/);
  assert.match(panel, /width\('88%'\)\.height\('84%'\)\.constraintSize\(\{ maxHeight: 780 \}\)/);
});

test('help groups only enabled shortcuts by workspace context', async () => {
  const panel = await read('app/components/HelpPanel');
  const editor = await readFile(new URL('../src/editor.js', import.meta.url), 'utf8');
  const shell = await read('pages/Index');
  const qa = await read('features/qa/QaPage');
  const groups = ['全局', '搜索与阅读', '源码常用编辑', '源码查找与选中', 'Markdown 排版', '知识问答'];
  let previous = -1;
  for (const group of groups) {
    const position = panel.indexOf(`Text('${group}')`);
    assert.ok(position > previous, `${group} should follow the documented scenario order`);
    previous = position;
  }
  for (const shortcut of ['Ctrl + Z', 'Ctrl + Y / Ctrl + Shift + Z', 'Alt + ↑ / ↓',
    'Alt + Shift + ↑ / ↓', 'F3 / Shift + F3']) assert.ok(panel.includes(shortcut), shortcut);
  assert.doesNotMatch(panel, /Ctrl \+ D/);
  assert.doesNotMatch(panel, /Ctrl \+ Shift \+ ↑ \/ ↓/);
  assert.match(editor, /keymap\.of\(\[\.\.\.closeBracketsKeymap, \.\.\.defaultKeymap, \.\.\.historyKeymap,/);
  assert.match(editor, /\.\.\.searchKeymap/);
  for (const binding of ["key:'Mod-s'", "key:'Mod-b'", "key:'Mod-i'", "key:'Mod-k'",
    "key:'Mod-Shift-k'", "key:'Tab'", "key:'Shift-Tab'"]) assert.ok(editor.includes(binding), binding);
  assert.match(editor, /\[3, 4, 5, 6\]\.map\(level => \(\{ key:`Ctrl-Alt-\$\{level\}`/);
  assert.match(panel, /Ctrl \+ Alt \+ 3 \/ 4 \/ 5 \/ 6/);
  assert.match(shell, /workspaceKey\(event, KeyCode\.KEYCODE_F, true, true\)/);
  assert.match(shell, /workspaceKey\(event, KeyCode\.KEYCODE_G, true\)/);
  assert.match(qa, /workspaceKey\(event, KeyCode\.KEYCODE_ENTER, false, true\)/);
  assert.match(qa, /workspaceKey\(event, KeyCode\.KEYCODE_ENTER\)/);
});
