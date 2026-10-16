import test from "node:test";
import { createHash } from "node:crypto";
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
import { compactEvidence } from "../lib/rag-evidence-summary.ts";
import { agentAssessmentFixture as submitted } from './rag-model-fixture.mjs';

const config = { baseUrl: "https://example.test/custom/endpoint?version=one", apiKey: "synthetic", model: "mock-tools" };

test('a sufficient first response is delivered in one request without entering supplementary retrieval', async t => {
  const mcp=await fixture(t),savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'],previous=keys.map(key=>process.env[key]);
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  t.after(()=>keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];}));
  let requests=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url)!==config.baseUrl)return savedFetch(url,init);
    requests++;
    const body=JSON.parse(init.body);
    assert.deepEqual(body.tools.map(item=>item.function.name).sort(),['read_more','reply','search']);
    return stream('reply',{answer:'Alpha条件成立才适用[S1]。',evidence:[{point:'适用条件',sourceId:'S1',quote:'Alpha条件成立才适用'}]});
  });
  const raw=await new Response(createRagQueryStream({question:'Alpha有哪些适用条件？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
  assert.match(raw,/event: done/,raw);assert.doesNotMatch(raw,/内部文本/);assert.equal(requests,1);
  const done=JSON.parse(raw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.equal(done.diagnostics.agent.entered,false);assert.equal(done.diagnostics.toolCalls,1);
  assert.equal(done.citations.length,1);assert.equal(done.diagnostics.usage.length,1);
});

test('direct reply rejects extra fields, malformed anchors and invented sources before delivery', async t => {
  for(const override of [{unresolved:[]},{evidence:[{point:'',sourceId:'S1',quote:'条件'}]},{evidence:[{point:'条件',sourceId:'S99',quote:'条件'}]}]){
    const run=new EvidenceRun(new AbortController().signal);
    let calls=0;
    run.add([{date:'2026-09-01',fileName:'synthetic.md',chunkId:'one',contentHash:'hash',content:'合成条件。'}]);
    await assert.rejects(supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{calls++;return stream('reply',{
      answer:'合成条件[S1]。',evidence:[{point:'条件',sourceId:'S1',quote:'合成条件'}],...override
    });}),()=>{}),error=>error.code==='AGENT_ANSWER_INVALID');
    assert.equal(calls,1);
  }
});

test('entry phase cannot submit the post-read assessment contract', async () => {
  const run=new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName:'synthetic.md',chunkId:'one',contentHash:'hash',content:'合成条件。',truncated:true}]);
  let calls=0;
  await assert.rejects(supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async(_url,init)=>{
    calls++;const body=JSON.parse(init.body);
    assert.ok(!body.tools.some(item=>item.function.name==='assess'));
    return stream('assess',{assessment:'合成条件[S1]。',evidence:[{point:'条件',sourceId:'S1',quote:'合成条件'}],unresolved:[],next:'finish'});
  }),()=>{}),error=>error.code==='AGENT_ANSWER_INVALID');
  assert.equal(calls,1);assert.equal(run.calls,0);
});

test("known context windows use the UTF-8 byte upper bound without dividing capacity twice", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { assert.fail("evidence that fits the known window must not be compacted"); };
  const content = "汉".repeat(35_000);
  const run = new EvidenceRun(new AbortController().signal);
  run.contexts = [{ sourceId: "S1", date: "2026-09-01", fileName: "2026-09_学习日志.md", heading: null,
    headingIndex: null, chunkId: "2026-09-01:range:0", contentHash: "a".repeat(64), content, truncated: false, score: 1 }];
  const known = { ...config, contextWindowTokens: 220_000 };
  await compactEvidence(run, "总结这一天", known, known);
  assert.equal(run.contexts[0].content, content);
  assert.equal(run.compactedSources.size, 0);
  assert.equal(run.limited, false);
});

test("Agent activation uses explicit provider-neutral capability confirmation", () => {
  assert.equal(agentEnabled({}), false);
  assert.equal(agentEnabled({ RAG_AGENT_TOOL_CALLING_VERIFIED: "true" }), true);
  assert.equal(agentEnabled({ RAG_AGENT_ENABLED: "invalid", RAG_AGENT_TOOL_CALLING_VERIFIED: "true" }), false);
  assert.equal(agentEnabled({ RAG_AGENT_ENABLED: "false", RAG_AGENT_TOOL_CALLING_VERIFIED: "true" }), false);
  assert.equal(agentEnabled({ RAG_AGENT_ENABLED: "true", RAG_AGENT_TOOL_CALLING_VERIFIED: "true" }), true);
  assert.equal(agentEnabled({ RAG_AGENT_ENABLED: "true", RAG_AGENT_TOOL_CALLING_VERIFIED: "false" }), false);
});

test('Agent outcomes distinguish a checked direct reply from budget completion', async () => {
  const run = new EvidenceRun(new AbortController().signal);
  const answered = await supplementEvidence('合成主题是什么？', { strategy: 'relevance' }, run, {},
    createAgentModel(config, async () => submitted('本次未找到能回答这个问题的记录。')), () => {}, undefined, { mode: 'logs_only', history: [] });
  assert.equal(answered.kind, 'answered');
  assert.equal(answered.stopReason, 'direct_answer');
  assert.equal(answered.entered, false);
  assert.deepEqual(run.coverage, []);
  assert.equal(run.limited, false);

  const exhausted = new EvidenceRun(new AbortController().signal); exhausted.calls = 8;
  const pending = await supplementEvidence('合成主题是什么？', { strategy: 'relevance' }, exhausted, {},
    createAgentModel(config, async () => assert.fail('no model after budget exhaustion')), () => {}, undefined, { mode: 'logs_only', history: [] });
  assert.equal(pending.kind, 'needs_answer');
  assert.equal(pending.stopReason, 'tool_budget');
  assert.equal(pending.assessment, undefined);
  assert.equal(exhausted.limited, true);
});

test("a capability-confirmed compatible model reaches the bounded Agent loop", async t => {
  const mcp = await fixture(t), savedFetch = globalThis.fetch;
  const keys = ["RAG_AGENT_ENABLED", "RAG_AGENT_TOOL_CALLING_VERIFIED", "RAG_JEV_ENABLED"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { RAG_AGENT_ENABLED: "true", RAG_AGENT_TOOL_CALLING_VERIFIED: "true", RAG_JEV_ENABLED: "false" });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const chat = { baseUrl: "https://provider.example/chat/completions", apiKey: "synthetic", model: "compatible-tools" };
  let modelCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url) !== chat.baseUrl) return savedFetch(url, init);
    const body = JSON.parse(init.body); modelCalls++;
    if (body.tools) assert.ok(body.tools.some(item => item.function.name === "search"));
    return body.tools ? submitted("Alpha条件成立才适用，不适用于所有场景。[S1]", body) : plain("Alpha条件成立才适用，不适用于所有场景。[S1]");
  });
  const raw = await new Response(createRagQueryStream({ question: "Alpha的条件是什么？", mode: "logs_only", history: [] }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text();
  assert.match(raw, /event: done/, raw);
  const done = JSON.parse(raw.trim().split("\n\n").at(-1).split("\n")[1].slice(6));
  assert.equal(modelCalls, 1); assert.equal(done.diagnostics.agent.enabled, true);
  assert.equal(done.diagnostics.agent.entered, false);
  assert.match(done.answer, /Alpha条件成立/);
});

test('inherited follow-up scope constrains actual MCP reads throughout the SDK loop', async t => {
  const mcp = await fixture(t), savedFetch = globalThis.fetch, calls = [];
  const keys = ['RAG_AGENT_ENABLED', 'RAG_AGENT_TOOL_CALLING_VERIFIED', 'RAG_JEV_ENABLED'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { RAG_AGENT_ENABLED: 'true', RAG_AGENT_TOOL_CALLING_VERIFIED: 'true', RAG_JEV_ENABLED: 'false' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (String(url) !== config.baseUrl) { if (body?.method === 'tools/call') calls.push(body.params.arguments); return savedFetch(url, init); }
    if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ query: 'Alpha的条件是什么？', scopeSource: 0, strategy: 'relevance' }) }, finish_reason: 'stop' }] }));
    if (body.tools) {
      assert.ok(body.messages.at(-1).content.includes('"dateFrom":"2026-09-01"'));
      return stream('search', { query: '2026年10月 Alpha' });
    }
    return plain('Alpha条件成立才适用[S1]。');
  });
  const raw = await new Response(createRagQueryStream({ question: '它的条件是什么？', history: [{ role: 'user', content: '只看2026年9月的记录，Alpha是什么？' }], mode: 'logs_only' }, { chat: config, lightChat: config, mcp }, new AbortController().signal)).text();
  const blocks = raw.trim().split('\n\n'), last = JSON.parse(blocks.at(-1).split('\n')[1].slice(6));
  assert.match(blocks.at(-1), /^event: done/);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every(args => args.dateFrom === '2026-09-01' && args.dateTo === '2026-09-30'));
  assert.ok(last.citations.every(source => source.date.startsWith('2026-09')));
});

