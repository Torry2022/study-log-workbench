import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { markdownChange, type MarkdownEdit } from "./markdown-edit.ts";

export function applyMarkdownEdit(view: EditorView, command: MarkdownEdit): boolean {
  if (view.compositionStarted || view.composing || view.state.readOnly) return false;
  const selection = view.state.selection.main;
  const change = markdownChange(view.state.doc.toString(), selection.from, selection.to, command);
  view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert },
    selection: EditorSelection.range(change.anchor, change.head), scrollIntoView: true,
    userEvent: "input", annotations: isolateHistory.of("full") });
  focusEditor(view);
  return true;
}

function focusEditor(view: EditorView) {
  window.requestAnimationFrame(() => view.focus());
}

function replaceEditorRange(view: EditorView, from: number, to: number, insert: string, selectionStart: number, selectionEnd = selectionStart) {
  view.dispatch({
    changes: { from, to, insert },
    selection:
      selectionStart === selectionEnd
        ? EditorSelection.cursor(selectionStart)
        : EditorSelection.range(selectionStart, selectionEnd),
    userEvent: "input"
  });
  focusEditor(view);
}

export function toggleInlineMarkdown(view: EditorView, marker: string, placeholder: string) {
  const selection = view.state.selection.main;
  const value = view.state.doc.toString();
  const selectionStart = selection.from;
  const selectionEnd = selection.to;
  const selected = value.slice(selectionStart, selectionEnd);
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const markerLength = marker.length;

  if (selected && selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= markerLength * 2) {
    const inner = selected.slice(markerLength, selected.length - markerLength);
    replaceEditorRange(view, selectionStart, selectionEnd, inner, selectionStart, selectionStart + inner.length);
    return true;
  }

  const hasOuterMarkers =
    selectionStart >= markerLength &&
    value.slice(selectionStart - markerLength, selectionStart) === marker &&
    value.slice(selectionEnd, selectionEnd + markerLength) === marker;

  if (selected && hasOuterMarkers) {
    replaceEditorRange(
      view,
      selectionStart - markerLength,
      selectionEnd + markerLength,
      selected,
      selectionStart - markerLength,
      selectionEnd - markerLength
    );
    return true;
  }

  const inner = selected || placeholder;
  const nextSelectionStart = selectionStart + markerLength;
  replaceEditorRange(
    view,
    selectionStart,
    selectionEnd,
    `${marker}${inner}${marker}`,
    nextSelectionStart,
    nextSelectionStart + inner.length
  );
  return true;
}

export function insertMarkdownLink(view: EditorView) {
  const selection = view.state.selection.main;
  const value = view.state.doc.toString();
  const selectionStart = selection.from;
  const selectionEnd = selection.to;
  const selected = value.slice(selectionStart, selectionEnd);
  const text = selected || "链接文本";
  const url = "url";
  const insert = `[${text}](${url})`;

  if (selected) {
    const urlStart = selectionStart + text.length + 3;
    replaceEditorRange(view, selectionStart, selectionEnd, insert, urlStart, urlStart + url.length);
    return true;
  }

  replaceEditorRange(view, selectionStart, selectionEnd, insert, selectionStart + 1, selectionStart + 1 + text.length);
  return true;
}

export function toggleHeadingLevel(view: EditorView, level: number) {
  const selection = view.state.selection.main;
  const doc = view.state.doc;
  const startLine = doc.lineAt(selection.from);
  const endLine = doc.lineAt(selection.to);
  const from = startLine.from;
  const to = endLine.to;
  const original = doc.sliceString(from, to);
  const prefix = `${"#".repeat(level)} `;

  if (selection.empty && !original.trim()) {
    const leading = original.match(/^\s{0,3}/)?.[0] || "";
    const insert = `${leading}${prefix}`;
    replaceEditorRange(view, from, to, insert, from + insert.length);
    return true;
  }

  let cursorDelta = 0;
  let selectionDelta = 0;

  const next = original
    .split("\n")
    .map((line, index) => {
      if (!line.trim()) return line;
      const leading = line.match(/^\s{0,3}/)?.[0] || "";
      const body = line.slice(leading.length).replace(/^#{1,6}\s+/, "");
      const insert = `${leading}${prefix}${body}`;
      const delta = insert.length - line.length;
      if (index === 0) cursorDelta = delta;
      selectionDelta += delta;
      return insert;
    })
    .join("\n");

  const nextSelectionStart = Math.max(from, selection.from + cursorDelta);
  const nextSelectionEnd = Math.max(nextSelectionStart, selection.to + selectionDelta);
  replaceEditorRange(view, from, to, next, nextSelectionStart, nextSelectionEnd);
  return true;
}
