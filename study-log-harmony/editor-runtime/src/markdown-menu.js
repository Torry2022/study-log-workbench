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

export function toggleHeading(view, level) {
  if (!view || view.compositionStarted || view.composing || view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to);
  const prefix = '#'.repeat(level) + ' ';
  const sameLevel = view.state.sliceDoc(first.from, last.to).split('\n').every(line => line.startsWith(prefix));
  return formatMarkdown(view, sameLevel ? 'paragraph' : `h${level}`);
}
