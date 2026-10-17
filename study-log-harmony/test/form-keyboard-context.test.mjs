import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../entry/src/main/ets/', import.meta.url);
const source = await readFile(new URL('common/ui/FormKeyboardContext.ets', root), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
} }).outputText;
function fixture() {
  const module = { exports: {} }, storage = { visible: true, top: 0 };
  new Function('module', 'exports', 'AppStorage', code)(module, module.exports,
    { get: key => key === 'softwareKeyboardTopPx' ? storage.top : storage.visible });
  return { ...module.exports, storage };
}

test('only reveals the hidden context and never pushes the focused field above the viewport', () => {
  const { formKeyboardOffset: offset } = fixture();
  assert.equal(offset(0, 600, 300, 500, 20), 20);
  assert.equal(offset(0, 600, 300, 650, 20), 78);
  assert.equal(offset(100, 600, 300, 1000, 20), 212);
  assert.equal(offset(100, 600, 50, 1000, 20), 0);
  assert.equal(offset(100, 600, 50, 1000, 20, 600), 20, 'leave oversized text areas to native caret avoidance');
  assert.equal(offset(150, 600, -10, 500, 400, 210), 232, 'recover a field moved too far up by native avoidance');
});

test('covers remove only the actual keyboard overlap without double avoiding resized viewports', () => {
  const { keyboardFrameInset: inset } = fixture();
  assert.equal(inset(800, 500), 300);
  assert.equal(inset(500, 500), 0);
  assert.equal(inset(480, 500), 0);
  assert.equal(inset(800, 0), 0);
});

test('focus, keyboard resize and growing feedback share one minimal scroll calculation', () => {
  const { FormKeyboardContext, storage } = fixture();
  let offset = 10, viewportHeight = 600, regionBottom = 500;
  const moves = [];
  const rectangles = () => ({
    viewport: { windowOffset: { y: 0 }, size: { height: viewportHeight } },
    input: { windowOffset: { y: 300 }, size: { height: 48 } },
    region: { windowOffset: { y: 300 }, size: { height: regionBottom - 300 } }
  });
  const context = { px2vp: value => value / 2,
    getComponentUtils: () => ({ getRectangleById: id => rectangles()[id] }) };
  const controller = new FormKeyboardContext({ currentOffset: () => ({ xOffset: 3, yOffset: offset }),
    scrollTo: point => { moves.push(point); offset = point.yOffset; } }, 'viewport');
  controller.focus(context, 'input', 'region');
  assert.equal(moves.length, 0);
  viewportHeight = 400;
  controller.reveal(context);
  assert.deepEqual(moves.pop(), { xOffset: 3, yOffset: 68 });
  regionBottom = 550;
  controller.reveal(context);
  assert.deepEqual(moves.pop(), { xOffset: 3, yOffset: 151 });
  storage.visible = false;
  controller.reveal(context);
  storage.visible = true;
  controller.blur('input');
  controller.reveal(context);
  assert.equal(moves.length, 0);
  assert.doesNotThrow(() => controller.focus({ ...context, getComponentUtils() { throw Error('closed'); } }, 'input', 'region'));
});

test('input forms use the shared policy, and note save actions stay outside the scrolling fields', async () => {
  for (const path of ['app/LoginPage.ets', 'features/logs/components/LogAiPanel.ets',
    'features/favorites/components/FavoritesNavigation.ets']) {
    const content = await readFile(new URL(path, root), 'utf8');
    assert.match(content, /new FormKeyboardContext/);
    assert.match(content, /formKeyboard\.focus/);
    assert.match(content, /formKeyboard\.reveal/);
  }
  const notes = await readFile(new URL('features/notes/NotesPage.ets', root), 'utf8');
  assert.ok(notes.indexOf(".id('note_save')") > notes.indexOf(".id('note_editor_scroll')"));
  assert.doesNotMatch(notes, /Number\(oldArea\.height\) === Number\(newArea\.height\)/);
  const favorites = await readFile(new URL('features/favorites/components/FavoritesNavigation.ets', root), 'utf8');
  assert.match(favorites, /keyboardAvoidMode: KeyboardAvoidMode\.DEFAULT/);
  const logs = await readFile(new URL('features/logs/LogsReaderPage.ets', root), 'utf8');
  assert.match(logs, /AppModalFrame\(\{ content: \(\): void => this\.favoriteGroupDialogContent\(\)/);
  const group = await readFile(new URL('features/logs/components/LogFavoriteGroupPanel.ets', root), 'utf8');
  assert.match(group, /scrollBar\(BarState.Auto\)\.edgeEffect\(EdgeEffect.None\)\.flexShrink\(1\)/);
});
