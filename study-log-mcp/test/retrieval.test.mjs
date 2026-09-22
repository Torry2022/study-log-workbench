import test from "node:test";
import assert from "node:assert/strict";
import { KeywordRetriever, buildSectionChunks, tokenize } from "../src/retrieval.mjs";
import { parseDayBlocks } from "../src/markdown-source.mjs";

function block(date, body) {
  return parseDayBlocks(`## ${date}\n\n${body}`, `${date.slice(0, 7)}_学习日志.md`)[0];
}

test("word tokenization retains technical identifiers without personal topic dictionaries", () => {
  assert.ok(tokenize("归一化 检索 BM25F retain_graph=True ABC-def").includes("retain_graph"));
  assert.ok(tokenize("归一化 检索 BM25F retain_graph=True ABC-def").includes("bm25f"));
  assert.deepEqual(tokenize("Alpha alpha Ａｌｐｈａ"), ["alpha"]);
  assert.ok(tokenize("植物生长与土壤水分").length > 0);
});

test("H3 chunks preserve headings, file identity, code and preamble instead of making entire days into evidence", () => {
  const blocks = [block("2026-01-01", "前言。\n\n### 1. 术语（原文）\n\n~~~md\n## 2026-01-09\n### FakeHeading\n~~~\n\n真实正文。\n\n### 第二小节\n\n独立内容。")];
  const chunks = buildSectionChunks(blocks);
  assert.deepEqual(chunks.map(chunk => [chunk.heading, chunk.headingIndex]), [[null, null], ["术语（原文）", 0], ["第二小节", 1]]);
  assert.ok(chunks[1].id.startsWith("2026-01_学习日志.md:2026-01-01:h0:"));
  assert.match(chunks[1].text, /## 2026-01-09/); assert.match(chunks[1].text, /### FakeHeading/);
  assert.equal(chunks[2].text, "独立内容。");
  assert.deepEqual(chunks, buildSectionChunks(blocks));
  const changed = buildSectionChunks([block("2026-01-01", "### 第二小节\n\n更新内容。")]);
  assert.notEqual(changed[0].hash, chunks[2].hash);
});

test("oversized sections use bounded overlapping chunks", () => {
  const content = Array.from({ length: 900 }, (_, i) => `line-${i} unique sample\n`).join("");
  const chunks = buildSectionChunks([block("2026-01-01", `### Long\n${content}`)]);
  assert.ok(chunks.length > 2); assert.ok(chunks.every(chunk => chunk.text.length <= 2400));
  assert.deepEqual(chunks.map(chunk => chunk.partIndex), chunks.map((_, index) => index));
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i - 1].text.includes(chunks[i].text.slice(0, 100)));
});

test("BM25F title weighting and document rarity drive keyword ranks; RRF scores remain compatible", () => {
  const retriever = new KeywordRetriever();
  let ranked = retriever.buildRankedMatches(buildSectionChunks([
    block("2026-01-01", "### SeedAlpha\n观测土壤。"), block("2026-01-02", "### Notes\n正文提及 SeedAlpha。")
  ]), "SeedAlpha");
  assert.equal(ranked[0].chunk.date, "2026-01-01");
  assert.ok(ranked[0].keywordScore > ranked[1].keywordScore); assert.equal(ranked[0].score, 1 / 61);
  const common = Array.from({ length: 12 }, (_, index) => block(`2026-02-${String(index + 1).padStart(2, "0")}`, "### Common topic\ncommon words common words repeated topic."));
  ranked = retriever.buildRankedMatches(buildSectionChunks([block("2026-01-01", "### RareKey900\nrare source."), ...common]), "RareKey900 common words topic");
  assert.equal(ranked[0].chunk.date, "2026-01-01"); assert.ok(ranked[0].matchedTerms.includes("rarekey900"));
  const filtered = retriever.filterWeakMatches([{ score: 1 }, { score: 0.7 }, { score: 0.59 }]);
  assert.deepEqual(filtered.map(match => match.score), [1, 0.7]);
});

test("literal lookup returns complete matching H3 source, merges overlaps and exposes a named fallback", async () => {
  const retriever = new KeywordRetriever();
  const source = "开始 retain_graph=True。\n\n" + Array.from({ length: 500 }, (_, i) => `Synthetic-${i} context evidence.`).join("\n") + "\n结尾。";
  const blocks = [block("2026-01-01", `### 1. Graph\n\n${source}\n\n### Other\n\nNot part of result.`)];
  const literal = await retriever.retrieveContexts(blocks, "retain_graph=True", { matchMode: "literal", maxChars: 30000 });
  assert.equal(literal.retrieval.mode, "literal"); assert.equal(literal.contexts.length, 1);
  const context = literal.contexts[0];
  assert.equal(context.heading, "Graph"); assert.equal(context.headingIndex, 0); assert.equal(context.fileName, "2026-01_学习日志.md");
  assert.ok(context.chunkIds.length > 1); assert.equal(context.contentHashes.length, context.chunkIds.length);
  assert.ok(context.content.startsWith("开始 retain_graph=True。")); assert.ok(context.content.endsWith("结尾。"));
  assert.equal((context.content.match(/Synthetic-250 context evidence\./g) || []).length, 1);
  assert.doesNotMatch(context.content, /Not part of result/);
  const fallback = await retriever.retrieveContexts(blocks, "Graph", { matchMode: "literal", literalQuery: "literal-absent" });
  assert.equal(fallback.retrieval.mode, "literal_fallback_lexical_fallback"); assert.equal(fallback.retrieval.literalQuery, "literal-absent");
  assert.ok(fallback.contexts.length > 0);
});

