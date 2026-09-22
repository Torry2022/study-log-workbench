import { EditorSelection, type ChangeDesc } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

export interface InsertionRange { from: number; to: number; valid: boolean }

// A later upload belongs to its original selection, even if the caret moves.
// Editing selected text invalidates replacement; unrelated edits map its position.
export function mapInsertion(range: InsertionRange, changes: ChangeDesc): InsertionRange {
  return {
    from: changes.mapPos(range.from, 1),
    to: changes.mapPos(range.to, 1),
    valid: range.valid && !(range.from < range.to && changes.touchesRange(range.from, range.to))
  };
}

export function insertAtRange(view: EditorView, range: InsertionRange, markdown: string, block = false): boolean {
  if (!range.valid || !view.dom.isConnected) return false;
  const before = view.state.doc.sliceString(0, range.from);
  const after = view.state.doc.sliceString(range.to);
  const insert = `${block && before && !before.endsWith("\n") ? "\n" : ""}${markdown}${block && after && !after.startsWith("\n") ? "\n" : ""}`;
  view.dispatch({ changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length), userEvent: "input", annotations: isolateHistory.of("full") });
  requestAnimationFrame(() => { if (view.dom.isConnected && !view.dom.closest("[inert]")) view.focus(); });
  return true;
}
