import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { HybridRetriever, KeywordRetriever } from "../src/retrieval.mjs";
import { EmbeddingClient, RerankClient } from "../src/providers.mjs";
import { parseDayBlocks } from "../src/markdown-source.mjs";
import { StudyLogStore } from "../src/log-store.mjs";

function block(date, text) { return parseDayBlocks(`## ${date}\n\n${text}`, `${date.slice(0, 7)}_学习日志.md`)[0]; }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-hybrid-fixture-"));
  const logRoot = path.join(root, "data"), indexRoot = path.join(root, "index"); await fs.mkdir(logRoot);
  await fs.writeFile(path.join(logRoot, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
  const requests = [], state = { embedding: "ok", rerank: "ok" };
  const server = http.createServer(async (req, res) => {
    const raw = []; for await (const chunk of req) raw.push(chunk);
    const input = JSON.parse(Buffer.concat(raw).toString()); requests.push({ url: req.url, input });
    if (req.url === "/embedding") {
      if (state.embedding === "500") { res.statusCode = 500; return res.end("private-provider-body"); }
      if (state.embedding === "stall") { res.write("{"); return; }
      return res.end(JSON.stringify({ data: input.input.map((text, index) => ({ index, embedding: state.embedding === "invalid" ? ["bad"] : /土壤|water availability/.test(text) ? [1, 0] : [0, 1] })) }));
    }
    if (state.rerank === "500") { res.statusCode = 500; return res.end("private-provider-body"); }
    res.end(JSON.stringify({ results: state.rerank === "invalid" ? [{ index: 999, relevance_score: 1 }] : input.documents.map((_, index) => ({ index, relevance_score: index / input.documents.length })) }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("mcp-hybrid-fixture-")); await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const embedding = { apiKey: "embedding-only", apiUrl: base + "/embedding", model: "synthetic-vector", dimensions: 2 };
  const reranker = { apiKey: "rerank-only", apiUrl: base + "/rerank", model: "synthetic-rank" };
  return { root, logRoot, indexRoot, requests, state, embedding, reranker,
    retriever: (options = {}) => new HybridRetriever({ logRoot, indexRoot, embedding, reranker, rerankEnabled: false, ...options }) };
}
const sources = () => [block("2026-01-01", "### 土壤\n土壤保水能力和植物生长观测。"), block("2026-01-02", "### Solar\nSolar energy experiment unrelated to water.")];

test("semantic recall fuses with BM25F through RRF, reuses cached vectors and preserves context references", async t => {
  const f = await fixture(t), retriever = f.retriever();
  assert.equal((await new KeywordRetriever().retrieveContexts(sources(), "water availability")).contexts.length, 0);
  const result = await retriever.retrieveContexts(sources(), "water availability");
  assert.equal(result.retrieval.mode, "hybrid"); assert.equal(result.retrieval.model, "synthetic-vector"); assert.equal(result.retrieval.dimensions, 2);
  assert.ok(result.contexts.some(context => context.date === "2026-01-01" && context.heading === "土壤" && context.semanticScore === 1));
  assert.ok(result.contexts.every(context => context.fileName === "2026-01_学习日志.md" && context.content));
  assert.equal(f.requests.filter(request => request.url === "/embedding").length, 2);
  await retriever.retrieveContexts(sources(), "water availability");
  assert.equal(f.requests.filter(request => request.url === "/embedding").length, 3);
  assert.equal(f.requests.filter(request => request.url === "/rerank").length, 0);
});

test("missing or malformed embedding configuration retains keyword results without network or index creation", async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.logRoot, ".instance.json"));
  for (const embedding of [{ apiKey: "", apiUrl: "", model: "" }, { ...f.embedding, dimensions: -1 }]) {
    const result = await f.retriever({ embedding }).retrieveContexts(sources(), "Solar");
    assert.equal(result.retrieval.mode, "lexical_fallback"); assert.ok(result.contexts.length);
    assert.match(result.retrieval.reason, /^embedding_(?:not_configured|invalid_configuration)$/);
  }
  assert.equal(f.requests.length, 0); assert.deepEqual(await fs.readdir(f.root), ["data"]);
});

test("missing or invalid instance identity explicitly falls back to keyword without provider calls", async t => {
  const f = await fixture(t), file = path.join(f.logRoot, ".instance.json");
  await fs.unlink(file);
  for (const raw of [null, "{broken", '{"schemaVersion":1,"id":"invalid"}']) {
    if (raw !== null) await fs.writeFile(file, raw);
    const result = await f.retriever().retrieveContexts(sources(), "Solar");
    assert.equal(result.retrieval.mode, "lexical_fallback"); assert.equal(result.retrieval.reason, "instance_identity_unavailable");
    assert.ok(result.contexts.length);
  }
  assert.equal(f.requests.length, 0); await assert.rejects(fs.stat(f.indexRoot), { code: "ENOENT" });
});

test("provider error, malformed vectors, timeout and unwritable index produce an explicit lexical fallback", async t => {
  const f = await fixture(t);
  for (const [mode, expected] of [["500", "embedding_provider_failed"], ["invalid", "embedding_invalid_response"], ["stall", "embedding_timeout"]]) {
    f.state.embedding = mode;
    const result = await f.retriever({ embedding: { ...f.embedding, timeoutMs: 30 } }).retrieveContexts(sources(), "Solar");
    assert.equal(result.retrieval.mode, "lexical_fallback"); assert.equal(result.retrieval.reason, expected); assert.ok(result.contexts.length);
    assert.doesNotMatch(JSON.stringify(result.retrieval), /127\.0\.0\.1|private-provider-body|embedding-only/);
  }
  f.state.embedding = "ok"; await fs.writeFile(f.indexRoot, "not a directory");
  const result = await f.retriever().retrieveContexts(sources(), "Solar");
  assert.equal(result.retrieval.reason, "index_unavailable"); assert.ok(result.contexts.length);
});

test("successful literal lookup and empty source avoid all optional provider calls and writes", async t => {
  const f = await fixture(t), retriever = f.retriever({ rerankEnabled: true });
  const result = await retriever.retrieveContexts(sources(), "土壤", { matchMode: "literal" });
  assert.equal(result.retrieval.mode, "literal"); assert.ok(result.contexts.length);
  const empty = await retriever.retrieveContexts([], "anything"); assert.equal(empty.contexts.length, 0);
  assert.equal(f.requests.length, 0); assert.deepEqual(await fs.readdir(f.root), ["data"]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(retriever.retrieveContexts(sources(), "土壤", { matchMode: "literal", signal: controller.signal }), error => error.code === "cancelled");
});

test("rerank is independent and opt-in, reranks at most 30 candidates and preserves the remaining first stage", async t => {
  const f = await fixture(t);
  const many = Array.from({ length: 55 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 11, i + 1)).toISOString().slice(0, 10);
    return block(date, `### SharedTopic ${i}\nSharedTerm unique observation ${i}.`);
  });
  const retriever = f.retriever({ embedding: { apiKey: "" }, rerankEnabled: true });
  const baseline = await retriever.rankChunks(many, "SharedTerm", { rerank: false });
  assert.equal(f.requests.length, 0);
  const reranked = await retriever.rankChunks(many, "SharedTerm");
  assert.equal(reranked.retrieval.rerank.status, "applied"); assert.equal(reranked.retrieval.rerank.candidateCount, 30);
  assert.equal(f.requests[0].input.documents.length, 30); assert.equal(reranked.ranked.length, baseline.ranked.length);
  assert.equal(reranked.ranked[0].chunk.id, baseline.ranked[29].chunk.id);
  assert.deepEqual(reranked.ranked.slice(30).map(match => match.chunk.id), baseline.ranked.slice(30).map(match => match.chunk.id));
  assert.equal(reranked.retrieval.mode, "lexical_fallback");
});