test("date filtering is inclusive, validated and shared by literal/keyword/related entrypoints", async () => {
  const retriever = new KeywordRetriever();
  const blocks = [block("2026-01-01", "### Alpha\nSeedTerm oldest evidence."), block("2026-01-02", "### Beta\nSeedTerm middle evidence."), block("2026-01-03", "### Gamma\nSeedTerm newest evidence.")];
  for (const matchMode of ["hybrid", "literal"]) {
    const result = await retriever.retrieveContexts(blocks, "SeedTerm", { matchMode, dateFrom: "2026-01-02", dateTo: "2026-01-02" });
    assert.deepEqual(result.contexts.map(context => context.date), ["2026-01-02"]);
    assert.equal(result.context.dateFrom, "2026-01-02"); assert.equal(result.context.dateTo, "2026-01-02");
    assert.equal((await retriever.retrieveContexts(blocks, "SeedTerm", { matchMode, dateFrom: "2026-02-01" })).contexts.length, 0);
  }
  assert.deepEqual((await retriever.findRelated(blocks, "SeedTerm", { dateFrom: "2026-01-03" })).results.map(result => result.date), ["2026-01-03"]);
  for (const options of [{ dateFrom: "2026-02-30" }, { dateTo: "wrong" }, { dateFrom: "2026-01-03", dateTo: "2026-01-01" }, { strategy: "unapproved" }, { maxChars: NaN }, { matchMode: "regex" }]) {
    await assert.rejects(retriever.retrieveContexts(blocks, "SeedTerm", options), error => error.code === "INVALID_ARGUMENT");
  }
});

test("timeline preserves date coverage even without term overlap, comparison rotates themes", async () => {
  const retriever = new KeywordRetriever();
  const blocks = [block("2026-01-01", "### Soil\nSeedTerm first observation."), block("2026-01-02", "### Soil\nSeedTerm second analysis."), block("2026-01-03", "### Water\nUnrelated water-level evidence.")];
  const timeline = await retriever.retrieveContexts(blocks, "SeedTerm", { strategy: "timeline_summary", maxChunks: 3 });
  assert.equal(timeline.retrieval.strategy, "timeline_summary");
  assert.deepEqual(timeline.contexts.map(context => context.date), ["2026-01-03", "2026-01-02", "2026-01-01"]);
  const themes = [block("2026-01-01", "### Soil\nSeedTerm alpha."), block("2026-01-02", "### Soil\nSeedTerm beta."), block("2026-01-03", "### Water\nSeedTerm gamma.")];
  const comparison = await retriever.retrieveContexts(themes, "SeedTerm", { strategy: "comparison", maxChunks: 2 });
  assert.deepEqual(new Set(comparison.contexts.map(context => context.heading)), new Set(["Soil", "Water"]));
});

test("context budgets, logical source IDs and deduplication stay accurate with no network or index dependencies", async t => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error("Unexpected network access"); };
  t.after(() => { globalThis.fetch = previous; });
  const retriever = new KeywordRetriever();
  const body = "SeedTerm " + "独立记录内容。".repeat(650);
  const blocks = [block("2026-01-01", `### One\n${body}`), block("2026-01-02", `### Two\n${body}`), block("2026-01-03", "### Three\nSeedTerm completely separate short text.")];
  const result = await retriever.retrieveContexts(blocks, "SeedTerm", { maxChars: 1600, maxChunks: 2 });
  assert.ok(result.contexts.length <= 2); assert.ok(result.context.totalChars <= 1600);
  assert.equal(result.context.totalChars, result.contexts.reduce((sum, context) => sum + context.content.length, 0));
  assert.ok(result.context.truncated); assert.deepEqual(result.contexts.map(context => context.sourceId), result.contexts.map((_, i) => `S${i + 1}`));
  assert.equal(result.retrieval.mode, "lexical_fallback"); assert.equal(result.retrieval.model, null); assert.equal(result.retrieval.indexUpdatedAt, null);
  const full = await retriever.retrieveContexts(blocks, "SeedTerm", { maxChars: 30000 });
  assert.equal(full.contexts.length, 2);
  const related = await retriever.findRelated(blocks, "SeedTerm", { maxResults: 2 });
  assert.equal(related.results.length, 2); assert.ok(related.results.every(result => result.matches.length <= 3));
  assert.equal(calls, 0);
});
