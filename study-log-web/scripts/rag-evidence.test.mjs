import test from "node:test";
import assert from "node:assert/strict";
import { planRagRetrieval } from "../lib/rag-retrieval-plan.ts";
import { EvidenceRun, collectRagEvidence } from "../lib/rag-evidence.ts";
import { validateRangePage } from "../lib/mcp-client.ts";
import { readLogRange } from "../../study-log-mcp/src/range-reader.mjs";

const block = (date, content = "条件成立才适用，并非所有情况都成立。") => ({ date, month: date.slice(0, 7), fileName: `${date.slice(0, 7)}_学习日志.md`, content });
const config = { url: "http://unused.test", token: "synthetic" };
const readers = blocks => ({ search: async () => { throw Error("must enumerate"); }, read: async args => validateRangePage(readLogRange(blocks, args)) });

test("implicit comparison enumerates both periods and rejected comparison reads only the replacement scope", async () => {
  const blocks = [block("2026-08-01"), block("2026-09-01"), block("2026-10-01")];
  for (const [question, expected] of [
    ["2026年八月和十月的做法有什么变化？", ["2026-08-01", "2026-10-01"]],
    ["不用比较2026年九月和十月，只总结十月。", ["2026-10-01"]]
  ]) {
    const run = new EvidenceRun(new AbortController().signal);
    await collectRagEvidence(question, planRagRetrieval(question), run, config, readers(blocks));
    assert.deepEqual(run.contexts.map(item => item.date), expected);
    assert.ok(run.coverage.every(scope => scope.status === "complete"));
  }
});

test("literal constraints survive dates and event dates are not log filters", () => {
  const literal = planRagRetrieval("2026年9月的日志中哪里提到过`Agent`？");
  assert.equal(literal.dateFrom, "2026-09-01"); assert.equal(literal.literalQuery, "Agent");
  const event = planRagRetrieval("我记录过哪些关于2026年9月15日发布的模型的使用体验？");
  assert.equal(event.dateFrom, undefined); assert.equal(event.eventDates, true);
});
test("comparison reads both independent months and never intervening months", async () => {
  const plan = planRagRetrieval("比较2026年8月和2026年10月的学习内容");
  assert.equal(plan.strategy, "comparison"); assert.equal(plan.ranges.length, 2);
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("compare", plan, run, config, readers([block("2026-08-01"), block("2026-09-01"), block("2026-10-01")]));
  assert.deepEqual(run.contexts.map(item => item.date), ["2026-08-01", "2026-10-01"]);
  assert.deepEqual(run.contexts.map(item => item.sourceId), ["S1", "S2"]);
  assert.ok(run.coverage.every(scope => scope.status === "complete"));
});

test("Chinese and omitted-year months remain separate, while an explicit month range includes the gap", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  for (const question of ["比较九月和十月", "比较2026年9月和10月"]) {
    assert.deepEqual(planRagRetrieval(question, now).ranges, [
      { dateFrom: "2026-09-01", dateTo: "2026-09-30" }, { dateFrom: "2026-10-01", dateTo: "2026-10-31" }
    ]);
  }
  assert.deepEqual(planRagRetrieval("总结2026年8月至10月", now).ranges, [{ dateFrom: "2026-08-01", dateTo: "2026-10-31" }]);
});

test("31-day months are fully retained independently of the 30-citation client limit", async () => {
  const blocks = Array.from({ length: 31 }, (_, index) => block(`2026-10-${String(index + 1).padStart(2, "0")}`));
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("summary", planRagRetrieval("2026年10月总结"), run, config, readers(blocks));
  assert.equal(run.contexts.length, 31); assert.equal(run.limited, false); assert.equal(run.coverage[0].status, "complete");
});
test("thirty-day summary enumerates every day instead of top twenty", async () => {
  const blocks = Array.from({ length: 30 }, (_, index) => block(`2026-09-${String(index + 1).padStart(2, "0")}`));
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("summary", planRagRetrieval("2026年9月总结"), run, config, readers(blocks));
  assert.equal(run.contexts.length, 30); assert.equal(run.coverage[0].readDates.length, 30);
  assert.equal(run.coverage[0].status, "complete"); assert.equal(run.calls, 2);
});
test("partial, failed and empty scopes remain distinct", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("summary", planRagRetrieval("2026年9月总结"), run, config, readers([]));
  assert.equal(run.coverage[0].status, "empty");
  await collectRagEvidence("summary", planRagRetrieval("2026年10月总结"), run, config, { read: async () => { throw Error(); } });
  assert.equal(run.coverage[1].status, "failed");
  assert.match(run.report(), /failed/);
});
test("cursor prevents mixed revisions and long days can be read without dropped characters", () => {
  const blocks = [block("2026-09-01", "甲".repeat(45000))];
  const first = readLogRange(blocks, { dateFrom: "2026-09-01", dateTo: "2026-09-01" });
  const second = readLogRange(blocks, { dateFrom: "2026-09-01", dateTo: "2026-09-01", cursor: first.coverage.nextCursor });
  assert.equal(first.context.totalChars + second.context.totalChars, 45000);
  assert.deepEqual(second.coverage.completedDates, ["2026-09-01"]);
  assert.throws(() => readLogRange([block("2026-09-01", "已修改")], { dateFrom: "2026-09-01", dateTo: "2026-09-01", cursor: first.coverage.nextCursor }), { code: "SOURCE_CHANGED" });
});

test('optional range section context is validated, retained and never changes citation heading identity', () => {
  const data=[block('2026-09-01','## 2026-09-01\n\n### Alpha\n\n'+'正文。'.repeat(1000))];
  const args={dateFrom:'2026-09-01',dateTo:'2026-09-01',maxChars:1000};
  const first=readLogRange(data,args),second=readLogRange(data,{...args,cursor:first.coverage.nextCursor});
  const parsed=validateRangePage(second).contexts[0];
  assert.deepEqual(parsed.rangeSection,{heading:'Alpha',headingIndex:0});assert.equal(parsed.heading,null);
  for(const invalid of [null,{heading:'',headingIndex:0},{heading:'Alpha',headingIndex:-1},{heading:'Alpha',headingIndex:0,extra:true}]){
    const changed=structuredClone(second);changed.contexts[0].rangeSection=invalid;
    assert.throws(()=>validateRangePage(changed),{code:'MCP_INVALID_RESPONSE'});
  }
  const noVersion=structuredClone(second);delete noVersion.contexts[0].dayContentHash;
  assert.throws(()=>validateRangePage(noVersion),{code:'MCP_INVALID_RESPONSE'});
  delete second.contexts[0].rangeSection;assert.equal(validateRangePage(second).contexts[0].rangeSection,undefined);
});
test("call cap, duplicate requests and cancellation stop actual reads", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  assert.equal(run.take("x", 1), true); assert.equal(run.take("x", 1), false);
  for (let i = 2; i <= 8; i++) assert.equal(run.take("x", i), true);
  assert.equal(run.take("x", 9), false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectRagEvidence("summary", planRagRetrieval("2026年9月总结"), new EvidenceRun(controller.signal), config, readers([])), { name: "AbortError" });
});
