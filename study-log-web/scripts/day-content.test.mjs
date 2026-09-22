import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidDayContentError,
  findLevelTwoHeadings,
  normalizeDayContent,
  toEditableDayBody
} from "../lib/day-content.ts";
import { extractDayBlockFromSource } from "../lib/log-store.ts";

test("cached day boundaries refresh for same-length content changes", () => {
  const original = "## 2026-04-13\n\n* ```java\n  code\n  ```\n\n## 2026-04-14\n\nbody";
  assert.match(extractDayBlockFromSource(original, "cache-test.md", "2026-04-14"), /body/);
  assert.match(extractDayBlockFromSource(original, "cache-test.md", "2026-04-14"), /body/);
  const changed = original.replace("2026-04-14", "2026-04-15");
  assert.equal(extractDayBlockFromSource(changed, "cache-test.md", "2026-04-14"), null);
  assert.match(extractDayBlockFromSource(changed, "cache-test.md", "2026-04-15"), /body/);
  assert.match(extractDayBlockFromSource(original, "cache-test.md", "2026-04-14"), /body/);
});

test("extracts the editable body from a saved day block", () => {
  const content = [
    "## 2026-05-29",
    "",
    "### 1. 大模型(MNN端侧推理框架)",
    "",
    "正文",
    "",
    "---"
  ].join("\n");

  assert.equal(
    toEditableDayBody("2026-05-29", content),
    ["### 1. 大模型(MNN端侧推理框架)", "", "正文"].join("\n")
  );
});

test("rebuilds the immutable date heading around an editable body", () => {
  assert.equal(
    normalizeDayContent("2026-05-29", "### 1. 标题\n\n正文"),
    "## 2026-05-29\n\n### 1. 标题\n\n正文"
  );
});

test("rejects an additional level-two heading in the body", () => {
  assert.throws(
    () => normalizeDayContent("2026-05-29", "### 1. 标题\n\n## 2026-07-24\n\n正文"),
    InvalidDayContentError
  );
});

test("rejects a mismatched date heading at the top", () => {
  assert.throws(
    () => normalizeDayContent("2026-05-29", "## 2026-07-24\n\n### 1. 标题"),
    /日块顶部日期与当前选择的日期不一致/
  );
});

test("ignores level-two heading text inside fenced code", () => {
  const body = ["```md", "## 2026-07-24", "```"].join("\n");
  assert.deepEqual(findLevelTwoHeadings(body), []);
  assert.equal(normalizeDayContent("2026-05-29", body), `## 2026-05-29\n\n${body}`);
});

test("list-contained code fences do not swallow subsequent dates", () => {
  for (const opening of ["* ```Java", "- ~~~java", "1. ```java"]) {
    const marker = opening.includes("~~~") ? "~~~" : "```";
    const indent = opening.startsWith("1.") ? "   " : "  ";
    const content = ["## 2026-04-13", "", opening,
      `${indent}## 2099-01-01`, `${indent}${marker}`, "", "---", "",
      "## 2026-04-14", "", "### 1. Next day", "", "## 2026-04-22"
    ].join("\r\n");
    const headings = findLevelTwoHeadings(content);
    assert.deepEqual(headings.map(h => h.text), ["2026-04-13", "2026-04-14", "2026-04-22"]);
    for (const h of headings) assert.equal(content.slice(h.start, h.end), `## ${h.text}`);
    assert.throws(() => normalizeDayContent("2026-04-13", content), InvalidDayContentError);
  }
});

test("ignores nested, indented and HTML headings but preserves root offsets", () => {
  const content = "> ## quoted\n\n- ## nested\n\n    ## code\n\n<!--\n## hidden\n-->\n\n  ## actual ##\n";
  const headings = findLevelTwoHeadings(content);
  assert.deepEqual(headings.map(h => h.text), ["actual"]);
  assert.equal(content.slice(headings[0].start, headings[0].end), "  ## actual ##");
});

test("fence marker and length are respected", () => {
  assert.deepEqual(findLevelTwoHeadings("````md\n```\n## hidden\n~~~~\n````\n\n## visible").map(h => h.text), ["visible"]);
});
