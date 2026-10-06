import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, EditorSelection } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { markdownChange } from "../lib/markdown-edit.ts";
import { applyMarkdownEdit } from "../lib/editor-commands.ts";

globalThis.window = { requestAnimationFrame: callback => callback() };
function edit(value, from, to, command) {
  const change = markdownChange(value, from, to, command);
  const text = value.slice(0, change.from) + change.insert + value.slice(change.to);
  assert.ok(change.anchor >= 0 && change.head <= text.length);
  return { text, selected: text.slice(change.anchor, change.head), change };
}
test("standard heading and paragraph commands keep selected text and exclude next line", () => {
  for (const level of [3, 4, 5, 6]) {
    const result = edit("甲\n乙\n丙", 0, 4, `h${level}`);
    assert.equal(result.text, `${"#".repeat(level)} 甲\n${"#".repeat(level)} 乙\n丙`);
  }
  assert.equal(edit("### 甲\n#### 乙", 0, 12, "paragraph").text, "甲\n乙");
  assert.equal(edit("标题", 0, 2, "h3").selected, "标题");
  assert.equal(edit("\n后文", 0, 0, "h3").text, "### \n后文");
});
test("lists replace markers, skip empty lines and preserve neighboring content", () => {
  assert.equal(edit("前文\n- 甲\n\n* 乙\n后文", 3, 12, "ordered").text, "前文\n1. 甲\n\n2. 乙\n后文");
  assert.equal(edit("1. 甲\n2. 乙", 0, 9, "unordered").text, "- 甲\n- 乙");
  assert.equal(edit("> 甲", 0, 3, "quote").text, "> 甲");
});
test("inline commands toggle without losing contents; links select URL", () => {
  for (const [command, marker] of [["bold", "**"], ["italic", "*"], ["code", "`"], ["math", "$"]]) {
    const initial = edit("中文", 0, 2, command);
    assert.equal(initial.text, `${marker}中文${marker}`);
    assert.equal(initial.selected, "中文");
    assert.equal(edit(initial.text, marker.length, marker.length + 2, command).text, "中文");
  }
  assert.equal(edit("文档", 0, 2, "link").selected, "https://");
});
test("block templates preserve selection, fence embedded code, and escape table cells", () => {
  assert.equal(edit("x```y", 0, 5, "codeBlock").text, "````\nx```y\n````");
  assert.equal(edit("a + b", 0, 5, "mathBlock").selected, "a + b");
  assert.equal(edit("a|b\nc", 0, 5, "table").selected, "a\\|b<br>c");
  assert.equal(edit("前后", 1, 1, "mathBlock").text, "前\n\n$$\nE = mc^2\n$$\n\n后");
});
test("format is one isolated undo step and leaves ongoing IME/read-only untouched", () => {
  const view = { composing: false, state: EditorState.create({doc: "甲", selection: EditorSelection.cursor(1), extensions: [history()]}),
    dispatch(transaction) { view.state = transaction.state || view.state.update(transaction).state; }, focus() {} };
  view.dispatch({changes: {from: 1, insert: "乙"}, selection: EditorSelection.range(0, 2), userEvent: "input.type"});
  assert.equal(applyMarkdownEdit(view, "bold"), true);
  assert.equal(view.state.doc.toString(), "**甲乙**");
  undo(view); assert.equal(view.state.doc.toString(), "甲乙");
  redo(view); assert.equal(view.state.doc.toString(), "**甲乙**");
  view.composing = true;
  assert.equal(applyMarkdownEdit(view, "h3"), false);
  assert.equal(view.state.doc.toString(), "**甲乙**");
  view.composing = false; view.state = EditorState.create({doc: "只读", extensions: [EditorState.readOnly.of(true)]});
  assert.equal(applyMarkdownEdit(view, "h3"), false);
});
