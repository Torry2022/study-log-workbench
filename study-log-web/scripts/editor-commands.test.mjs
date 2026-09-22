import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { insertMarkdownLink, toggleHeadingLevel, toggleInlineMarkdown } from "../lib/editor-commands.ts";

// Commands operate on real CodeMirror transactions; only DOM focus is omitted.
globalThis.window = { requestAnimationFrame: callback => { callback(); return 0; } };
function editor(doc, from = 0, to = from) {
  const view = {
    state: EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: [history(), indentUnit.of("  ")] }),
    dispatch(transaction) { view.state = transaction.state || view.state.update(transaction).state; },
    focus() {}
  };
  return view;
}

test("inline formatting preserves the selected text and supports undo and redo", () => {
  for (const marker of ["**", "*", "`"]) {
    const view = editor("before 中文 after", 7, 9);
    toggleInlineMarkdown(view, marker, "placeholder");
    assert.equal(view.state.doc.toString(), `before ${marker}中文${marker} after`);
    assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "中文");
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), "before 中文 after");
    assert.equal(redo(view), true);
    assert.equal(view.state.doc.toString(), `before ${marker}中文${marker} after`);
  }
});

test("inline toggle removes enclosing markers and selects an inserted placeholder", () => {
  const selected = editor("**文字**", 0, 6);
  toggleInlineMarkdown(selected, "**", "加粗文本");
  assert.equal(selected.state.doc.toString(), "文字");
  const inner = editor("**文字**", 2, 4);
  toggleInlineMarkdown(inner, "**", "加粗文本");
  assert.equal(inner.state.doc.toString(), "文字");
  const empty = editor("");
  toggleInlineMarkdown(empty, "**", "加粗文本");
  assert.equal(empty.state.doc.toString(), "**加粗文本**");
  assert.equal(empty.state.sliceDoc(empty.state.selection.main.from, empty.state.selection.main.to), "加粗文本");
});

test("external link insertion selects URL for a selection and label for an empty cursor", () => {
  const selected = editor("文档", 0, 2);
  insertMarkdownLink(selected);
  assert.equal(selected.state.doc.toString(), "[文档](url)");
  assert.equal(selected.state.sliceDoc(selected.state.selection.main.from, selected.state.selection.main.to), "url");
  const empty = editor("");
  insertMarkdownLink(empty);
  assert.equal(empty.state.doc.toString(), "[链接文本](url)");
  assert.equal(empty.state.sliceDoc(empty.state.selection.main.from, empty.state.selection.main.to), "链接文本");
});

test("H3 conversion preserves existing indented heading text and surrounding lines", () => {
  const view = editor("前文\n  ## 标题\n后文", 6, 10);
  toggleHeadingLevel(view, 3);
  assert.equal(view.state.doc.toString(), "前文\n  ### 标题\n后文");
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), "前文\n  ## 标题\n后文");
});

test("H3 conversion handles multiline selection and an empty indented line", () => {
  const view = editor("甲\n\n乙", 0, 4);
  toggleHeadingLevel(view, 3);
  assert.equal(view.state.doc.toString(), "### 甲\n\n### 乙");
  const empty = editor("  ", 2);
  toggleHeadingLevel(empty, 3);
  assert.equal(empty.state.doc.toString(), "  ### ");
  assert.equal(empty.state.selection.main.head, 6);
});

test("indent and outdent use two spaces without changing the line content", () => {
  const view = editor("甲\n乙", 0, 3);
  indentMore(view);
  assert.equal(view.state.doc.toString(), "  甲\n  乙");
  indentLess(view);
  assert.equal(view.state.doc.toString(), "甲\n乙");
});
