import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startHttpServer } from "../../study-log-mcp/src/http-server.mjs";
import { EvidenceRun, collectRagEvidence } from "../lib/rag-evidence.ts";
import { createAgentModel, supplementEvidence, agentEnabled } from "../lib/rag-agent.ts";
import { judgeEvidence, validateEvidenceJudgment } from "../lib/rag-jev.ts";
import { createRagQueryStream } from "../lib/rag-query.ts";

const config = { baseUrl: "https://example.test/custom/endpoint?version=one", apiKey: "synthetic", model: "mock-tools" };
function firstAnswer(needsMoreEvidence, answer, finish = 'stop') {
  return new Response(JSON.stringify({ choices: [{ message: { role:'assistant', content:JSON.stringify({needsMoreEvidence,answer}) }, finish_reason:finish }], usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15} }), {headers:{'content-type':'application/json'}});
}
function stream(tool, args, id = "one") {
  const chunk = delta => `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "mock-tools", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "内部文本，不可送给用户。" }) + (tool ? chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }) : "") +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}
async function fixture(t, september = "## 2026-09-01\n\n### Alpha\nAlpha条件成立才适用，不适用于所有场景。") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rag-agent-fixture-"));
  const logRoot = path.join(root, "data"); await fs.mkdir(logRoot);
  await fs.writeFile(path.join(logRoot, "2026-09_学习日志.md"), september);
  await fs.writeFile(path.join(logRoot, "2026-10_学习日志.md"), Array.from({ length: 31 }, (_, index) => `## 2026-10-${String(index + 1).padStart(2, "0")}\n\n### 合成\n第${index + 1}天的材料。\n`).join("\n"));
  const service = await startHttpServer({ logRoot, indexRoot: path.join(root, "index"), port: 0, token: "synthetic", retrieval: { embedding: { apiKey: "" }, reranker: { apiKey: "" }, rerankEnabled: false } });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("rag-agent-fixture-")); await fs.rm(root, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${service.address.port}/mcp`, token: "synthetic" };
}
test("SDK tool loop uses exact configured endpoint and real read-only MCP, stopping after two rounds", async t => {
  const mcp = await fixture(t), requests = [], statuses = [];
  const model = createAgentModel(config, async (url, init) => {
    assert.equal(url, config.baseUrl); assert.equal(init.redirect, "error"); assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic");
    const body = JSON.parse(init.body); requests.push(body);
    return requests.length === 1 ? stream("search", { query: "Alpha" }) : stream("read", { date: "2026-09-01" }, "two");
  });
  const run = new EvidenceRun(new AbortController().signal);
  const usage = await supplementEvidence("Alpha为什么？", { strategy: "relevance", dateFrom: "2026-09-01", dateTo: "2026-09-01" }, run, mcp, model, value => statuses.push(value));
  assert.equal(requests.length, 2); assert.equal(run.calls, 1); assert.equal(run.contexts.length, 1);
  assert.equal(run.stopReason, "tool_failure"); assert.equal(run.contexts[0].heading, "Alpha");
  assert.equal(usage.usage.inputTokens, 20); assert.ok(statuses.every(value => !value.includes("内部文本")));
  const nextState = JSON.parse(requests[1].messages.find(message => message.role === "user").content);
  assert.ok(nextState.previousReads.length > 0);
  assert.ok(Array.isArray(nextState.previousReads[0]));
  assert.equal(nextState.remainingDecisions, 1);
  assert.deepEqual(nextState.availableReadDates, []);
  assert.deepEqual(nextState.lastTool, { name: "search", addedSourceIds: ["S1"], stopped: false });
  assert.equal(nextState.evidence[0].truncated, false);
  assert.ok(nextState.evidence.some(item => item.content.includes("Alpha")));
  assert.ok(!requests[1].messages.some(message => message.role === "tool"));
  assert.ok(run.contexts.every(item => item.date === "2026-09-01"));
});

test('ordinary facts answer once, literal lookup bypasses tools, and no leads stay unproven', async t => {
  const mcp = await fixture(t), old = {};
  for (const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED']) old[key] = process.env[key];
  Object.assign(process.env, { RAG_AGENT_ENABLED:'true', RAG_AGENT_TOOL_CALLING_VERIFIED:'true', RAG_JEV_ENABLED:'false' });
  const calls = []; let finishReason = 'sufficient_evidence';
  const server = http.createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw+=chunk;
    const body=JSON.parse(raw); calls.push(body);
    if (!body.stream) {res.setHeader('content-type','application/json');res.end(await firstAnswer(finishReason==='no_more_leads',finishReason==='no_more_leads'?'本次材料没有具体依据。':'Alpha条件成立才适用，不适用于所有场景。[S1]').text());return;}
    res.setHeader('content-type','text/event-stream');
    if (body.tools) res.end(await stream('finish',{reason:finishReason}).text());
    else res.end('data: '+JSON.stringify({choices:[{delta:{content:'Alpha条件成立才适用，不适用于所有场景。[S1]'}}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });
  const chat={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic',model:'mock'};
  const query=async question=>{
    const raw=await new Response(createRagQueryStream({question,mode:'logs_only',history:[]},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
    assert.match(raw.trim().split('\n\n').at(-1),/^event: done/);
    assert.ok(!raw.includes('内部文本'));
    return JSON.parse(raw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  };
  const fact=await query('Alpha的适用条件是什么？');
  assert.equal(calls.filter(call=>call.tools).length,0);
  assert.equal(calls.length,1); assert.equal(fact.diagnostics.toolCalls,1);
  assert.equal(fact.diagnostics.agent.stopReason,'sufficient_evidence');
  assert.equal(fact.citations.length,1);
  assert.ok(fact.diagnostics.coverage.every(scope=>scope.status==='search'));
  calls.length=0;
  const literal=await query('哪里提到过`Alpha`？');
  assert.equal(calls.length,1); assert.ok(!calls[0].tools);
  assert.equal(literal.diagnostics.agent,undefined);
  calls.length=0; finishReason='no_more_leads';
  const empty=await query('ZerofluxUnrecorded');
  assert.equal(calls.length,2); assert.ok(calls[1].tools);
  assert.equal(empty.diagnostics.agent.stopReason,'no_more_leads');
  assert.deepEqual(empty.citations,[]);
  assert.equal(empty.answer,'本次未找到能回答这个问题的记录。');
  assert.ok(empty.diagnostics.coverage.every(scope=>scope.status==='search'));
});

test('first answer uses one primary-model call, preserves modes and refuses incomplete output', async t => {
  const mcp=await fixture(t), previous={};
  for(const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'])previous[key]=process.env[key];
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  const calls=[]; let answer='Alpha条件成立才适用，不适用于所有场景。[S1]', interrupted=false;
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);calls.push(body);
    assert.equal(body.model,'primary-answer-model');assert.ok(!body.tools);assert.equal(body.temperature,0);
    assert.ok(body.messages.some(message=>message.role==='system' && message.content.includes('来源编号')));
    res.setHeader('content-type','application/json');res.end(await firstAnswer(false,answer,interrupted?'length':'stop').text());
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const chat={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic',model:'primary-answer-model'};
  for(const mode of ['logs_only','logs_and_general']){
    calls.length=0;
    answer='Alpha条件成立才适用，不适用于所有场景。[S1]'+(mode==='logs_and_general'?'\n\n## 通用知识补充\n理解概念时可以举例。':'');
    const raw=await new Response(createRagQueryStream({question:'Alpha的适用条件是什么？',mode,history:[]},{chat,lightChat:{...chat,model:'light-planner-model'},mcp},new AbortController().signal)).text();
    const terminal=raw.trim().split('\n\n').at(-1);assert.match(terminal,/^event: done/);
    const done=JSON.parse(terminal.split('\n')[1].slice(6));
    assert.equal(calls.length,1);assert.equal(done.answer,answer);assert.equal(done.citations[0].date,'2026-09-01');
    assert.match(raw,/event: delta/);assert.ok(!raw.includes('内部文本'));assert.ok(!JSON.stringify(done.diagnostics).includes(answer));
    assert.ok(calls[0].messages.at(-1).content.includes('Alpha条件成立才适用'));
    if(mode==='logs_and_general')assert.ok(calls[0].messages[0].content.includes('通用知识补充'));
  }
  interrupted=true;
  const raw=await new Response(createRagQueryStream({question:'Alpha的适用条件是什么？',mode:'logs_only',history:[]},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
  assert.match(raw,/event: error/);assert.ok(!raw.includes('event: delta'));assert.ok(!raw.includes(answer));
});

test('a finish answer after a search cannot bypass separate final generation', async t=>{
  const mcp=await fixture(t),run=new EvidenceRun(new AbortController().signal);let steps=0;
  const result=await supplementEvidence('Alpha的条件？',{strategy:'relevance'},run,mcp,createAgentModel(config,async(_url,init)=>!JSON.parse(init.body).stream?firstAnswer(true,'缺少Alpha条件。'):++steps===1?stream('search',{query:'Alpha'}):stream('finish',{reason:'sufficient_evidence',answer:'工具中的回答不可发布[S1]'})),()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(steps,2);assert.equal(result.answer,undefined);assert.equal(run.stopReason,'tool_failure');assert.equal(run.calls,1);
});

test('first-answer schema failures and provider errors stop before any tool, without retries', async () => {
  const invalid = ['not JSON', '{}', JSON.stringify({needsMoreEvidence:'false',answer:'错误类型'}), JSON.stringify({needsMoreEvidence:false,answer:' ',extra:true}), JSON.stringify({needsMoreEvidence:false,answer:'x'.repeat(40001)})];
  for(const text of invalid){
    let calls=0;const run=new EvidenceRun(new AbortController().signal);
    await assert.rejects(supplementEvidence('question',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{calls++;return Response.json({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]});}),()=>{},undefined,{mode:'logs_only',history:[]}),{code:'AGENT_DECISION_INVALID'});
    assert.equal(calls,1);assert.equal(run.calls,0);
  }
  for(const status of [401,429,500]){
    let calls=0;const run=new EvidenceRun(new AbortController().signal);
    await assert.rejects(supplementEvidence('question',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{calls++;return Response.json({error:{message:'synthetic private provider detail'}},{status});}),()=>{},undefined,{mode:'logs_only',history:[]}),error=>error.code==='AGENT_PROVIDER_FAILED'&&!error.message.includes('private'));
    assert.equal(calls,1);assert.equal(run.calls,0);
  }
});

test('first-answer cancellation reaches the provider and conversation stays part of its input', async () => {
  const controller=new AbortController(),run=new EvidenceRun(controller.signal);
  let entered,aborted;const started=new Promise(resolve=>entered=resolve),stopped=new Promise(resolve=>aborted=resolve);
  const response=supplementEvidence('继续这个问题',{strategy:'relevance'},run,{},createAgentModel(config,async(_url,init)=>{
    const body=JSON.parse(init.body);assert.ok(body.messages.some(item=>item.role==='user'&&item.content==='之前的问题'));
    entered();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted();reject(init.signal.reason);},{once:true}));
  }),()=>{},undefined,{mode:'logs_only',history:[{role:'user',content:'之前的问题'}]});
  const rejected=assert.rejects(response,/abort/i);await started;controller.abort();await rejected;await stopped;assert.equal(run.calls,0);
});
test('search and finish in the same model step cannot deliver a pre-search answer', async t=>{
  const mcp=await fixture(t),run=new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha',{strategy:'relevance'},run,mcp);
  const response=()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[
    {index:0,id:'search',type:'function',function:{name:'search',arguments:JSON.stringify({query:'Alpha'})}},
    {index:1,id:'finish',type:'function',function:{name:'finish',arguments:JSON.stringify({reason:'sufficient_evidence',answer:'不应交付[S1]'})}}
  ]},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  const result=await supplementEvidence('Alpha条件？',{strategy:'relevance'},run,mcp,createAgentModel(config,async(_url,init)=>!JSON.parse(init.body).stream?firstAnswer(true,'需要进一步核对。'):response()),()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(result.answer,undefined);
});
test("invalid tool args and nonexistent tools cannot execute reads", async t => {
  const mcp = await fixture(t);
  for (const [name, args] of [["search", { query: 123 }], ["delete", { date: "2026-09-01" }]]) {
    const run = new EvidenceRun(new AbortController().signal);
    await supplementEvidence("question", { strategy: "relevance" }, run, mcp, createAgentModel(config, async () => stream(name, args)), () => {});
    assert.equal(run.calls, 0); assert.equal(run.limited, true);
  }
});

test('a provider selecting an unavailable read cannot execute a duplicate MCP request', async t => {
  const mcp = await fixture(t), run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha', { strategy:'timeline_summary',dateFrom:'2026-09-01',dateTo:'2026-09-01' },run,mcp);
  assert.equal(run.calls,1);
  const before=[...run.requests]; let decisions=0;
  await supplementEvidence('Alpha的条件？',{strategy:'relevance'},run,mcp,createAgentModel(config,async (_url,init)=>{
    const body=JSON.parse(init.body), state=JSON.parse(body.messages.find(message=>message.role==='user').content);
    assert.deepEqual(state.availableReadDates,[]);
    assert.ok(!body.tools.some(item=>item.function.name==='read'));
    decisions++;
    return stream('read',{date:'2026-09-01'});
  }),()=>{});
  assert.ok(decisions>0 && decisions<=2);
  assert.equal(run.calls,1); assert.deepEqual([...run.requests],before);
});
test("tool-free internal text ends evidence gathering without publishing it or claiming coverage", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  const result = await supplementEvidence("question", { strategy: "relevance" }, run, {}, createAgentModel(config, async (_url, init) => {
    assert.equal(JSON.parse(init.body).tool_choice, 'auto'); return stream();
  }), () => {});
  assert.equal(result.answer, undefined); assert.equal(run.limited, true); assert.equal(run.stopReason, 'no_more_leads');
  assert.equal(run.calls, 0); assert.equal(agentEnabled({ RAG_AGENT_ENABLED: "true" }), false);
});
test("provider auth and rate failures are errors, not tool capability fallback", async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    await assert.rejects(supplementEvidence("question", { strategy: "relevance" }, new EvidenceRun(new AbortController().signal), {}, createAgentModel(config, async () => { calls++; return new Response("private provider body", { status }); }), () => {}), { code: "AGENT_PROVIDER_FAILED" });
    assert.equal(calls, 1);
  }
});
test("cancellation propagates into a stalled model fetch", async () => {
  const controller = new AbortController(); let called;
  const started = new Promise(resolve => { called = resolve; });
  const model = createAgentModel(config, (_url, init) => new Promise((_resolve, reject) => {
    called(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const pending = supplementEvidence("question", { strategy: "relevance" }, new EvidenceRun(controller.signal), {}, model, () => {});
  await started; controller.abort(); await assert.rejects(pending);
});
test("Jev rejects invalid choices/probabilities and makes one cancellable request without body logging", async () => {
  const answer = (selected, choices) => ({ type: "choice", choice: selected, confidence: 0.6, probabilities: Object.fromEntries(choices.map(value => [value, value === selected ? 0.8 : 0.1])) });
  const payload = { model: "jev-1.13.0", answers: { support: answer("missing", ["supported", "missing", "uncertain"]), conflict: answer("absent", ["present", "absent", "uncertain"]) }, usage: { input_tokens: 100, output_tokens: 0 } };
  assert.deepEqual(validateEvidenceJudgment(payload), { support: "missing", conflict: "absent" });
  assert.throws(() => validateEvidenceJudgment({ ...payload, answers: { ...payload.answers, support: { ...payload.answers.support, choice: "write" } } }));
  const response = await judgeEvidence("question", [], new AbortController().signal, "synthetic", async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, "jev-1.13.0");
    return Response.json(payload);
  });
  assert.equal(response.judgment.support, "missing");
});

test("31-day query supplies every day, returns a bounded cited subset and rereads history source pointers", async t => {
  const mcp = await fixture(t), requests = []; let answer = "最后一天的材料[S31]";
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw)); res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const chat = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "synthetic", model: "mock" };
  const query = async input => (await new Response(createRagQueryStream({ mode: "logs_only", history: [], ...input }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text()).trim().split("\n\n").map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n")[1].slice(6)) }));
  let events = await query({ question: "总结2026年10月" });
  assert.equal(events.at(-1).event, "done"); assert.equal(events.at(-1).data.diagnostics.coverage[0].readDates.length, 31);
  assert.equal(events.at(-1).data.citations.length, 1); assert.equal(events.at(-1).data.citations[0].date, "2026-10-31");
  assert.ok(requests[0].messages.at(-1).content.includes("第31天"));
  assert.ok(events.filter(item => item.event === "sources").every(item => item.data.citations.length <= 30));
  answer = "范围内的记录[S1]";
  for (const [question, strategy, months] of [
    ["2026年九月和十月的做法有什么变化？", "comparison", ["2026-09", "2026-10"]],
    ["不用比较九月和十月，只总结2026年十月。", "timeline_summary", ["2026-10"]],
    ["找出2026年十月日志里提到2026年九月发布事件的记录。", "relevance", ["2026-10"]]
  ]) {
    const before = requests.length;
    events = await query({ question });
    assert.equal(events.at(-1).event, "done");
    const diagnostics = events.at(-1).data.diagnostics;
    assert.equal(diagnostics.retrievalStrategy, strategy);
    assert.deepEqual([...new Set(diagnostics.coverage.map(scope => scope.dateFrom.slice(0, 7)))], months);
    if (strategy !== "relevance") assert.ok(diagnostics.coverage.every(scope => scope.status === "complete"));
    assert.ok(requests.length - before <= 1, "no additional model planning for explicit rules");
  }
  answer = "三个日期的记录[S1]";
  events = await query({ question: "2026年10月1日、2日和3日分别记录了什么？" });
  assert.equal(events.at(-1).event, "done");
  assert.deepEqual(events.at(-1).data.diagnostics.coverage.flatMap(scope => scope.readDates), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.ok(events.at(-1).data.diagnostics.coverage.every(scope => scope.status === "complete"));
  answer = Array.from({ length: 31 }, (_, index) => `[S${index + 1}]`).join(" ");
  events = await query({ question: "总结2026年10月" });
  assert.equal(events.at(-1).event, "error"); assert.equal(events.at(-1).data.code, "RAG_CITATION_LIMIT");
  answer = "重新读取的原文[S1]";
  events = await query({ question: "刚才第二条来源写了什么？", history: [{ role: "assistant", content: "历史回答", sourceRefs: [
    { date: "2026-10-01", fileName: "2026-10_学习日志.md", heading: null, contentHash: "b".repeat(64) },
    { date: "2026-09-01", fileName: "2026-09_学习日志.md", heading: "Alpha", contentHash: "b".repeat(64) }
  ] }] });
  assert.equal(events.at(-1).event, "done"); assert.equal(events.at(-1).data.citations[0].date, "2026-09-01");
  assert.notEqual(events.at(-1).data.citations[0].contentHash, "b".repeat(64));
  assert.match(requests.at(-1).messages.at(-1).content, /Alpha条件成立/);
});

test('Jev refuses oversized evidence before calling the provider and never slices accepted text', async () => {
  let calls=0;
  const transport=async (_url,init)=>{
    calls++;
    assert.equal(JSON.parse(init.body).state.evidence[0].content, 'a'.repeat(2200)+'end');
    throw new Error('synthetic provider failure');
  };
  await assert.rejects(judgeEvidence('question',[{sourceId:'S1',content:'a'.repeat(2401)}],new AbortController().signal,'synthetic',transport),/scope/);
  await assert.rejects(judgeEvidence('question',Array.from({length:5},(_,i)=>({sourceId:`S${i+1}`,content:'short'})),new AbortController().signal,'synthetic',transport),/scope/);
  assert.equal(calls,0);
  await assert.rejects(judgeEvidence('question',[{sourceId:'S1',content:'a'.repeat(2200)+'end'}],new AbortController().signal,'synthetic',transport));
  assert.equal(calls,1);
});

test('explicit finish stops the SDK loop without reading or claiming program-proven coverage', async () => {
  for (const reason of ['sufficient_evidence','no_more_leads']) {
    let calls=0;const run=new EvidenceRun(new AbortController().signal);
    await supplementEvidence('question',{strategy:'relevance'},run,{},createAgentModel(config,async (_url,init)=>{
      const body=JSON.parse(init.body);assert.equal(body.tool_choice,'auto');assert.equal(body.max_tokens,1200);calls++;return stream('finish',{reason});
    }),()=>{});
    assert.equal(calls,1);assert.equal(run.calls,0);assert.equal(run.stopReason,reason);
    assert.deepEqual(run.coverage,[]);
  }
});

test('complete comparisons bypass Agent and Jev while search-only questions retain the judge fallback', async t => {
 const mcp=await fixture(t),originalFetch=globalThis.fetch,old={};
 for(const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED','RAG_JEV_PROVIDER','TYPESAFE_API_KEY'])old[key]=process.env[key];
 Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'true',RAG_JEV_PROVIDER:'typesafe',TYPESAFE_API_KEY:'synthetic'});
 let judgeCalls=0, agentCalls=0;
 globalThis.fetch=(url,init)=>{if(String(url).startsWith('https://api.typesafe.ai')){judgeCalls++;return Promise.resolve(Response.json({error:'synthetic unavailable'},{status:503}));}return originalFetch(url,init);};
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);
  if(!body.stream){res.setHeader('content-type','application/json');res.end(await firstAnswer(true,'Alpha的原因尚不明确。').text());return;}
  res.setHeader('content-type','text/event-stream');
  if(body.tools){agentCalls++;res.end(await stream('finish',{reason:'sufficient_evidence'}).text());}
  else res.end('data: '+JSON.stringify({choices:[{delta:{content:'合成比较[S1]'}}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
  const chat={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic',model:'mock'};
  const raw=await new Response(createRagQueryStream({question:'比较2026年9月和10月',mode:'logs_only',history:[]},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
  const blocks=raw.trim().split('\n\n');const last=JSON.parse(blocks.at(-1).split('\n')[1].slice(6));
  assert.match(blocks.at(-1),/^event: done/);assert.equal(judgeCalls,0);
  assert.equal(last.diagnostics.agent,undefined);assert.equal(agentCalls,0);
  assert.ok(last.diagnostics.coverage.every(scope=>scope.status==='complete'));
  const empty=await new Response(createRagQueryStream({question:'比较2026年8月和9月',mode:'logs_only',history:[]},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
  const emptyDone=JSON.parse(empty.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.deepEqual(emptyDone.diagnostics.coverage.map(scope=>scope.status),['empty','complete']);
  assert.equal(emptyDone.diagnostics.agent,undefined);assert.equal(agentCalls,0);assert.equal(judgeCalls,0);
  const short=await new Response(createRagQueryStream({question:'Alpha为什么？',mode:'logs_only',history:[]},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
  const shortBlocks=short.trim().split('\n\n'),shortDone=JSON.parse(shortBlocks.at(-1).split('\n')[1].slice(6));
  assert.match(shortBlocks.at(-1),/^event: done/);assert.equal(judgeCalls,1);assert.equal(shortDone.diagnostics.agent.judgeUnavailable,true);
  assert.equal(shortDone.diagnostics.agent.judgeSkipped,undefined);assert.equal(shortDone.answer,'合成比较[S1]');
  assert.equal(agentCalls,1);
 }finally {
  server.closeAllConnections();await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;
  for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('complete long-range query summarizes then answers, while failed compaction retains Agent', async t => {
  const mcp = await fixture(t, '## 2026-09-01\n\n### Alpha\n' + '背景材料。'.repeat(7500) + '\n末尾约束：没有确认不能保存。');
  const oldAgent = process.env.RAG_AGENT_ENABLED, oldVerified = process.env.RAG_AGENT_TOOL_CALLING_VERIFIED;
  process.env.RAG_AGENT_ENABLED = 'true'; process.env.RAG_AGENT_TOOL_CALLING_VERIFIED = 'true';
  t.after(() => { for (const [name, value] of [['RAG_AGENT_ENABLED', oldAgent], ['RAG_AGENT_TOOL_CALLING_VERIFIED', oldVerified]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const stages = []; let failSummary = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw);
    if (!body.stream) {
      if(body.messages[0].content.includes('needsMoreEvidence')) {res.setHeader('content-type','application/json');res.end(await firstAnswer(true,'部分材料在压缩后仍缺少依据。').text());return;}
      stages.push('summary');
      if (failSummary) { res.writeHead(503); res.end('synthetic unavailable'); return; }
      const { evidence } = JSON.parse(body.messages[1].content);
      assert.ok(evidence.reduce((sum, item) => sum + item.content.length, 0) <= 30000, JSON.stringify({system:body.messages[0].content,stream:body.stream,tools:Boolean(body.tools),lengths:evidence.map(item=>item.content.length)}));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(evidence.map(item => ({ sourceId: item.sourceId, content: item.content.slice(-60) }))) } }] }));
    } else if (body.tools) {
      stages.push('agent');
      const current = JSON.parse(body.messages.find(item => item.role === 'user').content);
      assert.ok(current.evidence.reduce((sum, item) => sum + item.content.length, 0) <= 30000);
      res.setHeader('content-type', 'text/event-stream');
      res.end(await stream('finish', { reason: 'sufficient_evidence' }).text());
    } else {
      stages.push('answer');
      if (!failSummary) assert.match(body.messages.at(-1).content, /没有确认不能保存/);
      res.setHeader('content-type', 'text/event-stream');
      res.end('data: '+JSON.stringify({ choices: [{ delta: { content: '需要确认[S2]。' } }] })+'\n\ndata: [DONE]\n\n');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const chat = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic', model: 'mock' };
  const output = await new Response(createRagQueryStream({ question: '比较2026年九月和十月', mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text();
  assert.match(output, /event: done/);
  assert.equal(stages[0], 'summary');
  assert.ok(!stages.includes('agent')); assert.equal(stages.at(-1), 'answer');
  const done=JSON.parse(output.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.equal(done.diagnostics.agent,undefined);
  failSummary=true; stages.length=0;
  const failed=await new Response(createRagQueryStream({ question: '比较2026年九月和十月', mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text();
  assert.match(failed,/event: done/); assert.deepEqual(stages.slice(-2),['agent','answer']);
});
