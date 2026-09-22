import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EmbeddingClient, RerankClient, MAX_PROVIDER_RESPONSE_BYTES } from "../src/providers.mjs";

async function serve(t, handler) {
  const server = http.createServer((req, res) => { void Promise.resolve(handler(req, res)).catch(() => res.destroy()); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }
function safe(error, code) { assert.equal(error.code, code); assert.doesNotMatch(error.message, /private-key|raw-provider|127\.0\.0\.1/); return true; }

test("legacy/chat keys never enable either provider, incomplete/invalid settings make zero requests", async t => {
  const keys = ["CHAT_API_KEY", "DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "EMBEDDING_API_KEY", "EMBEDDING_API_URL", "EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS", "EMBEDDING_TIMEOUT_MS", "RERANK_API_KEY", "RERANK_API_URL", "RERANK_MODEL", "RERANK_TIMEOUT_MS"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const fetch = globalThis.fetch; let calls = 0;
  t.after(() => { globalThis.fetch = fetch; for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  keys.forEach(key => delete process.env[key]);
  process.env.CHAT_API_KEY = process.env.DASHSCOPE_API_KEY = process.env.DEEPSEEK_API_KEY = "private-key-never-used";
  globalThis.fetch = () => { calls++; throw Error("Unexpected external request"); };
  assert.equal(new EmbeddingClient().enabled, false); assert.equal(new RerankClient().enabled, false);
  const valid = { apiKey: "private-key-fixture", apiUrl: "http://127.0.0.1:1/embedding", model: "synthetic" };
  for (const invalid of [{ apiKey: "" }, { apiUrl: "" }, { model: "" }, { apiUrl: "https://user:secret@example.invalid/embedding" }, { apiUrl: "file:///forbidden" }, { apiKey: "bad\nheader" }, { dimensions: NaN }, { dimensions: -1 }, { timeoutMs: 0 }]) {
    const client = new EmbeddingClient({ ...valid, ...invalid }); assert.equal(client.enabled, false);
    await assert.rejects(client.embed(["fixture"]), error => ["not_configured", "invalid_configuration"].includes(error.code));
  }
  assert.equal(calls, 0);
});

test("embedding/rerank use independent credentials, explicit model and complete URL; configs stay immutable", async t => {
  const requests = [];
  const url = await serve(t, async (req, res) => {
    const input = await body(req); requests.push({ url: req.url, key: req.headers.authorization, input });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url.startsWith("/embed") ? { data: input.input.map((_, index) => ({ index, embedding: [1, 0] })).reverse() }
      : { results: input.documents.map((_, index) => ({ index, relevance_score: index / 10 })) }));
  });
  const embedding = new EmbeddingClient({ apiKey: "embed-private-key", apiUrl: `${url}/embed?version=one`, model: "embed-only", dimensions: 2 });
  const reranker = new RerankClient({ apiKey: "rank-private-key", apiUrl: `${url}/rerank`, model: "rank-only" });
  assert.deepEqual(await embedding.embed(["A", "B"]), [[1, 0], [1, 0]]);
  assert.deepEqual(await reranker.rerank("question", ["A", "B"]), [{ index: 1, score: 0.1 }, { index: 0, score: 0 }]);
  assert.equal(requests[0].url, "/embed?version=one"); assert.equal(requests[0].key, "Bearer embed-private-key");
  assert.equal(requests[1].key, "Bearer rank-private-key"); assert.equal(requests[1].input.model, "rank-only");
  assert.equal(requests[0].input.encoding_format, "float"); assert.equal(requests[0].input.dimensions, 2);
  assert.throws(() => { embedding.model = "mutated"; }, TypeError);
});

test("embedding rejects malformed shapes, wrong dimensions, duplicate indices, numeric strings and non-finite values", async t => {
  let response;
  const url = await serve(t, async (req, res) => { await body(req); res.end(response); });
  const client = new EmbeddingClient({ apiKey: "private-key", apiUrl: url, model: "fixture", dimensions: 2 });
  for (response of ["{raw-provider", '{}', '{"data":[null]}', '{"data":[{"index":0,"embedding":[1]}]}', '{"data":[{"index":1,"embedding":[1,0]}]}', '{"data":[{"index":0,"embedding":["1",0]}]}', '{"data":[{"index":0,"embedding":[1e999,0]}]}']) {
    await assert.rejects(client.embed(["sample"]), error => safe(error, "invalid_response"));
  }
  response = JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [1, 0] }] });
  await assert.rejects(client.embed(["a", "b"]), error => safe(error, "invalid_response"));
});

test("rerank rejects partial, duplicate, out-of-range or coercible result indices and invalid scores", async t => {
  let results;
  const url = await serve(t, async (req, res) => { await body(req); res.end(JSON.stringify({ results })); });
  const client = new RerankClient({ apiKey: "private-key", apiUrl: url, model: "fixture" });
  for (results of [[], [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0 }], [{ index: 0, relevance_score: 1 }, { index: 2, relevance_score: 0 }], [{ index: "0", relevance_score: 1 }, { index: 1, relevance_score: 0 }], [{ index: 0, relevance_score: null }, { index: 1, relevance_score: 0 }]]) {
    await assert.rejects(client.rerank("query", ["a", "b"]), error => safe(error, "invalid_response"));
  }
});

test("HTTP failures, redirect, oversized response, stalled body and caller cancellation stay safe and retryable", async t => {
  let mode = "429", started, redirected = 0;
  const url = await serve(t, async (req, res) => {
    if (req.url === "/redirect-target") { redirected++; return res.end("raw-provider"); }
    await body(req);
    if (mode === "429" || mode === "500") { res.statusCode = Number(mode); return res.end("raw-provider private-key"); }
    if (mode === "redirect") { res.statusCode = 302; res.setHeader("Location", "/redirect-target"); return res.end(); }
    if (mode === "large") return res.end(Buffer.alloc(MAX_PROVIDER_RESPONSE_BYTES + 1, 32));
    if (mode === "stall") { res.write("{"); started?.(); return; }
    res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }));
  });
  const options = { apiKey: "private-key", apiUrl: url, model: "fixture", dimensions: 2 };
  const client = new EmbeddingClient(options);
  for (const [behavior, code] of [["429", "rate_limited"], ["500", "provider_failed"], ["redirect", "network_error"], ["large", "response_too_large"]]) {
    mode = behavior; await assert.rejects(client.embed(["sample"]), error => safe(error, code));
  }
  assert.equal(redirected, 0);
  mode = "stall"; await assert.rejects(new EmbeddingClient({ ...options, timeoutMs: 30 }).embed(["sample"]), error => safe(error, "timeout"));
  const seen = new Promise(resolve => { started = resolve; }), controller = new AbortController();
  const pending = client.embed(["sample"], { signal: controller.signal }); await seen; controller.abort();
  await assert.rejects(pending, error => safe(error, "cancelled"));
  mode = "ok"; assert.deepEqual(await client.embed(["sample"]), [[1, 0]]);
});
