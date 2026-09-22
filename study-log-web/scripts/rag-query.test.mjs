import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as chatConfig from "../lib/ai-config.ts";
import * as mcpConfig from "../lib/mcp-config.ts";
import * as answer from "../lib/rag-answer.ts";
import * as query from "../lib/rag-query.ts";
import { contextualizeRagQuestion, planRagRetrievalWithFallback } from "../lib/rag-planning.ts";

async function fixture(t) {
  const state = { requests: [], contexts: true, broken: false, semanticFailure: false, stall: false, started: undefined };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET") { res.writeHead(405); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); state.requests.push(body);
      const reply = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      if (req.url === "/mcp") {
        if (body.method === "server/discover") return reply({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "legacy" } });
        if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1" } } });
        if (!Object.hasOwn(body, "id")) { res.writeHead(202); res.end(); return; }
        if (body.method === "tools/call") {
          if (state.stall) { state.started?.(); return; }
          const contexts = state.contexts ? [{ sourceId: "S1", date: "2026-08-01", month: "2026-08", fileName: "2026-08_学习日志.md", heading: null, headingIndex: null, chunkId: "synthetic", contentHash: "a".repeat(64), content: "合成证据", truncated: false, score: 1 }] : [];
          return reply({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ contexts, context: { maxChunks: body.params.arguments.maxChunks, maxChars: body.params.arguments.maxChars, returnedChunks: contexts.length, totalChars: contexts.length * 4, truncated: false }, retrieval: { mode: "lexical_fallback" } }) }] } });
        }
        return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      }
      if (!body.stream) {
        if (state.semanticFailure) { res.writeHead(500); res.end("synthetic-private-provider-body"); return; }
        const contextualizing = body.messages[0].content.includes("独立查询");
        return reply({ choices: [{ message: { content: JSON.stringify(contextualizing ? { query: "原文哪里提到合成证据？" } : { strategy: "timeline_summary", dateFrom: null, dateTo: null }) }, finish_reason: "stop" }] });
      }
      res.setHeader("content-type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "合成回答[S1]" } }] })}\n\n${state.broken ? "" : "data: [DONE]\n\n"}`);
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const main = { baseUrl: `${url}/chat`, apiKey: "synthetic", model: "main-mock" };
  return { state, config: { chat: main, lightChat: { ...main, model: "light-mock" }, mcp: { url: `${url}/mcp`, token: "synthetic" } } };
}
async function events(stream) {
  return (await new Response(stream).text()).trim().split("\n\n").filter(Boolean).map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n").slice(1).join("\n").slice(6)) }));
}
const input = { question: "原文哪里提到合成证据？", history: [], mode: "logs_only" };

test("query emits sources/delta/done with source hashes and no persisted history", async t => {
  const { state, config } = await fixture(t);
  const values = await events(query.createRagQueryStream(input, config, new AbortController().signal));
  assert.deepEqual(values.map(item => item.event), ["status", "status", "sources", "status", "delta", "done"]);
  assert.equal(values.at(-1).data.answer, "合成回答[S1]");
  assert.equal(values.at(-1).data.citations[0].contentHash, "a".repeat(64));
  assert.equal(values.at(-1).data.citations[0].headingIndex, null);
  assert.equal(values.at(-1).data.diagnostics.status, "completed");
  assert.equal(state.requests.filter(item => item.stream).length, 1);
  assert.equal(state.requests.filter(item => item.messages && !item.stream).length, 0);
});

test("logs-only without evidence skips answer model while general mode remains explicit", async t => {
  const { state, config } = await fixture(t); state.contexts = false;
  let values = await events(query.createRagQueryStream(input, config, new AbortController().signal));
  assert.equal(values.at(-1).data.diagnostics.status, "no_evidence"); assert.equal(state.requests.filter(item => item.stream).length, 0);
  values = await events(query.createRagQueryStream({ ...input, mode: "logs_and_general" }, config, new AbortController().signal));
  assert.equal(values.at(-1).event, "done"); assert.deepEqual(values.at(-1).data.citations, []);
  assert.match(state.requests.find(item => item.stream).messages[0].content, /通用知识补充/);
});

