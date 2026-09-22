import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { mapInsertion, insertAtRange } from '../lib/editor-insertion.ts';

test('pending caret follows earlier typing but not later caret movement', () => {
  const state = EditorState.create({ doc: 'before after' });
  const changes = state.changes([{ from: 0, insert: 'prefix ' }, { from: 7, insert: 'new ' }]);
  assert.deepEqual(mapInsertion({ from: 7, to: 7, valid: true }, changes), { from: 18, to: 18, valid: true });
});
test('editing the original replacement selection invalidates an upload', () => {
  const state = EditorState.create({ doc: 'abcdef' });
  assert.equal(mapInsertion({ from: 2, to: 4, valid: true }, state.changes({ from: 3, insert: 'new' })).valid, false);
  assert.equal(mapInsertion({ from: 2, to: 4, valid: true }, state.changes({ from: 0, insert: 'new' })).valid, true);
});
test('insertion keeps surrounding text and undo removes only inserted Markdown', () => {
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    let state = EditorState.create({ doc: 'before after', extensions: [history()] });
    const view = { get state() { return state; }, dom: { isConnected: true }, dispatch(transaction) { state = transaction.state || state.update(transaction).state; } };
    view.dispatch({ changes: { from: 7, insert: 'new ' }, userEvent: 'input' });
    assert.equal(insertAtRange(view, { from: 11, to: 11, valid: true }, '![image](./assets/a.png)', true), true);
    assert.equal(state.doc.toString(), 'before new \n![image](./assets/a.png)\nafter');
    assert.equal(undo({ state, dispatch: view.dispatch }), true);
    assert.equal(state.doc.toString(), 'before new after');
    assert.equal(insertAtRange(view, { from: 0, to: 1, valid: false }, 'ignored'), false);
  } finally { globalThis.requestAnimationFrame = previous; }
});
