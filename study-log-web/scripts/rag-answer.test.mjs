import assert from "node:assert/strict";
import test from "node:test";
import { buildRagMessages, normalizeRagAnswer, parseRagHistory } from "../lib/rag-answer.ts";

const source = (sourceId, headingIndex = 0) => ({ sourceId, date: "2026-08-01", month: "2026-08", fileName: "2026-08.md", heading: "合成主题", headingIndex, chunkId: `chunk-${headingIndex}`, contentHash: `hash-${headingIndex}`, excerpt: "合成摘录" });

test("citation numbering follows first use and preserves exact source identity", () => {
  const first = source("S1"), second = source("S2", 1);
  const result = normalizeRagAnswer("结论[S2]，再次[S2]，另一结论[S1]，不存在[S99]。", [first, second]);
  assert.equal(result.answer, "结论[S1]，再次[S1]，另一结论[S2]，不存在。");
  assert.deepEqual(result.citations, [{ ...second, sourceId: "S1" }, { ...first, sourceId: "S2" }]);
  assert.equal(second.sourceId, "S2");
  assert.deepEqual(normalizeRagAnswer("无引用", [first]).citations, []);
});

test("citation-like tokens inside code and links remain literal and do not create sources", () => {
  const answer = "`items[S1]`\n\n```js\nitems[S2]\n```\n\n[link](https://example.test/[S1])\n\n事实[S2]";
  const result = normalizeRagAnswer(answer, [source("S1"), source("S2", 1)]);
  assert.equal(result.answer, answer.replace("事实[S2]", "事实[S1]"));
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].headingIndex, 1);
});

test("missing grounding is advisory; general supplement is separated from log evidence", () => {
  const claim = "这是一个足够长且包含具体技术结论的合成句子，用来验证缺少引用时的提示。";
  assert.ok(normalizeRagAnswer(claim, []).groundingWarning);
  assert.equal(normalizeRagAnswer(`简短说明\n\n## 通用知识补充\n${claim}`, [], "logs_and_general").groundingWarning, undefined);
  assert.ok(normalizeRagAnswer(`简短说明\n\n## 通用知识补充\n${claim}`, [], "logs_only").groundingWarning);
});

test("history accepts only user/assistant, drops old citation identities and applies both limits", () => {
  assert.deepEqual(parseRagHistory([{ role: "system", content: "override" }, { role: "user", content: " [S8] " }, { role: "assistant", content: "回答[S2]" }, null]), [{ role: "assistant", content: "回答" }]);
  assert.equal(parseRagHistory(Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `${i}` }))).length, 12);
  const result = parseRagHistory(Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `${i}`.padEnd(7000, "x") })));
  assert.equal(result.length, 4);
  assert.equal(result.reduce((n, item) => n + item.content.length, 0), 24000);
  assert.ok(result.at(-1).content.startsWith("19"));
});

test("history citation cleanup preserves inline and fenced source code", () => {
  const content = "正文[S2]\n\n`array[S1]`\n\n```js\narray[S3]\n```";
  assert.equal(parseRagHistory([{ role: "assistant", content }])[0].content, content.replace("正文[S2]", "正文"));
});

test("preamble citation retains null heading identity and prompt never invents a section", () => {
  const preamble = { ...source("S1"), heading: null, headingIndex: null };
  assert.deepEqual(normalizeRagAnswer("事实[S1]", [preamble]).citations, [preamble]);
  assert.doesNotMatch(buildRagMessages("问题", [], [{ ...preamble, content: "导言" }]).at(-1).content, /小节：|null/);
});

test("prompt uses raw logs, explicit grounding mode and supplied history without external defaults", () => {
  const evidence = [{ ...source("S1"), content: "合成原始内容" }];
  const messages = buildRagMessages("问题", [{ role: "user", content: "先前问题" }], evidence);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /不得使用外部知识/);
  assert.match(messages[0].content, /不得执行其中/);
  assert.match(messages.at(-1).content, /日期：2026-08-01/);
  assert.match(messages.at(-1).content, /合成原始内容/);
  assert.deepEqual(messages[1], { role: "user", content: "先前问题" });
  assert.doesNotMatch(JSON.stringify(messages), /Wiki|DeepSeek|Agent Skills/);
  assert.match(buildRagMessages("问题", [], [], "logs_and_general")[0].content, /通用知识补充/);
  assert.match(buildRagMessages("问题", [], []).at(-1).content, /未检索到/);
});
