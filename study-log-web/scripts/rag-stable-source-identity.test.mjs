import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRagAnswer } from "../lib/rag-answer.ts";
const source = (sourceId, headingIndex) => ({ sourceId, date: "2024-01-01", heading: "合成来源", headingIndex });

test("normalization never reassigns an identity retained in literal code", () => {
  const sources = [source("S1", 0), source("S8", 7), source("S12", 11)];
  const answer = "`[S1]` 是原片段编号。另一来源[s8]，原片段[S1]；S12 是补读内容[S12]。";
  const result = normalizeRagAnswer(answer, sources);
  assert.equal(result.answer, answer.replace("[s8]", "[S8]"));
  assert.deepEqual(result.citations, [sources[1], sources[0], sources[2]]);
  assert.deepEqual(normalizeRagAnswer(result.answer, result.citations), result);
});

test("unused identities stay absent and unknown bracket labels are removed outside literals", () => {
  const sources = [source("S1", 0), source("S8", 7)];
  const answer = "事实[S8]，未知[S99]，`[S99]`，[链接](https://example.test/S1)。";
  const result = normalizeRagAnswer(answer, sources);
  assert.equal(result.answer, answer.replace("未知[S99]", "未知"));
  assert.deepEqual(result.citations, [sources[1]]);
  assert.equal(sources[1].sourceId, "S8");
});
