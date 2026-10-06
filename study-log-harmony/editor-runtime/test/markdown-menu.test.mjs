import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { formatMarkdown } from '../src/markdown-menu.js';

function editor(text, from, to) {
  const view = { compositionStarted: false, composing: false,
    state: EditorState.create({doc: text, selection: EditorSelection.range(from, to), extensions: [history()]}),
    dispatch(transaction) { view.state = transaction.state || view.state.update(transaction).state; }, focus() {} };
  return view;
}
test('Harmony menu uses shared Markdown transformation with independent undo and preserved selection', () => {
  const view = editor('甲\n乙\n丙', 0, 4);
  formatMarkdown(view, 'h4');
  assert.equal(view.state.doc.toString(), '#### 甲\n#### 乙\n丙');
  undo(view); assert.equal(view.state.doc.toString(), '甲\n乙\n丙');
  redo(view); formatMarkdown(view, 'paragraph');
  assert.equal(view.state.doc.toString(), '甲\n乙\n丙');
  const inline = editor('中文', 0, 2);
  formatMarkdown(inline, 'bold');
  assert.equal(inline.state.sliceDoc(inline.state.selection.main.from, inline.state.selection.main.to), '中文');
  formatMarkdown(inline, 'bold'); assert.equal(inline.state.doc.toString(), '中文');
});
test('formatting refuses initial IME composition and read-only sessions', () => {
  const view = editor('输入中', 0, 3);
  view.compositionStarted = true;
  assert.equal(formatMarkdown(view, 'h3'), false);
  assert.equal(view.state.doc.toString(), '输入中');
  view.compositionStarted = false;
  view.state = EditorState.create({doc: '只读', extensions: [EditorState.readOnly.of(true)]});
  assert.equal(formatMarkdown(view, 'h3'), false);
  assert.equal(formatMarkdown(null, 'h3'), false);
});
