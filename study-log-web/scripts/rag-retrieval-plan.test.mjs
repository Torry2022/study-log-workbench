import assert from "node:assert/strict";
import test from "node:test";
import {
  chinaTodayIso,
  needsSemanticRetrievalPlanning,
  normalizeSemanticRetrievalPlan,
  planRagRetrieval
} from "../lib/rag-retrieval-plan.ts";

test("rules never roll invalid log dates into a different day or month", () => {
  for (const query of ["2026年2月30日总结", "2026年13月总结", "2026年2月28日到2月30日总结", "2026年0月1日总结"]) {
    const plan = planRagRetrieval(query);
    assert.equal(plan.dateFrom, undefined, query);
    assert.equal(plan.dateTo, undefined, query);
  }
  assert.equal(planRagRetrieval("2024年2月29日总结").dateFrom, "2024-02-29");
});

test("literal lookup preserves fullwidth and compatibility characters", () => {
  assert.equal(planRagRetrieval("原文哪里提到`ＡＰＩ①`？").literalQuery, "ＡＰＩ①");
});

test("Shanghai day boundary and previous-month rollover are deterministic", () => {
  const now = new Date("2026-12-31T16:01:00Z");
  assert.equal(chinaTodayIso(now), "2027-01-01");
  assert.equal(planRagRetrieval("上月学习内容", now).dateFrom, "2026-12-01");
  assert.equal(planRagRetrieval("最近学了什么", now).dateFrom, "2026-12-26");
});

test("semantic plans whitelist budgets and cannot introduce another evidence layer", () => {
  assert.deepEqual(normalizeSemanticRetrievalPlan({ strategy: "comparison", dateFrom: null, dateTo: null, useWiki: true, maxChunks: 999999, maxChars: 999999 }), {
    strategy: "comparison", maxChunks: 12, maxChars: 18000
  });
});

test("plans a same-month range when the end omits year and month", () => {
  assert.deepEqual(planRagRetrieval("2026年6月22日至6月24日大致学习了哪些内容？"), {
    dateFrom: "2026-06-22",
    dateTo: "2026-06-24",
    strategy: "timeline_summary",
    maxChunks: 20,
    maxChars: 30000
  });
});

test("plans a same-year range when the end omits year", () => {
  assert.deepEqual(planRagRetrieval("2026-06-28到07-02学习内容概览"), {
    dateFrom: "2026-06-28",
    dateTo: "2026-07-02",
    strategy: "timeline_summary",
    maxChunks: 20,
    maxChars: 30000
  });
});

test("recognizes 主要学习 as a timeline summary", () => {
  assert.equal(planRagRetrieval("2026年6月3日至6月7日主要学习了什么？").strategy, "timeline_summary");
});

test("recognizes a Chinese-numeral recent-day range", () => {
  assert.deepEqual(planRagRetrieval("我近七天大概学了什么", new Date("2026-07-17T04:00:00Z")), {
    dateFrom: "2026-07-11",
    dateTo: "2026-07-17",
    strategy: "timeline_summary",
    maxChunks: 20,
    maxChars: 30000
  });
});

test("keeps a fully qualified range", () => {
  const plan = planRagRetrieval("比较2026年5月1日至2026年6月2日的内容");
  assert.equal(plan.dateFrom, "2026-05-01");
  assert.equal(plan.dateTo, "2026-06-02");
  assert.equal(plan.strategy, "comparison");
});

test("includes both explicitly named days in a comparison", () => {
  assert.deepEqual(planRagRetrieval("对比 2026-01-14 与 2026-01-15 的备份策略记录"), {
    dateFrom: "2026-01-14", dateTo: "2026-01-15", strategy: "comparison", maxChunks: 12, maxChars: 18000
  });
  assert.deepEqual(planRagRetrieval("比较 2026-01-15 和 2026-01-14 的区别"), {
    dateFrom: "2026-01-14", dateTo: "2026-01-15", strategy: "comparison", maxChunks: 12, maxChars: 18000
  });
});


test("routes an explicit quoted source lookup to literal raw-log retrieval", () => {
  assert.deepEqual(planRagRetrieval("我哪天写过`retain_graph=True`？"), {
    strategy: "relevance",
    matchMode: "literal",
    literalQuery: "retain_graph=True"
  });
});

test("routes an unquoted original-text lookup to literal raw-log retrieval", () => {
  assert.deepEqual(planRagRetrieval("原文哪里提到Prompt Cache？"), {
    strategy: "relevance",
    matchMode: "literal",
    literalQuery: "Prompt Cache"
  });
});

test("keeps common source-lookup wording out of the literal query", () => {
  assert.deepEqual(planRagRetrieval("我哪天提到过Prompt Cache？"), {
    strategy: "relevance",
    matchMode: "literal",
    literalQuery: "Prompt Cache"
  });
});

test("keeps conceptual questions on semantic retrieval planning", () => {
  const plan = planRagRetrieval("计算图为什么需要保留？");
  assert.equal(plan.matchMode, undefined);
  assert.equal(needsSemanticRetrievalPlanning(plan), true);
});

test("uses semantic planning only when rules leave an unconstrained relevance query", () => {
  assert.equal(needsSemanticRetrievalPlanning(planRagRetrieval("RRF是什么？")), true);
  assert.equal(needsSemanticRetrievalPlanning(planRagRetrieval("我近七天大概学了什么")), false);
  assert.equal(needsSemanticRetrievalPlanning(planRagRetrieval("比较Chroma和Qdrant")), false);
});

test("normalizes a structured semantic timeline plan", () => {
  assert.deepEqual(
    normalizeSemanticRetrievalPlan({
      strategy: "timeline_summary",
      dateFrom: "2026-07-10",
      dateTo: "2026-07-04"
    }),
    {
      dateFrom: "2026-07-04",
      dateTo: "2026-07-10",
      strategy: "timeline_summary",
        maxChunks: 20,
      maxChars: 30000
    }
  );
});


test("rejects malformed semantic plans", () => {
  assert.equal(
    normalizeSemanticRetrievalPlan({ strategy: "timeline_summary", dateFrom: "2026-02-30", dateTo: "2026-03-02" }),
    null
  );
  assert.equal(
    normalizeSemanticRetrievalPlan({ strategy: "timeline_summary", dateFrom: "2026-03-01", dateTo: null }),
    null
  );
  assert.equal(normalizeSemanticRetrievalPlan({ strategy: "agent", dateFrom: null, dateTo: null }), null);
});