test("rerank failure restores first-stage ordering; incomplete configuration and coverage strategies skip requests", async t => {
  const f = await fixture(t), retriever = f.retriever({ embedding: { apiKey: "" }, rerankEnabled: true });
  const blocks = [block("2026-01-01", "### Alpha\nSharedTerm old record."), block("2026-01-02", "### Beta\nSharedTerm new record.")];
  const baseline = await retriever.rankChunks(blocks, "SharedTerm", { rerank: false });
  for (const mode of ["500", "invalid"]) {
    f.state.rerank = mode;
    const result = await retriever.rankChunks(blocks, "SharedTerm");
    assert.equal(result.retrieval.rerank.status, "fallback");
    assert.deepEqual(result.ranked.map(match => match.chunk.id), baseline.ranked.map(match => match.chunk.id));
  }
  const before = f.requests.length;
  for (const strategy of ["timeline_summary", "comparison"]) {
    const result = await retriever.rankChunks(blocks, "SharedTerm", { strategy });
    assert.equal(result.retrieval.rerank.status, "skipped"); assert.equal(result.retrieval.rerank.reason, "strategy_not_supported");
  }
  const missing = await f.retriever({ embedding: { apiKey: "" }, reranker: { apiKey: "" }, rerankEnabled: true }).rankChunks(blocks, "SharedTerm");
  assert.equal(missing.retrieval.rerank.reason, "not_configured"); assert.equal(f.requests.length, before);
});

test("StudyLogStore uses the hybrid pipeline without modifying source bytes or timestamps", async t => {
  const f = await fixture(t), file = path.join(f.logRoot, "2026-01_学习日志.md");
  const source = sources().map(day => day.content).join("\n\n---\n\n") + "\n"; await fs.writeFile(file, source);
  const before = (await fs.stat(file)).mtimeMs;
  const store = new StudyLogStore(f.logRoot, { indexRoot: f.indexRoot, retrieval: { embedding: f.embedding, reranker: f.reranker, rerankEnabled: false } });
  const result = await store.retrieveContexts("water availability"); assert.equal(result.retrieval.mode, "hybrid");
  assert.equal(await fs.readFile(file, "utf8"), source); assert.equal((await fs.stat(file)).mtimeMs, before);
  assert.deepEqual(await fs.readdir(f.logRoot), [".instance.json", "2026-01_学习日志.md"]);
});