test('an enabled Agent without current tool confirmation uses ordinary RAG against actual MCP', async t => {
  const mcp=await fixture(t), previousFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{globalThis.fetch=previousFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'false',RAG_JEV_ENABLED:'false'});
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==config.baseUrl)return previousFetch(url,init);
    calls++;const body=JSON.parse(init.body);assert.equal(body.tools,undefined);
    assert.ok(body.messages.at(-1).content.includes('Alpha条件成立才适用'));
    return plain('Alpha条件成立才适用，不适用于所有场景。[S1]');
  };
  const raw=await new Response(createRagQueryStream({question:'Alpha的适用条件是什么？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
  const last=raw.trim().split('\n\n').at(-1);assert.match(last,/^event: done/);
  const result=JSON.parse(last.split('\n')[1].slice(6));
  assert.equal(calls,1);assert.equal(result.diagnostics.agent,undefined);
  assert.equal(result.citations[0].date,'2026-09-01');assert.match(result.answer,/不适用于所有场景/);
});

function plain(text, finish = 'stop') {
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}

test('a submitted known evidence gap reads its registered source before accepting an answer', async t => {
  const tail='合成条件：只有核对来源并确认后才能继续，未确认不得继续。';
  const mcp=await fixture(t,`## 2026-09-01\n\n### Alpha\n${'过程背景。'.repeat(3200)}\n\n${tail}`);
  const run=new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha条件是什么？',{strategy:'relevance'},run,mcp);
  assert.ok(!run.contexts.some(item=>item.content.includes(tail)));
  let calls=0;
  const model=createAgentModel(config,async(_url,init)=>{
    const body=JSON.parse(init.body);
    if(++calls===1)return stream('read_more',{assessment:'仅有背景，尚缺条件[S1]',evidence:[],unresolved:[{point:'所问条件',sourceId:'S1'}]});
    assert.ok(body.messages.at(-1).content.includes(tail));
    return submitted(`${tail}[S2]`,body);
  });
  const result=await supplementEvidence('Alpha条件是什么？',{strategy:'relevance'},run,mcp,model,()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(calls,2);assert.equal(run.calls,2);assert.equal(result.kind,'assessed');
  assert.equal(result.assessment,`${tail}[S2]`);assert.equal(run.stopReason,'evidence_assessed');
});

test('answer submissions cannot introduce unknown sources or quotes absent from fully provided evidence', async () => {
  for(const evidence of [[{point:'条件',sourceId:'S999',quote:'伪造原文'}],[{point:'条件',sourceId:'S1',quote:'伪造原文'}]]){
    const run=new EvidenceRun(new AbortController().signal);
    const content='已有完整条件：未确认不得继续。';
    run.add([{sourceId:'S1',date:'2026-09-01',fileName:'2026-09_学习日志.md',chunkId:'2026-09-01:range:0',heading:null,headingIndex:null,
      contentHash:(await import('node:crypto')).createHash('sha256').update(content).digest('hex'),content,truncated:false}]);
    run.requests.add(JSON.stringify(['read_log_range',{dateFrom:'2026-09-01',dateTo:'2026-09-01'}]));
    let calls=0;
    const model=createAgentModel(config,async()=>{calls++;return stream('reply',{answer:'伪造条件[S1]',evidence});});
    await assert.rejects(supplementEvidence('条件？',{strategy:'relevance'},run,{},model,()=>{}),{code:'AGENT_ANSWER_INVALID'});
    assert.equal(calls,1);assert.equal(run.calls,0);
  }
});

test('every submitted reply quote must match its own registered source', async () => {
  const run=new EvidenceRun(new AbortController().signal);
  run.add([
    {date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',headingIndex:0,chunkId:'alpha',content:'Alpha条件成立才适用。',contentHash:'a'.repeat(64),truncated:true},
    {date:'2026-09-02',fileName:'2026-09_学习日志.md',heading:'Beta',headingIndex:0,chunkId:'beta',content:'Beta需要先确认权限。',contentHash:'b'.repeat(64),truncated:true}
  ]);
  const evidence=[
    {point:'Alpha条件',sourceId:'S1',quote:'Alpha条件成立才适用。'},
    {point:'Beta条件',sourceId:'S2',quote:'Beta无需确认权限。'}
  ];
  await assert.rejects(()=>supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>stream('reply',{answer:'两项都有条件[S1][S2]。',evidence})),()=>{}),{code:'AGENT_ANSWER_INVALID'});
  assert.equal(run.calls,0);
});

test('plain text stop is discarded and falls back to the ordinary checked answer path', async()=>{
  let calls=0;
  const run=new EvidenceRun(new AbortController().signal);
  const result=await supplementEvidence('条件？',{strategy:'relevance'},run,{},
    createAgentModel(config,async()=>{calls++;return plain('不能直接发布的未受检正文。');}),()=>{});
  assert.equal(calls,1);
  assert.equal(result.kind,'needs_answer');assert.equal(result.entered,false);
  assert.equal(run.stopReason,'unstructured_answer');
});

test('actual query replaces an unstructured Agent response with the ordinary answer stream',async t=>{
  const mcp=await fixture(t),savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  t.after(()=>{globalThis.fetch=savedFetch;for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==config.baseUrl)return savedFetch(url,init);
    calls++;const body=JSON.parse(init.body);
    return body.tools?plain('不能发布的未受检正文。'):plain('Alpha条件成立才适用，不适用于所有场景。[S1]');
  };
  const raw=await new Response(createRagQueryStream({question:'Alpha的适用条件是什么？',history:[],mode:'logs_only'},
    {chat:config,lightChat:config,mcp},new AbortController().signal)).text();
  const block=raw.trim().split('\n\n').at(-1),result=JSON.parse(block.split('\n')[1].slice(6));
  assert.match(block,/^event: done/);assert.equal(calls,2);assert.ok(!raw.includes('不能发布的未受检正文'));
  assert.match(result.answer,/Alpha条件成立才适用/);assert.equal(result.diagnostics.agent.entered,false);
  assert.equal(result.diagnostics.agent.stopReason,'unstructured_answer');
});

test('SDK filtered answers retain received usage in query error diagnostics',async t=>{
  const mcp=await fixture(t),savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  t.after(()=>{for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  t.mock.method(globalThis,'fetch',async(url,init)=>String(url)!==config.baseUrl?savedFetch(url,init):
    new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'内部回答'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'content_filter'}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
  const raw=await new Response(createRagQueryStream({question:'Alpha的条件是什么？',history:[],mode:'logs_only'},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
  const last=raw.trim().split('\n\n').at(-1),result=JSON.parse(last.split('\n')[1].slice(6));
  assert.match(last,/^event: error/);assert.equal(result.code,'AI_STREAM_INTERRUPTED');assert.ok(!raw.includes('event: done'));
  assert.deepEqual(result.diagnostics.usage,[{model:config.model,inputTokens:123,outputTokens:45}]);
  assert.equal(result.diagnostics.agent.usage.inputTokens,123);assert.equal(result.diagnostics.agent.usage.outputTokens,45);
});

test('SDK multi-step failure sums calls once and leaves missing token fields unknown',async t=>{
  const mcp=await fixture(t,`## 2026-09-01\n\n### Alpha\n${'Alpha过程。'.repeat(2200)}\n\nBeta的条件是明确确认。`),savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  t.after(()=>{for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(String(url)!==config.baseUrl)return savedFetch(url,init);
    if(++calls===1)return gap('S1');
    const usageFrame='data: '+JSON.stringify({choices:[],usage:{prompt_tokens:123}})+'\n\n';
    return new Response(usageFrame+usageFrame+'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'content_filter'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  const raw=await new Response(createRagQueryStream({question:'Alpha的条件是什么？',history:[],mode:'logs_only'},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
  const result=JSON.parse(raw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.equal(calls,2);assert.equal(result.code,'AI_STREAM_INTERRUPTED');
  assert.deepEqual(result.diagnostics.usage,[{model:config.model,inputTokens:10,outputTokens:5},{model:config.model,inputTokens:123,outputTokens:null}]);
  assert.deepEqual(result.diagnostics.agent.usage,{inputTokens:133,outputTokens:null});
});

test('SDK usage observer retains a frame before provider failure, filtering or cancellation without waiting for a tail',{timeout:2000},async()=>{
  for(const mode of ['failure','filter','cancel']){
    const abort=new AbortController(),seen=new Map();let pulls=0,cancelled=false;
    const provider=new ReadableStream({pull(controller){
      if(++pulls===1)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:'片段'},finish_reason:mode==='filter'?'content_filter':null}],usage:{prompt_tokens:7,completion_tokens:3}})+'\n\n'));
      else if(mode==='failure')controller.error(new Error('synthetic failure'));
      else return new Promise(()=>{});
    },cancel(){cancelled=true;}});
    const model=createAgentModel(config,async()=>new Response(provider,{headers:{'content-type':'text/event-stream'}}),(call,usage)=>{seen.set(call,usage);if(mode==='cancel'&&usage.inputTokens!==null)abort.abort();});
    const run=new EvidenceRun(abort.signal);
    await assert.rejects(supplementEvidence('条件是什么？',{strategy:'relevance'},run,{url:'http://127.0.0.1:1/mcp',token:'synthetic'},model,()=>{}));
    assert.deepEqual([...seen.values()],[{inputTokens:7,outputTokens:3}]);
    if(mode!=='failure')assert.equal(cancelled,true);
  }
});

test('query timing separates initial MCP retrieval from delayed SDK answers and failed decisions',async t=>{
  const mcp=await fixture(t),savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{globalThis.fetch=savedFetch;for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  for(const path of ['ordinary','agent_direct','agent_failure']) {
    Object.assign(process.env,{RAG_AGENT_ENABLED:path==='ordinary'?'false':'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
    let calls=0,modelElapsed=0;
    globalThis.fetch=async(url,init)=>{
      if(String(url)!==config.baseUrl)return savedFetch(url,init);
      calls++;const body=JSON.parse(init.body);assert.equal(Boolean(body.tools),path!=='ordinary'&&calls===1);
      const start=performance.now();await new Promise(resolve=>setTimeout(resolve,150));modelElapsed+=performance.now()-start;
      return path==='agent_failure'?Response.json({error:'synthetic unavailable'},{status:503}):body.tools?submitted('Alpha条件成立才适用。[S1]',body):plain('Alpha条件成立才适用。[S1]');
    };
    const raw=await new Response(createRagQueryStream({question:'Alpha的适用条件是什么？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
    const block=raw.trim().split('\n\n').at(-1),result=JSON.parse(block.split('\n')[1].slice(6)),timing=result.diagnostics.timings;
    assert.equal(calls,1);assert.ok(modelElapsed>=140);
    assert.equal(timing.judgeMs,0);
    if(path==='ordinary') {
      assert.match(block,/^event: done/);assert.equal(timing.agentMs,0);
      assert.ok(timing.generationMs>=modelElapsed-5);assert.equal(result.diagnostics.agent,undefined);
    } else {
      assert.ok(timing.agentMs>=modelElapsed-5);
      if(path==='agent_direct')assert.equal(timing.generationMs,0);
      assert.ok(timing.retrievalMs+timing.agentMs+timing.compactionMs<=timing.totalMs+10,'phase timing must not charge SDK time to retrieval twice');
      if(path==='agent_failure') {
        assert.match(block,/^event: error/);assert.equal(result.diagnostics.failureStage,'retrieving');assert.equal(timing.firstTokenMs,null);
        assert.deepEqual(result.diagnostics.usage,[{model:config.model,inputTokens:null,outputTokens:null}]);
        assert.deepEqual(result.diagnostics.agent.usage,{inputTokens:null,outputTokens:null});
      }
      else {assert.match(block,/^event: done/);assert.equal(result.diagnostics.agent.assessed,false);assert.equal(result.diagnostics.agent.entered,false);assert.ok(timing.firstTokenMs>=timing.agentMs-5);}
    }
  }
});
function stream(tool, args, id = "one") {
  if (tool === "assess") args = { next: args.unresolved?.length ? "read" : "finish", ...args };
  if (tool === "read_more") { const { next: _next, ...rest } = args; args = rest; }
  if (["search", "read"].includes(tool)) args = { ...args, missingPoint: "合成问题中缺少的具体条件" };
  const chunk = delta => `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "mock-tools", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "内部文本，不可送给用户。" }) + (tool ? chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }) : "") +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}
function gap(sourceId, point = "合成问题中缺少的具体条件", id = "gap") {
  return stream('read_more', { assessment: '本次未找到能回答这个问题的记录。', evidence: [], unresolved: [{ point, sourceId }] }, id);
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
  const nextState = JSON.parse(requests[1].messages.at(-1).content.split('可用工具状态：').at(-1));
  assert.ok(nextState.previousReads.length > 0);
  assert.ok(Array.isArray(nextState.previousReads[0]));
  assert.equal(nextState.remainingDecisions, 1);
  assert.deepEqual(nextState.availableReadDates, []);
  assert.deepEqual(nextState.readCandidates, []);
  assert.deepEqual(nextState.previousEvidenceRequests, [{ name: "search", query: "Alpha", missingPoint: "合成问题中缺少的具体条件", addedSourceIds: ["S1"] }]);
  assert.equal(nextState.lastTool, undefined);
  assert.ok(requests[1].messages.at(-1).content.includes('Alpha条件成立才适用'));
  assert.ok(!requests[1].messages.at(-1).content.includes('本来源正文有截断'));
  assert.ok(!requests[1].messages.some(message => message.role === "tool"));
  assert.ok(run.contexts.every(item => item.date === "2026-09-01"));
});

test('ordinary facts reply directly, literal lookup bypasses tools, and no leads stay unproven', async t => {
  const mcp = await fixture(t), old = {};
  for (const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED']) old[key] = process.env[key];
  Object.assign(process.env, { RAG_AGENT_ENABLED:'true', RAG_AGENT_TOOL_CALLING_VERIFIED:'true', RAG_JEV_ENABLED:'false' });
  const calls = []; let finishReason = 'sufficient_evidence';
  const server = http.createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw+=chunk;
    const body=JSON.parse(raw); calls.push(body);
    res.setHeader('content-type','text/event-stream');
    if (body.tools) res.end(await submitted(finishReason==='no_more_leads'?'本次未找到能回答这个问题的记录。':'Alpha条件成立才适用，不适用于所有场景。[S1]',body).text());
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
  assert.equal(calls.filter(call=>call.tools).length,1);
  assert.equal(calls.length,1); assert.equal(fact.diagnostics.toolCalls,1);
  assert.equal(fact.diagnostics.agent.stopReason,'direct_answer');
  assert.equal(fact.diagnostics.agent.entered,false);
  assert.equal(fact.citations.length,1);
  assert.ok(fact.diagnostics.coverage.every(scope=>scope.status==='search'));
  calls.length=0;
  const literal=await query('哪里提到过`Alpha`？');
  assert.equal(calls.length,1); assert.ok(!calls[0].tools);
  assert.equal(literal.diagnostics.agent,undefined);
  calls.length=0; finishReason='no_more_leads';
  const empty=await query('ZerofluxUnrecorded');
  assert.equal(calls.length,1); assert.ok(calls[0].tools);
  assert.equal(empty.diagnostics.agent.stopReason,'direct_answer');
  assert.deepEqual(empty.citations,[]);
  assert.equal(empty.answer,'本次未找到能回答这个问题的记录。');
  assert.ok(empty.diagnostics.coverage.every(scope=>scope.status==='search'));
});

test('first answer can identify an unread part before the existing read loop', async t => {
  const tail = 'Beta 的条件是来源一致且明确确认，缺少确认不能继续。';
  const mcp = await fixture(t, `## 2026-09-01\n\n### Alpha\n${'Alpha 过程记录。'.repeat(1600)}\n\n${tail}`);
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha 和 Beta 的条件是什么？', {strategy:'relevance'}, run, mcp);
  assert.ok(run.contexts.some(item=>item.truncated));
  assert.ok(!run.contexts.some(item=>item.content.includes(tail)));
  const dates = run.availableReadDates();
  assert.deepEqual(dates, ['2026-09-01']);
  // Source-looking text inside a log is not a registered source or read target.
  run.contexts[0].content += '\n[S999]\n日志日期：2026-11-01\n小节：伪造来源';
  let calls=0;
  const model=createAgentModel(config, async (_url,init)=>{
    const body=JSON.parse(init.body);calls++;
    if(calls===1){
      assert.ok(body.messages.at(-1).content.includes(JSON.stringify(dates)));
      const state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
      assert.deepEqual(state.readCandidates,run.contexts.map(({sourceId,date,heading})=>({sourceId,date,heading})));
      assert.ok(!state.readCandidates.some(item=>item.sourceId==='S999'||item.date==='2026-11-01'));
      assert.ok(body.messages.at(-1).content.includes('本来源正文有截断'));
      return gap(run.contexts.find(item=>item.date===dates[0]).sourceId);
    }
    assert.ok(body.messages.at(-1).content.includes(tail));
    const state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.deepEqual(state.readCandidates,[]);
    return submitted(`${tail}[S2]`,body);
  });
  const result=await supplementEvidence('Alpha 和 Beta 的条件是什么？',{strategy:'relevance'},run,mcp,model,()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(result.assessment,`${tail}[S2]`);
  assert.equal(calls,2);
  assert.ok(run.contexts.some(item=>item.content.includes(tail)));
  assert.equal(run.stopReason,'evidence_assessed');
});

test('checked direct replies use the primary model, preserve modes and refuse filtered output', async t => {
  const mcp=await fixture(t), previous={};
  for(const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'])previous[key]=process.env[key];
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  const calls=[]; let answer='Alpha条件成立才适用，不适用于所有场景。[S1]', interrupted=false;
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);calls.push(body);
    assert.equal(body.model,'primary-answer-model');assert.equal(body.temperature,body.tools?0:0.2);
    assert.ok(body.messages.some(message=>message.role==='system' && message.content.includes('来源编号')));
    res.setHeader('content-type','text/event-stream');res.end(await (interrupted?plain(answer,'content_filter'):body.tools?submitted(answer,body):plain(answer)).text());
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
    assert.equal(calls.length,1);assert.ok(calls[0].tools);assert.equal(done.answer,answer);assert.equal(done.citations[0].date,'2026-09-01');
    assert.match(raw,/event: delta/);assert.ok(!raw.includes('内部文本'));assert.ok(!JSON.stringify(done.diagnostics).includes(answer));
    assert.ok(calls[0].messages.at(-1).content.includes('Alpha条件成立才适用'));
    if(mode==='logs_and_general')assert.ok(calls[0].messages[0].content.includes('通用知识补充'));
  }
  interrupted=true;
  const raw=await new Response(createRagQueryStream({question:'Alpha的适用条件是什么？',mode:'logs_only',history:[]},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
  assert.match(raw,/event: error/);assert.ok(!raw.includes('event: delta'));assert.ok(!raw.includes(answer));
});

test('internal decision length stops tools and answers from retained evidence; filtering still fails', async t => {
  const mcp = await fixture(t), previous = {};
  for (const key of ['RAG_AGENT_ENABLED', 'RAG_AGENT_TOOL_CALLING_VERIFIED', 'RAG_JEV_ENABLED']) { previous[key] = process.env[key]; process.env[key] = key === 'RAG_JEV_ENABLED' ? 'false' : 'true'; }
  let finish = 'length'; const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw); calls.push(body);
    res.setHeader('content-type', 'text/event-stream');
    if (body.tools) {
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: '内部思考不可发布', content: '内部草稿不可发布' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 1200, total_tokens: 1210 } })}\n\ndata: [DONE]\n\n`);
    } else {
      assert.ok(body.messages.some(message => message.content.includes('模型未完整结束补查决策')));
      assert.ok(body.messages.some(message => message.content.includes('本轮材料不完整或取证受限')));
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '仅依据本次已读记录，Alpha条件成立才适用。[S1]' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const chat = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic', model: 'mock' };
  const query = () => new Response(createRagQueryStream({ question: 'Alpha的适用条件？', mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text();
  const output = await query(), done = JSON.parse(output.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.match(output, /event: done/); assert.equal(calls.length, 2);
  assert.equal(done.diagnostics.agent.stopReason, 'decision_output_limit');
  assert.equal(done.diagnostics.toolCalls, 1); assert.equal(done.citations[0].date, '2026-09-01');
  assert.ok(!output.includes('内部思考') && !output.includes('内部草稿'));
  finish = 'content_filter'; calls.length = 0;
  const filtered = await query(); assert.match(filtered, /event: error/); assert.equal(calls.length, 1);
  assert.ok(!filtered.includes('event: delta'));
});

test('a finish answer after a search cannot bypass separate final generation', async t=>{
  const mcp=await fixture(t),run=new EvidenceRun(new AbortController().signal);let steps=0;
  const result=await supplementEvidence('Alpha的条件？',{strategy:'relevance'},run,mcp,createAgentModel(config,async(_url,init)=>++steps===1?stream('search',{query:'Alpha'}):stream('finish',{reason:'sufficient_evidence',assessment:'工具中的回答不可发布[S1]'})),()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(steps,2);assert.equal(result.assessment,undefined);assert.equal(run.stopReason,'tool_failure');assert.equal(run.calls,1);
});

test('oversized direct answers and provider errors fail without tool calls or retries', async () => {
  let calls=0;const run=new EvidenceRun(new AbortController().signal);
  await assert.rejects(supplementEvidence('question',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{calls++;return plain('x'.repeat(40001));}),()=>{},undefined,{mode:'logs_only',history:[]}),{code:'AGENT_DECISION_INVALID'});
  assert.equal(calls,1);assert.equal(run.calls,0);
  for(const status of [401,429,500]){
    let requests=0;const failed=new EvidenceRun(new AbortController().signal);
    await assert.rejects(supplementEvidence('question',{strategy:'relevance'},failed,{},createAgentModel(config,async()=>{requests++;return Response.json({error:{message:'synthetic private provider detail'}},{status});}),()=>{},undefined,{mode:'logs_only',history:[]}),error=>error.code==='AGENT_PROVIDER_FAILED'&&!error.message.includes('private'));
    assert.equal(requests,1);assert.equal(failed.calls,0);
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
    {index:0,id:'search',type:'function',function:{name:'search',arguments:JSON.stringify({query:'Alpha',missingPoint:'合成缺失条件'})}},
    {index:1,id:'finish',type:'function',function:{name:'finish',arguments:JSON.stringify({reason:'sufficient_evidence',assessment:'不应交付[S1]'})}}
  ]},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  const result=await supplementEvidence('Alpha条件？',{strategy:'relevance'},run,mcp,createAgentModel(config,async(_url,init)=>response()),()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(result.assessment,undefined);
});
test("invalid tool args and nonexistent tools cannot execute reads", async t => {
  const mcp = await fixture(t);
  for (const [name, args] of [["search", { query: 123 }], ["delete", { date: "2026-09-01" }]]) {
    const run = new EvidenceRun(new AbortController().signal);
    await supplementEvidence("question", { strategy: "relevance" }, run, mcp, createAgentModel(config, async () => stream(name, args)), () => {});
    assert.equal(run.calls, 0); assert.equal(run.limited, true);
  }
});

test('search parameters and removed direct reads cannot bypass the bounded gap contract', async t => {
  const mcp = await fixture(t, '## 2026-09-01\n\n### Alpha\n' + 'Alpha背景。'.repeat(1000));
  for (const name of ['search', 'read']) for (const missingPoint of [undefined, '  ', 'x'.repeat(161)]) {
    const run = new EvidenceRun(new AbortController().signal);
    if (name === 'read') {
      await collectRagEvidence('Alpha', { strategy: 'relevance' }, run, mcp);
      assert.deepEqual(run.availableReadDates(), ['2026-09-01']);
    }
    const before = run.calls, args = { ...(name === 'search' ? { query: 'Alpha' } : { date: '2026-09-01' }), ...(missingPoint === undefined ? {} : { missingPoint }) };
    let calls = 0;
    const model = createAgentModel(config, async () => {
      calls++;
      return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'invalid-gap',type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    });
    const result = await supplementEvidence('Alpha的条件？', { strategy: 'relevance' }, run, mcp, model, () => {}, undefined, { mode: 'logs_only', history: [] });
    assert.equal(calls, 1); assert.equal(run.calls, before); assert.equal(result.assessment, undefined);
    assert.equal(run.stopReason, 'tool_failure'); assert.equal(run.limited, true);
  }
});

test('removed finish cannot authorize an answer or another model step alongside a valid search', async t => {
  const mcp=await fixture(t);
  for(const order of [['search','finish'],['finish','search']]){
    const run=new EvidenceRun(new AbortController().signal);let decisions=0;
    const model=createAgentModel(config,async()=>{
      decisions++;
      if(decisions>1)return stream('search',{query:'UnrecordedTopic'});
      const tool_calls=order.map((name,index)=>({index,id:`batch-${index}`,type:'function',function:{name,arguments:JSON.stringify(name==='search'?{query:'Alpha',missingPoint:'合成缺失条件'}:{reason:'sufficient_evidence'})}}));
      return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    });
    const result = await supplementEvidence('Alpha的条件是什么？',{strategy:'relevance'},run,mcp,model,()=>{});
    assert.equal(decisions,1);
    assert.equal(run.stopReason,'tool_failure');
    assert.equal(result.kind,'needs_answer');
    assert.equal(result.assessment,undefined);
    // SDK validation may reject the bad group before the valid search starts.
    // If it started, only that bounded read-only search may have executed.
    assert.ok(run.calls <= 1);
    assert.equal(run.contexts.length,run.calls);
    assert.ok([...run.requests].every(request => {
      const [name, args] = JSON.parse(request);
      return name === 'retrieve_contexts' && args.input === 'Alpha';
    }));
  }
});

test('an empty concurrent search cannot claim sources added by another search', async t => {
  const mcp=await fixture(t),original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    if(typeof init?.body==='string' && init.body.includes('UnrecordedTopic'))await new Promise(resolve=>setTimeout(resolve,80));
    return original(input,init);
  };
  t.after(()=>{globalThis.fetch=original;});
  const run=new EvidenceRun(new AbortController().signal);let decisions=0;
  const model=createAgentModel(config,async(_url,init)=>{
    decisions++;
    if(decisions>1){
      const body=JSON.parse(init.body),state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
      assert.deepEqual(state.previousEvidenceRequests,[
        {name:'search',query:'Alpha',missingPoint:'合成缺失条件',addedSourceIds:['S1']},
        {name:'search',query:'UnrecordedTopic',missingPoint:'合成缺失条件',addedSourceIds:[]}
      ]);
      assert.ok(!body.messages.some(message=>message.role==='tool'));
      return submitted('Alpha条件成立才适用。[S1]',body);
    }
    const tool_calls=['Alpha','UnrecordedTopic'].map((query,index)=>({index,id:`lookup-${index}`,type:'function',function:{name:'search',arguments:JSON.stringify({query,missingPoint:"合成缺失条件"})}}));
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  await supplementEvidence('Alpha的条件是什么？',{strategy:'relevance'},run,mcp,model,()=>{});
  // Alpha added evidence in this group, so the empty sibling cannot stop it.
  assert.equal(decisions,2);assert.equal(run.calls,2);assert.equal(run.contexts.length,1);
  assert.equal(run.stopReason,'evidence_assessed');
  const shared=new EvidenceRun(new AbortController().signal);
  const [hit,empty]=await Promise.all([
    collectRagEvidence('Alpha',{strategy:'relevance'},shared,mcp),
    collectRagEvidence('UnrecordedTopic',{strategy:'relevance'},shared,mcp)
  ]);
  assert.deepEqual(hit,['S1']);assert.deepEqual(empty,[]);
});

test('multiple missing points on one registered day share a single read without cutting off the next answer',async t=>{
  const tail='Alpha的条件是明确确认，未确认不得写入。';
  const mcp=await fixture(t,`## 2026-09-01\n\n### Alpha\n${'Alpha背景。'.repeat(2400)}\n\n${tail}`);
  const run=new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha的条件是什么？',{strategy:'relevance'},run,mcp);
  assert.deepEqual(run.availableReadDates(),['2026-09-01']);
  assert.ok(!run.contexts.some(item=>item.content.includes(tail)));
  const initialLimited=run.limited;
  let decisions=0;
  const model=createAgentModel(config,async(_url,init)=>{
    decisions++;const body=JSON.parse(init.body);
    if(decisions===1){
      const tool_calls=[{index:0,id:'shared-day-gap',type:'function',function:{name:'read_more',arguments:JSON.stringify({assessment:'已有背景，条件尚缺。',evidence:[],unresolved:['确认条件','不能写入的情形'].map(point=>({point,sourceId:'S1'}))})}}];
      return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }
    assert.ok(body.messages.at(-1).content.includes(tail));
    const state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.deepEqual(state.availableReadDates,[]);
    assert.deepEqual(state.previousEvidenceRequests,[{name:'read',
      gaps:['确认条件','不能写入的情形'].map(point=>({point,sourceId:'S1'})),attemptedDates:['2026-09-01'],addedSourceIds:['S2']}]);
    return submitted(`${tail}[S2]`,body);
  });
  const result=await supplementEvidence('Alpha的条件是什么？',{strategy:'relevance'},run,mcp,model,()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(decisions,2);assert.equal(run.calls,2);
  assert.equal(run.stopReason,'evidence_assessed');assert.equal(run.limited,initialLimited);
  assert.match(result.assessment,/未确认不得写入/);
  assert.equal(run.coverage.at(-1).status,'complete');
});

test('a parallel search with no new material cannot stop another search from following its new rule lead',async t=>{
  const savedFetch=globalThis.fetch,keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{globalThis.fetch=savedFetch;for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  for(const order of [['Gamma','UnrecordedTopic'],['UnrecordedTopic','Gamma']]){
    const mcp=await fixture(t,'## 2026-09-01\n\n### Alpha\nAlpha应遵循Gamma细则，旧别名为UnrecordedTopic。\n\n## 2026-09-02\n\n### Gamma\nGamma指向Beta规则。\n\n## 2026-09-03\n\n### Beta\nBeta必须核对地址，未确认不得写入。');
    let calls=0;
    globalThis.fetch=async(url,init)=>{
      if(String(url)!==config.baseUrl)return savedFetch(url,init);
      const body=JSON.parse(init.body),provided=body.messages.at(-1).content;calls++;
      if(body.tools&&calls===1){
        assert.ok(provided.includes('Alpha应遵循Gamma'));assert.ok(!provided.includes('Gamma指向Beta规则'));
        const tool_calls=order.map((query,index)=>({index,id:`parallel-${index}`,type:'function',function:{name:'search',arguments:JSON.stringify({query,missingPoint:'查明Alpha所指细则或旧别名对应的内容'})}}));
        return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
      }
      if(body.tools){assert.equal(calls,2);assert.ok(provided.includes('Gamma指向Beta规则'));return stream('search',{query:'Beta'},'beta-rule');}
      if(calls<3)return plain('仅找到规则名称，尚未提供Beta的具体要求。[S1]');
      assert.ok(provided.includes('Beta必须核对地址，未确认不得写入'));
      return plain('Alpha应遵循Gamma细则[S1]；Gamma指向Beta规则[S2]。Beta必须核对地址，未确认不得写入[S3]。');
    };
    const raw=await new Response(createRagQueryStream({question:'Alpha怎么推进？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
    const terminal=raw.trim().split('\n\n').at(-1);assert.match(terminal,/^event: done/);
    const result=JSON.parse(terminal.split('\n')[1].slice(6));
    assert.equal(calls,3);assert.equal(result.diagnostics.toolCalls,4);assert.equal(result.diagnostics.agent.stopReason,'step_limit');
    assert.deepEqual(result.citations.map(source=>source.date),['2026-09-01','2026-09-02','2026-09-03']);
    assert.match(result.answer,/未确认不得写入/);
  }
});

test('an exhausted read budget skips SDK decisions, but still generates a bounded answer after actual range reads',async t=>{
  const mcp=await fixture(t,'## 2026-09-01\n\n### Alpha\n'+'合成背景材料。'.repeat(45000));
  const savedFetch=globalThis.fetch,keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{globalThis.fetch=savedFetch;for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  let decisions=0,answers=0,extractions=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==config.baseUrl)return savedFetch(url,init);
    const body=JSON.parse(init.body);
    if(!body.stream){extractions++;const {evidence}=JSON.parse(body.messages[1].content);return Response.json({choices:[{message:{content:JSON.stringify(evidence.map(item=>({sourceId:item.sourceId,excerpts:[item.content.slice(0,80)]})))}}]});}
    if(body.tools?.some(item=>item.function.name==='record_material')){
      extractions++;const input=JSON.parse(body.messages.at(-1).content),part=input.parts[0];
      return stream('record_material',{assessment:'仅根据已读取片段归纳',notes:[{sourceId:part.sourceId,quote:part.text.slice(0,60)}],drop:[],nextBatch:null});
    }
    if(body.tools){decisions++;return stream('search',{query:'UnrecordedTopic'});}
    answers++;assert.ok(body.messages[0].content.includes('工具调用次数达到上限'));
    return plain('已提供Alpha记录片段，所选范围未完整读取，不作完整总结。[S1]');
  };
  const raw=await new Response(createRagQueryStream({question:'总结2026年9月',mode:'logs_only',history:[]},{chat:{...config,contextWindowTokens:128000},lightChat:config,mcp},new AbortController().signal)).text();
  const terminal=raw.trim().split('\n\n').at(-1);assert.match(terminal,/^event: done/);
  const result=JSON.parse(terminal.split('\n')[1].slice(6));
  assert.equal(decisions,0);assert.equal(answers,1);assert.equal(extractions,4);assert.equal(result.diagnostics.agent.entered,true);
  assert.equal(result.diagnostics.toolCalls,8);assert.equal(result.diagnostics.agent.stopReason,'tool_budget');
  assert.equal(result.diagnostics.coverage[0].status,'partial');assert.equal(result.citations[0].date,'2026-09-01');
  assert.match(result.answer,/未完整读取/);
});

test('SDK continues after same-identity restoration and answers from the body returned by actual MCP',async t=>{
  const mcp=await fixture(t),run=new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha',{strategy:'relevance'},run,mcp);
  assert.equal(run.contexts.length,1);
  const original=structuredClone(run.contexts[0]);
  run.compactionOriginals.set('S1',original.content);run.compactedSources.add('S1');run.contexts[0].content=original.content.slice(0,6);
  let calls=0;
  const model=createAgentModel(config,async(_url,init)=>{
    const body=JSON.parse(init.body);calls++;
    if(calls===1){assert.ok(!body.messages.at(-1).content.includes('Alpha条件成立才适用'));return stream('search',{query:'Alpha条件'});}
    const state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.deepEqual(state.previousEvidenceRequests,[{name:'search',query:'Alpha条件',missingPoint:'合成问题中缺少的具体条件',addedSourceIds:['S1']}]);
    assert.ok(body.messages.at(-1).content.includes(original.content));
    return submitted('Alpha条件成立才适用，不适用于所有场景。[S1]',body);
  });
  const result=await supplementEvidence('Alpha的完整适用条件？',{strategy:'relevance'},run,mcp,model,()=>{},config,{mode:'logs_only',history:[],chat:config});
  assert.equal(calls,2);assert.equal(run.calls,2);assert.equal(run.contexts.length,1);
  assert.deepEqual(run.contexts[0],original);assert.equal(run.compactedSources.has('S1'),false);
  assert.match(result.assessment,/条件成立才适用，不适用于所有场景/);assert.equal(run.stopReason,'evidence_assessed');
});

test('a removed direct-read call stops before another decision or unregistered date access', async t => {
  const mcp=await fixture(t,'## 2026-09-01\n\n### Alpha\nAlpha补充条件记在正文末。\n'+ '合成背景。'.repeat(8000)+'\n只有来源一致才能保存。');
  const savedFetch=globalThis.fetch, keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{globalThis.fetch=savedFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  let modelCalls=0,decisions=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==config.baseUrl)return savedFetch(url,init);
    modelCalls++;const body=JSON.parse(init.body);
    if(body.tools){
      decisions++;assert.ok(!body.tools.some(item=>item.function.name==='read'));
      const state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
      assert.deepEqual(state.availableReadDates,['2026-09-01']);
      return stream('read',{date:'2026-11-01'},`invalid-date-${decisions}`);
    }
    assert.ok(body.messages.at(-1).content.includes('Alpha补充条件'));
    assert.ok(body.messages[0].content.includes('本轮材料不完整或取证受限'));
    assert.ok(!body.messages[0].content.includes('truncatedSources'));
    return plain('目前只提供了Alpha的片段，补查没有完成。[S1]');
  };
  const raw=await new Response(createRagQueryStream({question:'2026-09-01的Alpha补充条件是什么？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
  const last=raw.trim().split('\n\n').at(-1);assert.match(last,/^event: done/);
  const result=JSON.parse(last.split('\n')[1].slice(6));
  assert.equal(decisions,1);assert.equal(modelCalls,2);
  assert.equal(result.diagnostics.agent.stopReason,'tool_failure');
  assert.equal(result.diagnostics.toolCalls,1);assert.equal(result.citations[0].date,'2026-09-01');
  assert.ok(!raw.includes('内部文本'));
});

test('a provider selecting an unavailable read cannot execute a duplicate MCP request', async t => {
  const mcp = await fixture(t), run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence('Alpha', { strategy:'timeline_summary',dateFrom:'2026-09-01',dateTo:'2026-09-01' },run,mcp);
  assert.equal(run.calls,1);
  const before=[...run.requests]; let decisions=0;
  await supplementEvidence('Alpha的条件？',{strategy:'relevance'},run,mcp,createAgentModel(config,async (_url,init)=>{
    const body=JSON.parse(init.body), state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.deepEqual(state.availableReadDates,[]);
    assert.ok(!body.tools.some(item=>item.function.name==='read'));
    decisions++;
    return stream('read',{date:'2026-09-01'});
  }),()=>{});
  assert.ok(decisions>0 && decisions<=2);
  assert.equal(run.calls,1); assert.deepEqual([...run.requests],before);
});
test("empty tool-free output requests final generation without claiming coverage", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  const result = await supplementEvidence("question", { strategy: "relevance" }, run, {}, createAgentModel(config, async (_url, init) => {
    assert.equal(JSON.parse(init.body).tool_choice, 'auto'); return plain('  ');
  }), () => {});
  assert.equal(result.kind, 'needs_answer'); assert.equal(result.assessment, undefined); assert.equal(run.limited, true); assert.equal(run.stopReason, 'empty_answer');
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
  assert.ok(events.filter(item => item.event === "sources").every(item => item.data.citations.length <= 160));
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
  assert.equal(events.at(-1).event, "done"); assert.equal(events.at(-1).data.citations.length, 31); assert.equal(events.at(-1).data.citations[30].date, "2026-10-31");
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

test('removed finish is rejected without reads, an answer or program-proven coverage', async () => {
  for (const reason of ['sufficient_evidence','no_more_leads']) {
    let calls=0;const run=new EvidenceRun(new AbortController().signal);
    const result = await supplementEvidence('question',{strategy:'relevance'},run,{},createAgentModel(config,async (_url,init)=>{
      const body=JSON.parse(init.body);assert.equal(body.tool_choice,'auto');assert.equal(body.max_tokens,undefined);
      assert.ok(!body.tools.some(item => item.function.name === 'finish')); calls++;return stream('finish',{reason});
    }),()=>{});
    assert.equal(calls,1);assert.equal(run.calls,0);assert.equal(run.stopReason,'tool_failure');
    assert.equal(result.kind,'needs_answer');assert.equal(result.assessment,undefined);
    assert.deepEqual(run.coverage,[]);
  }
});

test('complete comparisons bypass Agent and Jev while search-only questions retain the judge fallback', async t => {
 const mcp=await fixture(t),originalFetch=globalThis.fetch,old={};
 for(const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED','RAG_JEV_PROVIDER','TYPESAFE_API_KEY'])old[key]=process.env[key];
 Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'true',RAG_JEV_PROVIDER:'typesafe',TYPESAFE_API_KEY:'synthetic'});
 let judgeCalls=0, agentCalls=0;
 globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.typesafe.ai')){judgeCalls++;await new Promise(resolve=>setTimeout(resolve,120));return Response.json({error:'synthetic unavailable'},{status:503});}return originalFetch(url,init);};
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);
  res.setHeader('content-type','text/event-stream');
  if(body.tools){agentCalls++;res.end(await submitted('合成比较[S1]',body).text());}
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
  assert.ok(shortDone.diagnostics.timings.judgeMs>=110);assert.ok(shortDone.diagnostics.timings.retrievalMs+shortDone.diagnostics.timings.judgeMs+shortDone.diagnostics.timings.agentMs<=shortDone.diagnostics.timings.totalMs+10);
  assert.equal(shortDone.diagnostics.agent.judgeSkipped,undefined);assert.equal(shortDone.answer,'合成比较[S1]');
  assert.equal(agentCalls,1);
 }finally {
  server.closeAllConnections();await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;
  for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('complete long-range query processes batches separately from raw evidence; failed material processing cannot publish an answer', async t => {
  const mcp = await fixture(t, '## 2026-09-01\n\n### Alpha\n' + 'background'.repeat(3300) + '\n末尾约束：没有确认不能保存。');
  const oldAgent = process.env.RAG_AGENT_ENABLED, oldVerified = process.env.RAG_AGENT_TOOL_CALLING_VERIFIED;
  process.env.RAG_AGENT_ENABLED = 'true'; process.env.RAG_AGENT_TOOL_CALLING_VERIFIED = 'true';
  t.after(() => { for (const [name, value] of [['RAG_AGENT_ENABLED', oldAgent], ['RAG_AGENT_TOOL_CALLING_VERIFIED', oldVerified]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const stages = []; let failSummary = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw);
    if (body.tools) {
      stages.push('material');
      await new Promise(resolve=>setTimeout(resolve,120));
      if(failSummary){res.writeHead(503);res.end('synthetic unavailable');return;}
      assert.ok(body.tools.some(item=>item.function.name==='record_material'));
      const input=JSON.parse(body.messages.at(-1).content);
      const notes=input.parts.map(part=>({sourceId:part.sourceId,quote:part.text.slice(-60)}));
      res.setHeader('content-type','text/event-stream');
      res.end(await stream('record_material',{assessment:'逐批核对所选范围的条件',notes,drop:[],nextBatch:null}).text());
    } else {
      stages.push('delivery');
      if (!failSummary) assert.match(body.messages.at(-1).content, /没有确认不能保存/);
      res.setHeader('content-type', 'text/event-stream');
      res.end('data: '+JSON.stringify({ choices: [{ delta: { content: '需要确认[S2]。' } }] })+'\n\ndata: [DONE]\n\n');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const chat = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic', model: 'mock', contextWindowTokens:128000 };
  const output = await new Response(createRagQueryStream({ question: '比较2026年九月和十月', mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text();
  assert.match(output, /event: done/);
  assert.equal(stages[0], 'material');
  assert.ok(!stages.includes('agent')); assert.equal(stages.at(-1), 'delivery');
  const done=JSON.parse(output.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.equal(done.diagnostics.agent.entered,true);assert.ok(done.diagnostics.usage.length>=2);
  assert.ok(done.diagnostics.timings.compactionMs>=110);assert.equal(done.diagnostics.timings.agentMs,0);
  failSummary=true; stages.length=0;
  const failed=await new Response(createRagQueryStream({ question: '比较2026年九月和十月', mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text();
  assert.match(failed,/event: error/);assert.doesNotMatch(failed,/event: done/);
  assert.deepEqual(stages,['material']);
  const failure=JSON.parse(failed.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.equal(failure.code,'AGENT_MATERIAL_INVALID');assert.ok(failure.diagnostics.timings.compactionMs>=110);
});

test('SDK assesses in the second step after a real read, discarding internal tool text', async t => {
  const mcp=await fixture(t), requests=[];
  const run=new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',headingIndex:0,chunkId:'initial-fragment',contentHash:'a'.repeat(64),content:'Alpha背景。',truncated:true}]);
  const model=createAgentModel(config,async(_url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);
    if(requests.length===1)return gap('S1');
    assert.deepEqual(body.tools.map(item=>item.function.name).sort(),['assess','search']);
    assert.ok(body.messages.at(-1).content.includes('Alpha条件成立才适用，不适用于所有场景'));
    assert.ok(body.messages.at(-1).content.includes('"remainingDecisions":1'));
    const state=JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.deepEqual(state.coverage.truncatedSources,['S1']);
    assert.equal(state.coverage.scopes.at(-1).lastReadDate,'2026-09-01');
    assert.equal(state.coverage.scopes.at(-1).status,'complete');
    assert.deepEqual(state.availableReadDates,[]);
    assert.ok(!body.tools.some(item=>item.function.name==='finish'));
    assert.ok(!body.messages.some(item=>String(item.content).includes('内部文本，不可送给用户')));
    return submitted('Alpha条件成立才适用，不适用于所有场景。[S2]',body);
  });
  const result=await supplementEvidence('Alpha具体条件？',{strategy:'relevance'},run,mcp,model,()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(requests.length,2);assert.equal(run.calls,1);
  assert.equal(result.assessment,'Alpha条件成立才适用，不适用于所有场景。[S2]');
  assert.equal(run.stopReason,'evidence_assessed');assert.equal(result.usage.inputTokens,20);
  assert.ok(run.contexts.some(item=>item.sourceId==='S2'&&item.chunkId==='2026-09-01:range:0'));
});

test('query delivers from the same canonical evidence view used by SDK assessment', async t => {
  const tail='Beta的条件是来源一致且明确确认，缺少确认不能继续。';
  const mcp=await fixture(t,`## 2026-09-01\n\n### Alpha\nAlpha的基本说明。\n\n### Beta\n${tail}\n\n### 其他资料\n${'其他背景资料。'.repeat(2200)}`);
  const previous={};for(const key of ['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'])previous[key]=process.env[key];
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
    res.setHeader('content-type','text/event-stream');
    if(requests.length===1)res.end(await gap('S1').text());
    else if(!body.tools){assert.ok(!body.messages.at(-1).content.includes('[S1]\n日志日期'),'A superseded excerpt must not reappear at delivery');const full=body.messages.at(-1).content.split('\n\n---\n\n').find(part=>part.includes('\n内容：\n## 2026-09-01'));const id=full.match(/\[(S\d+)\]/)[1];res.end(await plain(`${tail}[${id}]`).text());}
    else {
      assert.ok(body.messages.at(-1).content.includes(tail));
      const full=body.messages.at(-1).content.split('\n\n---\n\n').find(part=>part.includes('\n内容：\n## 2026-09-01'));
      const source=full.match(/\[(S\d+)\]/)[1];
      res.end(await submitted(`${tail}[${source}]`,body).text());
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const chat={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic',model:'mock'};
  const raw=await new Response(createRagQueryStream({question:'Alpha和Beta的条件是什么？',history:[],mode:'logs_only'},{chat,lightChat:chat,mcp},new AbortController().signal)).text();
  const events=raw.trim().split('\n\n').map(block=>({event:block.split('\n')[0].slice(7),data:JSON.parse(block.split('\n')[1].slice(6))}));
  assert.equal(requests.length,3);assert.equal(requests[2].tools,undefined);assert.equal(events.at(-1).event,'done');assert.ok(!raw.includes('内部文本'));
  assert.ok(events.at(-1).data.answer.includes(tail));assert.equal(events.at(-1).data.citations.length,1);assert.equal(events.at(-1).data.citations[0].chunkId,'2026-09-01:range:0');
  assert.equal(events.at(-1).data.citations[0].sourceId,'S1');
});

test('second-turn length, filtering and oversized answers retain completion guards', async t => {
  const mcp=await fixture(t);
  for(const finish of ['length','content-filter','oversized']) {
    const run=new EvidenceRun(new AbortController().signal);
    run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',chunkId:'initial',contentHash:'a'.repeat(64),content:'Alpha背景',truncated:true}]);
    let calls=0;
    const model=createAgentModel(config,async()=>++calls===1?gap('S1'):plain(finish==='oversized'?'x'.repeat(40001):'未完成正文',finish==='oversized'?'stop':finish==='content-filter'?'content_filter':finish));
    const invoke=()=>supplementEvidence('Alpha条件？',{strategy:'relevance'},run,mcp,model,()=>{},undefined,{mode:'logs_only',history:[]});
    if(finish==='length'){const result=await invoke();assert.equal(result.assessment,undefined);assert.equal(run.limited,true);assert.equal(run.stopReason,'decision_output_limit');}
    else await assert.rejects(invoke(),error=>error.code===(finish==='oversized'?'AGENT_DECISION_INVALID':'AI_STREAM_INTERRUPTED'));
    assert.equal(calls,2);
  }
});


test('a checked assessment binds a replaced excerpt to the supplied same-version whole day without another model call', async () => {
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const content='## 2026-09-01\n\n### Alpha\n\n背景。完整条件：只有确认后才能继续。';
  const dayContentHash=hash(content),fileName='2026-09_学习日志.md';
  const run=new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName,heading:'Alpha',headingIndex:0,chunkId:'excerpt',content:'背景。',contentHash:hash('背景。'),dayContentHash,truncated:true}]);
  run.add([{date:'2026-09-01',fileName,heading:null,headingIndex:null,chunkId:'2026-09-01:range:0',content,contentHash:dayContentHash,dayContentHash,truncated:false}]);
  run.materialCalls=1;
  let calls=0;
  const model=createAgentModel(config,async(_url,init)=>{
    calls++;const body=JSON.parse(init.body);
    assert.ok(!body.messages.at(-1).content.includes('[S1]\n日志日期'));
    return stream('assess',{assessment:'只有确认后才能继续。[s1]；代码示例`[S1]`',evidence:[{point:'适用条件',sourceId:'S1',quote:'只有确认后才能继续。'},{point:'完整条件',sourceId:'S1',quote:'完整条件：只有确认后才能继续。'}],unresolved:[]});
  });
  const result=await supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},model,()=>{},undefined,{mode:'logs_only',history:[]});
  assert.equal(calls,1);assert.equal(run.calls,0);
  assert.equal(result.assessment,'只有确认后才能继续。[S2]；代码示例`[S1]`');
  run.contexts[1].dayContentHash=undefined;
  run.requests.add(JSON.stringify(["read_log_range",{dateFrom:"2026-09-01",dateTo:"2026-09-01"}]));
  await assert.rejects(()=>supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>stream('assess',{assessment:'未确认也能继续[S1]',evidence:[{point:'条件',sourceId:'S1',quote:'未确认也能继续'}],unresolved:[]})),()=>{},undefined,{mode:'logs_only',history:[]}),{code:'AGENT_ANSWER_INVALID'});
});


test('an answer submitted beside a search cannot publish before that search is reflected in the next step', async t => {
  const mcp=await fixture(t);
  for(const order of [['reply','search'],['search','reply']]) {
    const run=new EvidenceRun(new AbortController().signal);
    run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',headingIndex:0,chunkId:'initial',content:'背景。',contentHash:'a'.repeat(64),truncated:true}]);
    let calls=0;
    const model=createAgentModel(config,async(_url,init)=>{
      const body=JSON.parse(init.body);
      if(++calls>1)return submitted('Alpha条件成立才适用[S2]',body);
      const args={reply:{answer:'不能发布的旧答复[S1]',evidence:[{point:'背景',sourceId:'S1',quote:'背景。'}]},search:{query:'Alpha',missingPoint:'具体适用条件'}};
      const tool_calls=order.map((name,index)=>({index,id:`group-${index}`,type:'function',function:{name,arguments:JSON.stringify(args[name])}}));
      return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    });
    const result=await supplementEvidence('Alpha条件？',{strategy:'relevance'},run,mcp,model,()=>{},undefined,{mode:'logs_only',history:[]});
    assert.equal(calls,2);assert.equal(result.assessment,'Alpha条件成立才适用[S2]');
    assert.equal(run.stopReason,'evidence_assessed');
  }
});


test('missing-point submissions cannot name unregistered sources or malformed gap identities', async () => {
  for (const unresolved of [[{point:'条件',sourceId:null}],[{point:'条件',sourceId:'S99'}],[{point:'条件',sourceId:'2026-09-01'}],[{point:' ',sourceId:'S1'}],[{point:'x'.repeat(501),sourceId:'S1'}],[{point:'条件',sourceId:'S1',date:'2026-11-01'}]]) {
    const run=new EvidenceRun(new AbortController().signal);
    run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',headingIndex:0,chunkId:'fragment',content:'背景',contentHash:'a'.repeat(64),truncated:true}]);
    let calls=0;
    await assert.rejects(()=>supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{calls++;return stream('read_more',{assessment:'尚缺条件。',evidence:[],unresolved});}),()=>{}),{code:'AGENT_ANSWER_INVALID'});
    assert.equal(calls,1);assert.equal(run.calls,0);
  }
});


test('every submitted assessment quote must match its own registered source', async () => {
  const run=new EvidenceRun(new AbortController().signal);
  run.add([
    {date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'对象身份',headingIndex:0,chunkId:'alpha',content:'对象由稳定编号标识。',contentHash:'a'.repeat(64),truncated:true},
    {date:'2026-09-02',fileName:'2026-09_学习日志.md',heading:'操作权限',headingIndex:0,chunkId:'beta',content:'修改前需要确认权限。',contentHash:'b'.repeat(64),truncated:true}
  ]);
  run.materialCalls=1;
  let calls=0;
  const response={assessment:'对象由稳定编号标识[S1]。修改前需要确认权限[S2]。',evidence:[{point:'身份',sourceId:'S1',quote:'对象由稳定编号标识。'},{point:'权限',sourceId:'S2',quote:'权限需要在修改前确认'}],unresolved:[]};
  const model=createAgentModel(config,async()=>{calls++;return stream('assess',response);});
  await assert.rejects(()=>supplementEvidence('如何识别对象并控制修改？',{strategy:'relevance'},run,{},model,()=>{}),{code:'AGENT_ANSWER_INVALID'});
  assert.equal(calls,1);assert.equal(run.calls,0);
  response.evidence[1].quote='修改前需要确认权限。';
  const result=await supplementEvidence('如何识别对象并控制修改？',{strategy:'relevance'},run,{},model,()=>{});
  assert.equal(result.assessment,response.assessment);assert.equal(calls,2);assert.equal(run.calls,0);
  response.assessment+='额外结论[S99]。';
  await assert.rejects(()=>supplementEvidence('同一问题',{strategy:'relevance'},run,{},model,()=>{}),{code:'AGENT_ANSWER_INVALID'});
  assert.equal(run.calls,0);
});

test('a malformed quote cannot independently authorize a read of a known partial source', async () => {
  const run=new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',headingIndex:0,chunkId:'fragment',content:'部分原文。',contentHash:'a'.repeat(64),truncated:true}]);
  await assert.rejects(()=>supplementEvidence('条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>stream('read_more',{assessment:'伪造条件[S1]',evidence:[{point:'条件',sourceId:'S1',quote:'未提供的原文'}],unresolved:[{point:'具体条件',sourceId:'S1'}]})),()=>{}),{code:'AGENT_ANSWER_INVALID'});
  assert.equal(run.calls,0,'Only an explicit known-source gap can request a read');
});


test('literal source headings and dates can anchor answers about the supplied record metadata', async () => {
  for (const quote of ['条目标题','2026-09-01']) {
    const run=new EvidenceRun(new AbortController().signal);
    run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'条目标题',headingIndex:0,chunkId:'fragment',content:'正文。',contentHash:'a'.repeat(64),truncated:true}]);
    const result=await supplementEvidence('有没有这个标题的记录？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>stream('reply',{answer:'有，2026-09-01 的条目标题[S1]。',evidence:[{point:'记录身份',sourceId:'S1',quote}]})),()=>{});
    assert.equal(result.kind,'answered');assert.equal(run.calls,0);
  }
});


test('assessment protocol retains substantive synthesis without accepting a final-answer field', async () => {
  const run = new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',chunkId:'fragment',content:'只有确认后才能继续。',contentHash:'a'.repeat(64),truncated:true}]);
  run.materialCalls=1;
  const model=createAgentModel(config,async(_url,init)=>{
    const body=JSON.parse(init.body), schema=body.tools.find(tool=>tool.function.name==='assess')?.function.parameters;
    assert.ok(schema, 'The SDK must expose a material assessment, not a final-answer tool');
    assert.ok(schema.required.includes('assessment'));
    assert.equal(schema.properties.answer,undefined);
    return stream('assess',{assessment:'已有原文明确限定执行条件为先确认[S1]，因此不是任意情况下都可继续。',evidence:[{point:'执行条件',sourceId:'S1',quote:'只有确认后才能继续。'}],unresolved:[]});
  });
  const result=await supplementEvidence('什么情况下可以继续？',{strategy:'relevance'},run,{},model,()=>{});
  assert.equal(result.kind,'assessed');
  assert.match(result.assessment,/限定执行条件/);
  assert.equal(result.answer,undefined);
  assert.equal(run.calls,0);
});

test('query streams final delivery after a real read without exposing assessment text', async t => {
  const mcp=await fixture(t,`## 2026-09-01\n\n### Alpha\n${'Alpha背景。'.repeat(2200)}\n\nAlpha条件成立才适用。`), savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  let finishFinal, calls=0, finalCompleted=false;
  const finalGate=new Promise(resolve=>{finishFinal=resolve;});
  t.after(()=>{finishFinal();globalThis.fetch=savedFetch;for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  globalThis.fetch=async(url,init)=>{
    if(String(url)!==config.baseUrl)return savedFetch(url,init);
    calls++;const body=JSON.parse(init.body);
    if(body.tools){
      const names=new Set(body.tools.map(item=>item.function.name));
      if(names.has('read_more'))return gap('S1');
      return stream('assess',{assessment:'内部取证结论：Alpha具有明确适用边界[S2]。',evidence:[{point:'适用边界',sourceId:'S2',quote:'Alpha条件成立才适用'}],unresolved:[]});
    }
    assert.ok(body.messages.some(item=>item.content.includes('内部取证结论')));
    const encoder=new TextEncoder();
    return new Response(new ReadableStream({async start(controller){
      controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'Alpha仅在条件成立时适用[S1]。'}}]})+'\n\n'));
      await finalGate;finalCompleted=true;
      controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'并不适用于所有场景。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();
    }}),{headers:{'content-type':'text/event-stream'}});
  };
  const reader=createRagQueryStream({question:'Alpha的条件是什么？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal).getReader();
  let raw='';const decoder=new TextDecoder();
  const timeout=setTimeout(()=>finishFinal(),5000);t.after(()=>clearTimeout(timeout));
  while(!raw.includes('event: delta')){const part=await reader.read();assert.equal(part.done,false);raw+=decoder.decode(part.value);}
  assert.equal(calls,3);assert.equal(finalCompleted,false,'The first delta must arrive while final generation is still blocked');assert.ok(!raw.includes('内部取证结论'));assert.ok(!raw.includes('event: done'));
  finishFinal();for(;;){const part=await reader.read();if(part.done)break;raw+=decoder.decode(part.value);}
  assert.match(raw,/event: done/);assert.match(raw,/并不适用于所有场景/);
  assert.ok(!raw.includes('内部取证结论'));assert.ok(!raw.includes('内部文本'));
});


test('unanswered points are not read authorizations unless the assessment explicitly requests a read', async t => {
  const mcp=await fixture(t);
  for(const next of ['finish','read']){
    const run=new EvidenceRun(new AbortController().signal);
    run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',chunkId:'fragment',content:'Alpha条件成立才适用。',contentHash:'a'.repeat(64),truncated:true}]);
    run.materialCalls=1;
    let calls=0;
    const model=createAgentModel(config,async(_url,init)=>{
      const body=JSON.parse(init.body);calls++;
      if(calls>1)return submitted('Alpha条件成立才适用[S2]。',body);
      return stream('assess',{assessment:'已有材料说明了明确的适用条件[S1]。',evidence:[{point:'适用条件',sourceId:'S1',quote:'Alpha条件成立才适用。'}],unresolved:[{point:'未提供的更多背景',sourceId:'S1'}],next});
    });
    const result=await supplementEvidence('Alpha的条件是什么？',{strategy:'relevance'},run,mcp,model,()=>{});
    assert.equal(run.calls,next==='read'?1:0);
    assert.equal(calls,next==='read'?2:1);
    assert.equal(result.kind,'assessed');
    if(next==='finish')assert.deepEqual(result.unresolved,[{point:'未提供的更多背景',sourceId:'S1'}]);
  }
});


test('source metadata anchors accept exactly the rendered heading and date, not invented metadata', async () => {
  for(const quote of ['小节：条目标题','日志日期：2026-09-01','小节：其他标题','日志日期：2026-09-02']){
    const run=new EvidenceRun(new AbortController().signal);
    run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'条目标题',headingIndex:0,chunkId:'fragment',content:'正文。',contentHash:'a'.repeat(64),truncated:true}]);
    let calls=0;
    const execute=()=>supplementEvidence('是否有相应主题？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{calls++;return stream('reply',{answer:'已存在该主题的独立记录[S1]。',evidence:[{point:'记录身份',sourceId:'S1',quote}]});}),()=>{});
    if(['小节：条目标题','日志日期：2026-09-01'].includes(quote))assert.equal((await execute()).kind,'answered');
    else await assert.rejects(execute(),{code:'AGENT_ANSWER_INVALID'});
    assert.equal(calls,1);assert.equal(run.calls,0);
  }
});


test('delivery failure after a post-read assessment cannot publish the assessment or send done', async t => {
  const mcp=await fixture(t,`## 2026-09-01\n\n### Alpha\n${'Alpha背景。'.repeat(2200)}\n\nAlpha条件成立才适用。`), savedFetch=globalThis.fetch;
  const keys=['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{RAG_AGENT_ENABLED:'true',RAG_AGENT_TOOL_CALLING_VERIFIED:'true',RAG_JEV_ENABLED:'false'});
  t.after(()=>{globalThis.fetch=savedFetch;for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  for(const failure of ['content_filter','length','authentication']){
    let calls=0;
    globalThis.fetch=async(url,init)=>{
      if(String(url)!==config.baseUrl)return savedFetch(url,init);
      calls++;const body=JSON.parse(init.body);
      if(body.tools){
        const names=new Set(body.tools.map(item=>item.function.name));
        if(names.has('read_more'))return gap('S1');
        return submitted('内部材料判断：Alpha条件成立才适用[S2]。',body);
      }
      return failure==='authentication'?Response.json({error:'synthetic denied'},{status:401}):plain('未完整交付的正文',failure);
    };
    const raw=await new Response(createRagQueryStream({question:'Alpha的条件是什么？',mode:'logs_only',history:[]},{chat:config,lightChat:config,mcp},new AbortController().signal)).text();
    assert.equal(calls,3);assert.match(raw,/event: error/);assert.ok(!raw.includes('event: done'));assert.ok(!raw.includes('内部材料判断'));
    const last=JSON.parse(raw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
    assert.equal(last.diagnostics.failureStage,'answering');assert.equal(last.diagnostics.agent.assessed,true);
  }
});


test('a known but exhausted read target retains the assessment and gap for bounded delivery', async () => {
  const run=new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:'Alpha',chunkId:'whole',content:'已提供的说明。',contentHash:'a'.repeat(64),truncated:false}]);
  run.materialCalls=1;
  run.requests.add(JSON.stringify(['read_log_range',{dateFrom:'2026-09-01',dateTo:'2026-09-01'}]));
  let calls=0;
  const result=await supplementEvidence('其他条件是什么？',{strategy:'relevance'},run,{},createAgentModel(config,async()=>{
    calls++;return stream('assess',{assessment:'现有说明只支持已经介绍的部分[S1]。',evidence:[{point:'已知内容',sourceId:'S1',quote:'已提供的说明。'}],unresolved:[{point:'未记载的其他条件',sourceId:'S1'}],next:'read'});
  }),()=>{});
  assert.equal(calls,1);assert.equal(run.calls,0);assert.equal(result.kind,'assessed');assert.equal(result.stopReason,'no_new_evidence');
  assert.deepEqual(result.unresolved,[{point:'未记载的其他条件',sourceId:'S1'}]);assert.equal(run.limited,false);
});

test('assessment context is counted before selecting final-generation evidence', async t => {
  const savedFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=savedFetch;});
  const content='汉'.repeat(25000), extra='内部判断'.repeat(4000);
  const makeRun=()=>{const run=new EvidenceRun(new AbortController().signal);run.contexts=[{sourceId:'S1',date:'2026-09-01',fileName:'2026-09_学习日志.md',heading:null,chunkId:'whole',contentHash:'a'.repeat(64),content,truncated:false}];return run;};
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify([{sourceId:'S1',excerpts:['汉'.repeat(10)]}])},finish_reason:'stop'}]});};
  const chat={...config,contextWindowTokens:220000};
  const baseline=makeRun();await compactEvidence(baseline,'概括内容',chat,chat);assert.equal(calls,0);
  const bounded=makeRun();await compactEvidence(bounded,'概括内容',chat,chat,[],'logs_only',[],extra);
  assert.equal(calls,1);assert.equal(bounded.contexts[0].content,'汉'.repeat(10));assert.equal(bounded.compactedSources.has('S1'),true);
});
