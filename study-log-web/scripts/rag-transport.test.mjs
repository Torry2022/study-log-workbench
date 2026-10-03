import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { inspectMcpConfig, getMcpConfig } from "../lib/mcp-config.ts";
import { retrieveStudyLogContexts, validateRetrievedContexts } from "../lib/mcp-client.ts";
import { streamRagAnswer } from "../lib/rag-stream.ts";

const source = () => ({ sourceId: "S1", date: "2026-08-01", month: "2026-08", fileName: "2026-08_学习日志.md", heading: null, headingIndex: null, chunkId: "synthetic-chunk", contentHash: "a".repeat(64), content: "合成日志", excerpt: "合成", truncated: false, score: 1 });
const result = () => ({ contexts: [source()], context: { maxChunks: 8, maxChars: 12000, returnedChunks: 1, totalChars: 4, truncated: false, strategy: "relevance", matchMode: "hybrid" }, retrieval: { mode: "lexical_fallback", strategy: "relevance" } });
async function server(t, handler) {
  const instance = http.createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => res.destroy()); });
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(async () => { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); });
  return `http://127.0.0.1:${instance.address().port}`;
}
async function json(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }
function reply(res, body) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); }
const event = delta => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\r\n\r\n`;
const chat = url => ({ baseUrl: url, apiKey: "synthetic-key-do-not-echo", model: "synthetic" });

test("MCP configuration is explicit and diagnostics never echo secrets or URLs", () => {
  assert.equal(inspectMcpConfig({}).configured, false);
  for (const url of ["file:///tmp/mcp", "https://user:secret@example.test/mcp", "https://example.test/mcp#token", "https://example.test\\mcp"]) {
    const output = inspectMcpConfig({ STUDY_LOG_MCP_URL: url, STUDY_LOG_MCP_TOKEN: "synthetic" });
    assert.equal(output.configured, false); assert.ok(!JSON.stringify(output).includes(url));
  }
  assert.equal(inspectMcpConfig({ STUDY_LOG_MCP_URL: "http://127.0.0.1:1/mcp", STUDY_LOG_MCP_TOKEN: "bad\nheader" }).configured, false);
  assert.deepEqual(getMcpConfig({ STUDY_LOG_MCP_URL: "http://proxy.test/mcp", STUDY_LOG_MCP_TOKEN: "synthetic" }), { url: "http://proxy.test/mcp", token: "synthetic" });
});

test("MCP result validation retains preamble identity and rejects forged or unbounded source metadata", () => {
  assert.equal(validateRetrievedContexts(result()).contexts[0].headingIndex, null);
  const emptyHeading = result(); emptyHeading.contexts[0].heading = ""; emptyHeading.contexts[0].headingIndex = 0;
  assert.equal(validateRetrievedContexts(emptyHeading).contexts[0].headingIndex, 0);
  const mutations = [v => v.contexts.push(v.contexts[0]), v => v.contexts[0].headingIndex = 0, v => v.contexts[0].sourceType = "wiki", v => v.contexts[0].fileName = "../outside.md", v => v.contexts[0].date = "2026-02-30", v => v.contexts[0].fileName = "2025_学习日志.md", v => v.contexts[0].contentHash = "fake", v => v.context.totalChars = 999, v => v.contexts[0].content = "x".repeat(30001), v => v.contexts[0].score = Infinity];
  for (const mutate of mutations) { const value = result(); mutate(value); assert.throws(() => validateRetrievedContexts(value), { code: "MCP_INVALID_RESPONSE" }); }
});

test("real SDK legacy handshake carries token and bounded raw-log retrieve_contexts contract", async t => {
  const requests = [];
  const url = await server(t, async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    if (req.method === "GET") { res.writeHead(405); res.end(); return; }
    const body = await json(req); requests.push(body);
    if (body.method === "server/discover") return reply(res, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unsupported" } });
    if (body.method === "initialize") return reply(res, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "1" } } });
    if (!Object.hasOwn(body, "id")) { res.writeHead(202); res.end(); return; }
    if (body.method === "tools/call") return reply(res, { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(result()) }] } });
    reply(res, { jsonrpc: "2.0", id: body.id, result: { tools: [] } });
  });
  const output = await retrieveStudyLogContexts("合成问题", { strategy: "relevance", matchMode: "literal", literalQuery: "ＡＰＩ" }, undefined, { url, token: "synthetic-token" });
  assert.equal(output.contexts[0].contentHash, "a".repeat(64));
  const call = requests.find(item => item.method === "tools/call");
  assert.deepEqual(call.params.arguments, { input: "合成问题", strategy: "relevance", matchMode: "literal", literalQuery: "ＡＰＩ", maxChunks: 8, maxChars: 12000 });
});

test("MCP cancellation and deadline terminate stalled connect without exposing endpoint", async t => {
  let received;
  const started = new Promise(resolve => { received = resolve; });
  const url = await server(t, (req, res) => { received(); req.resume(); });
  const controller = new AbortController();
  const request = retrieveStudyLogContexts("query", undefined, controller.signal, { url, token: "synthetic-token" });
  await started; controller.abort(); await assert.rejects(request, { code: "MCP_CANCELLED" });
  await assert.rejects(retrieveStudyLogContexts("query", undefined, undefined, { url, token: "synthetic-token" }, 30), { code: "MCP_TIMEOUT" });
});

test("MCP remote failures and oversized protocol responses remain sanitized", async t => {
  let large = false;
  const url = await server(t, (req, res) => { req.resume(); res.setHeader("content-type", "application/json"); if (!large) { res.writeHead(403); res.end("synthetic-secret-token and private path"); } else res.end("x".repeat(1024 * 1024 + 1)); });
  await assert.rejects(retrieveStudyLogContexts("query", undefined, undefined, { url, token: "synthetic-token" }), error => error.code === "MCP_UNAVAILABLE" && !/secret|127\.0|private path/.test(error.message));
  large = true;
  await assert.rejects(retrieveStudyLogContexts("query", undefined, undefined, { url, token: "synthetic-token" }, 3000), { code: "MCP_INVALID_RESPONSE" });
});

test("model stream handles chunked UTF-8, comments, CRLF and terminal marker without trailing newline", async t => {
  let sent;
  const url = await server(t, async (req, res) => {
    sent = await json(req); assert.equal(req.headers.authorization, "Bearer synthetic-key-do-not-echo");
    res.setHeader("content-type", "text/event-stream");
    const bytes = Buffer.from(`: ping\r\n\r\n${event("合成")}${event("回答[S1]")}data: [DONE]`);
    for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3)); res.end();
  });
  const deltas = [];
  assert.equal(await streamRagAnswer(chat(url), [{ role: "user", content: "test" }], value => deltas.push(value)), "合成回答[S1]");
  assert.equal(deltas.join(""), "合成回答[S1]"); assert.equal(sent.stream, true);
});

test("model stream accepts bounded framing overhead above one MiB", async t => {
  const url = await server(t, async (req, res) => {
    await json(req); res.setHeader("content-type", "text/event-stream");
    res.end(":" + "x".repeat(1024 * 1024) + "\n\n" + event("合成回答") + "data: [DONE]\n\n");
  });
  assert.equal(await streamRagAnswer(chat(url), [], () => {}), "合成回答");
});

test("model never treats truncated, malformed, filtered, empty or excessive streams as complete", async t => {
  let body;
  const url = await server(t, async (req, res) => { await json(req); res.setHeader("content-type", "text/event-stream"); res.end(body); });
  for (const [value, code] of [
    [event("partial"), "AI_STREAM_INTERRUPTED"],
    ["data: nope\n\n", "AI_INVALID_STREAM"],
    ['data: {"choices":[{"finish_reason":"length"}]}\n\n', "AI_OUTPUT_TRUNCATED"],
    ['data: {"choices":[{"finish_reason":"content_filter"}]}\n\n', "AI_OUTPUT_INCOMPLETE"],
    ["data: [DONE]\n\n", "AI_EMPTY_RESPONSE"],
    [event("x".repeat(120001)) + "data: [DONE]\n\n", "AI_RESPONSE_TOO_LARGE"],
    [":" + "x".repeat(2 * 1024 * 1024) + "\n", "AI_RESPONSE_TOO_LARGE"]
  ]) { body = value; await assert.rejects(streamRagAnswer(chat(url), [], () => {}), { code }); }
});

test("model abort/deadline cancel network and provider bodies are not reflected", async t => {
  let behavior = "stall", started;
  const url = await server(t, async (req, res) => { await json(req); if (behavior === "failure") { res.writeHead(401); res.end("synthetic-key-do-not-echo"); return; } res.setHeader("content-type", "text/event-stream"); res.write(event("first")); started?.(); });
  const controller = new AbortController(), seen = [];
  const promise = streamRagAnswer(chat(url), [], value => { seen.push(value); controller.abort(); }, { signal: controller.signal });
  await assert.rejects(promise, { code: "AI_CANCELLED" }); assert.deepEqual(seen, ["first"]);
  await assert.rejects(streamRagAnswer(chat(url), [], () => {}, { timeoutMs: 30 }), { code: "AI_TIMEOUT" });
  behavior = "failure";
  await assert.rejects(streamRagAnswer(chat(url), [], () => {}), error => error.code === "AI_PROVIDER_AUTH" && !error.message.includes("synthetic-key"));
});

test("neither MCP nor chat transport follows redirects that could forward credentials", async t => {
  let visits = 0;
  const target = await server(t, (req, res) => { visits++; req.resume(); res.end(); });
  const redirect = await server(t, (req, res) => { req.resume(); res.writeHead(307, { Location: target }); res.end(); });
  await assert.rejects(retrieveStudyLogContexts("query", undefined, undefined, { url: redirect, token: "synthetic-token" }), { code: "MCP_UNAVAILABLE" });
  await assert.rejects(streamRagAnswer(chat(redirect), [], () => {}), { code: "AI_NETWORK_ERROR" });
  assert.equal(visits, 0);
});
