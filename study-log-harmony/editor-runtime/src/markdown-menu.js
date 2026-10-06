import { isolateHistory } from '@codemirror/commands';
import { markdownChange } from '../../../study-log-web/lib/markdown-edit.ts';

export function formatMarkdown(view, command) {
  if (!['paragraph', 'h3', 'h4', 'h5', 'h6', 'bold', 'italic', 'code', 'codeBlock', 'unordered', 'ordered', 'quote', 'table', 'math', 'mathBlock', 'link'].includes(command)) throw new Error('不支持的格式命令');
  if (!view || view.compositionStarted || view.composing || view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const change = markdownChange(view.state.doc.toString(), from, to, command);
  view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.anchor, head: change.head }, scrollIntoView: true,
    annotations: isolateHistory.of('full'), userEvent: 'input' });
  view.focus();
  return true;
}