test("truncated answer produces error after partial delta and never done", async t => {
  const { state, config } = await fixture(t); state.broken = true;
  const values = await events(query.createRagQueryStream(input, config, new AbortController().signal));
  assert.ok(values.some(item => item.event === "delta")); assert.equal(values.at(-1).event, "error");
  assert.equal(values.at(-1).data.code, "AI_STREAM_INTERRUPTED"); assert.equal(values.at(-1).data.diagnostics.failureStage, "answering");
  assert.ok(!values.some(item => item.event === "done"));
});

test("contextualization and semantic planning use light model, fallback safely and never swallow cancellation", async t => {
  const { state, config } = await fixture(t);
  assert.equal(await contextualizeRagQuestion("它呢？", [{ role: "user", content: "合成" }], undefined, config.lightChat), input.question);
  const plan = await planRagRetrievalWithFallback("合成主题的发展", undefined, new Date("2026-08-01T00:00:00Z"), config.lightChat);
  assert.equal(plan.planner, "llm"); assert.equal(plan.plan.strategy, "timeline_summary");
  assert.ok(state.requests.every(item => item.model === "light-mock"));
  state.semanticFailure = true;
  const values = await events(query.createRagQueryStream({ ...input, question: "合成概念是什么？", history: [{ role: "user", content: "之前的问题" }] }, config, new AbortController().signal));
  assert.equal(values.at(-1).event, "done"); assert.equal(values.at(-1).data.diagnostics.contextualizationFallback, true); assert.equal(values.at(-1).data.diagnostics.retrievalPlanner, "fallback");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(planRagRetrievalWithFallback("概念是什么？", controller.signal, new Date(), config.lightChat), { code: "AI_CANCELLED" });
});

test("consumer cancellation stops stalled MCP and does not start answer generation", { timeout: 5000 }, async t => {
  const { state, config } = await fixture(t); state.stall = true;
  const started = new Promise(resolve => { state.started = resolve; });
  const reader = query.createRagQueryStream(input, config, new AbortController().signal).getReader();
  await started; await reader.cancel();
  assert.equal((await reader.read()).done, true);
  assert.equal(state.requests.filter(item => item.stream).length, 0);
});

async function loadRoute(auth) {
  const source = await fs.readFile(new URL("../app/api/rag/query/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const dependencies = { "@/lib/auth": { requireAuth: auth }, "@/lib/ai-config": chatConfig, "@/lib/mcp-config": mcpConfig, "@/lib/rag-answer": answer, "@/lib/rag-query": query };
  runInNewContext(compiled, { exports, require: name => { if (!(name in dependencies)) throw Error(`Unexpected import ${name}`); return dependencies[name]; }, Response, TextDecoder, Buffer });
  return exports;
}

test("real route function authenticates before parsing and bounds JSON, mode and configuration", async t => {
  const anonymous = await loadRoute(() => Response.json({ error: "Unauthorized" }, { status: 401 }));
  assert.equal((await anonymous.POST({ get body() { throw Error("must not parse"); } })).status, 401);
  const route = await loadRoute(() => null);
  const request = body => new Request("http://localhost/api/rag/query", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  for (const body of ["broken-json", null, {}, { question: "x".repeat(2001) }, { question: "test", mode: "wiki" }]) assert.equal((await route.POST(request(body))).status, 400);
  assert.equal((await route.POST(request("x".repeat(128 * 1024 + 1)))).status, 413);
  const before = process.env.CHAT_API_KEY; delete process.env.CHAT_API_KEY;
  t.after(() => { if (before === undefined) delete process.env.CHAT_API_KEY; else process.env.CHAT_API_KEY = before; });
  const response = await route.POST(request(input)); assert.equal(response.status, 503); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await response.json()).code, "AI_CONFIGURATION_INVALID");
});

test("actual route streams local MCP and provider calls end to end", async t => {
  const { config } = await fixture(t), route = await loadRoute(() => null);
  const env = { CHAT_API_KEY: config.chat.apiKey, CHAT_API_URL: config.chat.baseUrl, CHAT_MODEL: config.chat.model, CHAT_LIGHT_MODEL: config.lightChat.model, STUDY_LOG_MCP_URL: config.mcp.url, STUDY_LOG_MCP_TOKEN: config.mcp.token };
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const response = await route.POST(new Request("http://localhost/api/rag/query", { method: "POST", body: JSON.stringify(input) }));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/event-stream/); assert.equal(response.headers.get("x-accel-buffering"), "no");
  const values = await events(response.body); assert.equal(values.at(-1).event, "done");
});
