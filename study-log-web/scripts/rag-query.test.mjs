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
import { readLogRange } from "../../study-log-mcp/src/range-reader.mjs";

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
          if (body.params.name === "read_log_range" && state.rangePage) {
            return reply({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(state.rangePage(body.params.arguments)) }] } });
          }
          const contexts = state.contexts === false ? [] : Array.isArray(state.contexts) ? state.contexts :
            [{ sourceId: "S1", date: "2026-08-01", month: "2026-08", fileName: "2026-08_学习日志.md", heading: null, headingIndex: null, chunkId: "synthetic", contentHash: "a".repeat(64), content: "合成证据", truncated: false, score: 1 }];
          return reply({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ contexts, context: { maxChunks: body.params.arguments.maxChunks, maxChars: body.params.arguments.maxChars, returnedChunks: contexts.length, totalChars: contexts.reduce((sum, item) => sum + item.content.length, 0), truncated: false }, retrieval: { mode: "lexical_fallback" } }) }] } });
        }
        return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      }
      if (!body.stream) {
        if (state.semanticFailure) { res.writeHead(500); res.end("synthetic-private-provider-body"); return; }
        const contextualizing = body.messages[0].content.includes("独立查询");
        return reply({ choices: [{ message: { content: JSON.stringify(contextualizing ? { query: state.rewritten || "原文哪里提到合成证据？" } : { strategy: "timeline_summary", dateFrom: null, dateTo: null }) }, finish_reason: "stop" }] });
      }
      res.setHeader("content-type", "text/event-stream");
      if(state.modelFrame){res.end(`data: ${JSON.stringify(state.modelFrame)}\n\n`);return;}
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: state.answer || "合成回答[S1]" } }] })}\n\n${state.broken ? "" : "data: [DONE]\n\n"}`);
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

test('query error diagnostics retain supplied usage for truncated final generation',async t=>{
  const {state,config}=await fixture(t);
  state.modelFrame={choices:[{finish_reason:'length'}],usage:{prompt_tokens:42,completion_tokens:21}};
  const values=await events(query.createRagQueryStream({question:'合成证据具体是什么？',history:[],mode:'logs_only'},config,new AbortController().signal));
  assert.equal(values.at(-1).event,'error');assert.equal(values.at(-1).data.code,'AI_OUTPUT_TRUNCATED');
  assert.deepEqual(values.at(-1).data.diagnostics.usage,[{model:'main-mock',inputTokens:42,outputTokens:21}]);
  assert.ok(!values.some(value=>value.event==='done'));
});

test('query done keeps a bare partial-source mention distinct from the complete cited source',async t=>{
  const {state,config}=await fixture(t);
  state.contexts=[
    {sourceId:'S1',date:'2026-08-01',month:'2026-08',fileName:'2026-08_学习日志.md',heading:'片段',headingIndex:0,chunkId:'partial',contentHash:'a'.repeat(64),content:'部分条件',truncated:true,score:1},
    {sourceId:'S2',date:'2026-08-01',month:'2026-08',fileName:'2026-08_学习日志.md',heading:'完整条件',headingIndex:1,chunkId:'complete',contentHash:'b'.repeat(64),content:'明确确认后才能保存',truncated:false,score:1}
  ];
  state.answer='明确确认后才能保存[S2]。S1 为部分片段，S2 提供完整条件。';
  const values=await events(query.createRagQueryStream({question:'保存的条件是什么？',history:[],mode:'logs_only'},config,new AbortController().signal));
  const result=values.at(-1);assert.equal(result.event,'done');
  assert.equal(result.data.answer,'明确确认后才能保存[S1]。S2 为部分片段，S1 提供完整条件。');
  assert.deepEqual(result.data.citations.map(item=>({sourceId:item.sourceId,chunkId:item.chunkId})),[{sourceId:'S1',chunkId:'complete'},{sourceId:'S2',chunkId:'partial'}]);
  assert.deepEqual(values.find(item=>item.event==='sources').data.citations,result.data.citations);
});

test("a changed range revision rejects the query before answer generation", async t => {
  const { state, config } = await fixture(t);
  const blocks = [{ date: "2026-09-01", month: "2026-09", fileName: "2026-09_学习日志.md", content: "甲".repeat(45000) }];
  state.rangePage = args => {
    const page = readLogRange(blocks, args);
    if (args.cursor) page.coverage.revision = "b".repeat(64);
    return page;
  };
  const values = await events(query.createRagQueryStream({ question: "比较2026年9月和10月", history: [], mode: "logs_only" }, config, new AbortController().signal));
  assert.equal(values.at(-1).event, "error");
  assert.equal(values.at(-1).data.code, "MCP_SOURCE_CHANGED");
  assert.equal(values.some(item => ["sources", "delta", "done"].includes(item.event)), false);
  assert.equal(state.requests.filter(item => item.method === "tools/call").length, 2);
  assert.equal(state.requests.some(item => item.messages), false);
});

test("followup matrix: source pointers cannot silently fall back to unrelated retrieval", async t => {
  const { state, config } = await fixture(t);
  for (const history of [[], [{ role: "assistant", content: "旧客户端回答[S1]" }]]) {
    const result = await events(query.createRagQueryStream({ question: "刚才第二条来源具体怎么说？", history, mode: "logs_only" }, config, new AbortController().signal));
    assert.equal(result.at(-1).event, "done");
    assert.match(result.at(-1).data.answer, /无法确定/);
    assert.deepEqual(result.at(-1).data.citations, []);
  }
  assert.equal(state.requests.length, 0);
});

test("routing matrix: invalid explicit dates request correction without unbounded retrieval", async t => {
  const { state, config } = await fixture(t);
  for (const question of ["总结2026年2月30日", "总结2026年13月", "总结2026年2月28日至30日"]) {
    const result = await events(query.createRagQueryStream({ question, history: [{ role: "user", content: "之前的问题" }], mode: "logs_only" }, config, new AbortController().signal));
    assert.equal(result.at(-1).event, "done");
    assert.match(result.at(-1).data.answer, /日期似乎有误/);
  }
  assert.equal(state.requests.length, 0);
});

test('source pointers outside explicit dates request clarification without reading other dates', async t => {
  const {state,config}=await fixture(t);
  const history=[{role:'assistant',content:'旧回答',sourceRefs:[
    {date:'2026-08-01',fileName:'2026-08_学习日志.md',heading:null,contentHash:'a'.repeat(64)},
    {date:'2026-08-02',fileName:'2026-08_学习日志.md',heading:null,contentHash:'b'.repeat(64)}
  ]}];
  for(const question of ['刚才第二条来源，只看2026年十月的记录。','刚才第二条来源，限定2026年十月并找`新主题`原文。','刚才第二条来源，只查2026-08-01和2026-08-03的记录。']){
    const values=await events(query.createRagQueryStream({question,history,mode:'logs_only'},config,new AbortController().signal));
    assert.equal(values.at(-1).event,'done');assert.match(values.at(-1).data.answer,/指定.*日期范围/);
    assert.deepEqual(values.at(-1).data.citations,[]);
  }
  assert.equal(state.requests.length,0);
});

test("followup matrix: rewriting cannot add old dates to new literal lookups or event-date questions", async t => {
  const { state, config } = await fixture(t);
  state.rewritten = "2026年九月哪里提到过合成证据？";
  for (const [question, expectedFrom, expectedLiteral] of [
    ["哪里提到过`新主题`？", undefined, "新主题"],
    ["2026年十月哪里提到过`新主题`？", "2026-10-01", "新主题"],
    ["2026年十月哪里提到过`2026年2月30日`？", "2026-10-01", "2026年2月30日"],
    ["我记录过2025年九月发布的模型吗？", undefined, undefined]
  ]) {
    const before = state.requests.length;
    state.contexts = expectedFrom ? [{ sourceId:'S1',date:expectedFrom,month:expectedFrom.slice(0,7),fileName:`${expectedFrom.slice(0,7)}_学习日志.md`,heading:null,headingIndex:null,chunkId:'synthetic',contentHash:'a'.repeat(64),content:'合成证据 新主题 2026年2月30日',truncated:false,score:1 }] : true;
    const result = await events(query.createRagQueryStream({ question, history: [{ role: "user", content: "九月学了什么？" }], mode: "logs_only" }, config, new AbortController().signal));
    assert.equal(result.at(-1).event, "done");
    const tool = state.requests.slice(before).find(item => item.method === "tools/call");
    assert.equal(tool.params.arguments.dateFrom, expectedFrom);
    assert.equal(tool.params.arguments.literalQuery, expectedLiteral);
  }
});
test('out-of-range MCP search evidence fails before answer generation', async t => {
  const {state,config}=await fixture(t);
  const values=await events(query.createRagQueryStream({question:'2026年十月哪里提到过`合成证据`？',history:[],mode:'logs_only'},config,new AbortController().signal));
  assert.equal(values.at(-1).event,'error');assert.equal(values.at(-1).data.code,'MCP_INVALID_RESPONSE');
  assert.ok(!values.some(item=>['delta','sources','done'].includes(item.event)));
  assert.equal(state.requests.filter(item=>item.stream).length,0);
});
const input = { question: "原文哪里提到合成证据？", history: [], mode: "logs_only" };

test("query emits sources/delta/done with source hashes and no persisted history", async t => {
  const { state, config } = await fixture(t);
  const values = await events(query.createRagQueryStream(input, config, new AbortController().signal));
  assert.deepEqual(values.map(item => item.event), ["status", "status", "status", "delta", "sources", "done"]);
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
  assert.equal(values.at(-1).event, "done"); assert.equal(values.at(-1).data.diagnostics.contextualizationFallback, true); assert.equal(values.at(-1).data.diagnostics.retrievalPlanner, "rules");
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
  const { config, state } = await fixture(t), route = await loadRoute(() => null);
  state.contexts = [1, 2].map(number => ({ sourceId: `S${number}`, date: `2026-08-0${number}`,
    month: "2026-08", fileName: "2026-08_学习日志.md", heading: `第${number}项`, headingIndex: number - 1,
    chunkId: `synthetic-${number}`, contentHash: "a".repeat(64), content: `合成证据${number}`, truncated: false, score: 1 }));
  state.answer = "第二项[S2]，S2 说明第二项[S2]；S1 说明第一项[S1]。";
  const env = { CHAT_API_KEY: config.chat.apiKey, CHAT_API_URL: config.chat.baseUrl, CHAT_MODEL: config.chat.model, CHAT_LIGHT_MODEL: config.lightChat.model, STUDY_LOG_MCP_URL: config.mcp.url, STUDY_LOG_MCP_TOKEN: config.mcp.token };
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const response = await route.POST(new Request("http://localhost/api/rag/query", { method: "POST", body: JSON.stringify(input) }));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/event-stream/); assert.equal(response.headers.get("x-accel-buffering"), "no");
  const values = await events(response.body); assert.equal(values.at(-1).event, "done", JSON.stringify(values));
  assert.equal(values.at(-1).data.answer, "第二项[S1]，S1 说明第二项[S1]；S2 说明第一项[S2]。");
  assert.deepEqual(values.at(-1).data.citations.map(item => item.heading), ["第2项", "第1项"]);
});

test('explicit abstention suppresses unrelated follow-up text and candidates in both stream and final result', async t => {
 const {state,config}=await fixture(t);state.answer=answer.NO_LOG_EVIDENCE+'\n无关材料[S1]';
 let values=await events(query.createRagQueryStream(input,config,new AbortController().signal));
 assert.equal(values.filter(x=>x.event==='delta').map(x=>x.data.text).join(''),answer.NO_LOG_EVIDENCE);
 assert.deepEqual(values.find(x=>x.event==='sources').data.citations,[]);
 assert.equal(values.at(-1).data.answer,answer.NO_LOG_EVIDENCE);assert.equal(values.at(-1).data.diagnostics.status,'no_evidence');
 assert.equal(values.at(-1).data.groundingWarning,undefined);
 state.broken=true;
 values=await events(query.createRagQueryStream(input,config,new AbortController().signal));
 assert.equal(values.at(-1).event,'error');assert.ok(!values.some(x=>x.event==='done'));
});

test('general mode preserves its supplement but cannot attach rejected log sources', async t => {
 const {state,config}=await fixture(t);
 state.answer=answer.NO_LOG_EVIDENCE+'\n无关材料[S1]\n## 通用知识补充\n一般说明。';
 const values=await events(query.createRagQueryStream({...input,mode:'logs_and_general'},config,new AbortController().signal));
 assert.equal(values.at(-1).data.answer,answer.NO_LOG_EVIDENCE+'\n\n## 通用知识补充\n一般说明。');assert.deepEqual(values.at(-1).data.citations,[]);
 assert.equal(values.at(-1).data.groundingWarning,undefined);
});
