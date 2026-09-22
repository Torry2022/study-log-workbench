import assert from "node:assert/strict";
import test from "node:test";
import { buildDiffRows } from "../lib/backup-diff.ts";

test("day comparison keeps unchanged context and independent line numbers after removal", () => {
  const rows = buildDiffRows("## 2026-09-22\n留下\n删除甲\n删除乙\n结尾\n", "## 2026-09-22\n留下\n结尾\n");
  assert.deepEqual(rows.map(row => row.kind), ["unchanged", "unchanged", "removed", "removed", "unchanged"]);
  assert.equal(rows[2].historical, null);
  assert.equal(rows[4].current.lineNumber, 5);
  assert.equal(rows[4].historical.lineNumber, 3);
});

test("paired Chinese and English edits preserve text and mark only changed word segments", () => {
  const rows = buildDiffRows("记录 new API 完成\n", "记录 old API 完成\n");
  assert.equal(rows[0].kind, "changed");
  const { current, historical } = rows[0];
  assert.equal(current.segments.map(segment => segment.value).join(""), current.text);
  assert.equal(historical.segments.map(segment => segment.value).join(""), historical.text);
  assert.deepEqual(current.segments.filter(segment => segment.changed).map(segment => segment.value), ["new"]);
  assert.deepEqual(historical.segments.filter(segment => segment.changed).map(segment => segment.value), ["old"]);
});

test("uneven replacements distinguish word edits from extra historical lines", () => {
  const rows = buildDiffRows("标题\n现内容\n结尾\n", "标题\n旧内容\n旧补充\n结尾\n");
  assert.deepEqual(rows.map(row => row.kind), ["unchanged", "changed", "added", "unchanged"]);
  assert.equal(rows[2].current, null);
  assert.equal(rows[2].historical.lineNumber, 3);
  assert.equal(rows[3].current.lineNumber, 3);
  assert.equal(rows[3].historical.lineNumber, 4);
});

test("empty days, blank lines and CRLF display without a synthetic trailing row", () => {
  assert.deepEqual(buildDiffRows("", ""), []);
  const rows = buildDiffRows("", "标题\r\n\r\n正文\r\n");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.historical.text), ["标题", "", "正文"]);
  assert.ok(rows.every(row => row.kind === "added" && row.current === null));
  assert.equal(buildDiffRows("正文", "正文").length, 1);
});
