import { EditorState } from '@codemirror/state';
import { history, historyField, undoSelection, redoSelection } from '@codemirror/commands';

const MAX_BYTES = 20 * 1024 * 1024;
const fields = { history:historyField };
const schema = 'study-log-cm6-v1';
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => names.includes(key)) && names.every(key => Object.hasOwn(value, key));

export function serializeContinuation(state, scrollTop, scrollLeft) {
  const text = JSON.stringify({ schema, state:state.toJSON(fields), scrollTop, scrollLeft });
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('编辑快照超过 20 MiB，无法接续');
  return text;
}

export function deserializeContinuation(serialized, extensions) {
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > MAX_BYTES)
    throw new Error('编辑快照过大或无效');
  const data = JSON.parse(serialized);
  if (!exactKeys(data, ['schema', 'state', 'scrollTop', 'scrollLeft']) || data.schema !== schema ||
      ![data.scrollTop, data.scrollLeft].every(value => Number.isFinite(value) && value >= 0) ||
      !exactKeys(data.state, ['doc', 'selection', 'history']) || typeof data.state.doc !== 'string' ||
      !exactKeys(data.state.history, ['done', 'undone']) ||
      !Array.isArray(data.state.history.done) || !Array.isArray(data.state.history.undone))
    throw new Error('不支持或损坏的编辑快照');
  // Validate both branches against their documents in detached states, not just JSON syntax.
  for (const [branch, command] of [['done', undoSelection], ['undone', redoSelection]]) {
    let check = EditorState.fromJSON(data.state, { extensions:[history()] }, fields);
    const limit = data.state.history[branch].reduce((total, event) => total + 1 + event.selectionsAfter.length, 0);
    for (let i = 0; i < limit; i++) {
      if (!command({ state:check, dispatch:transaction => { check = transaction.state; } })) break;
    }
  }
  // Construct before touching the active editor.
  const state = EditorState.fromJSON(data.state, { extensions }, fields);
  return { state, scrollTop:data.scrollTop, scrollLeft:data.scrollLeft };
}
