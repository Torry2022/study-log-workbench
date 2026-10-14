import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { createRagQueryStream } from '../lib/rag-query.ts';

async function fixture(t, long = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-audit-regression-'));
  const data = path.join(root, 'data'); await fs.mkdir(data);
  await fs.writeFile(path.join(data, '2026-09_学习日志.md'), '## 2026-09-01\n\n### 学习\n\n九月合成记录。\n');
  const october = path.join(data, '2026-10_学习日志.md');
  await fs.writeFile(october, '## 2026-10-01\n\n### 学习\n\n' + (long ? '十月合成记录。'.repeat(5000) : '十月合成记录。'));
  const service = await startHttpServer({logRoot:data,indexRoot:path.join(root,'index'),port:0,token:'synthetic',
    retrieval:{embedding:{apiKey:''},reranker:{apiKey:''},rerankEnabled:false}});
  t.after(async () => { await service.close(); assert.equal(path.dirname(root),path.resolve(os.tmpdir())); await fs.rm(root,{recursive:true,force:true}); });
  const chat = {baseUrl:'http://127.0.0.1:1/synthetic-chat',apiKey:'synthetic',model:'mock',contextWindowTokens:1000000};
  return {october,config:{chat,lightChat:chat,mcp:{url:`http://127.0.0.1:${service.address.port}/mcp`,token:'synthetic'}}};
}
const events = async stream => (await new Response(stream).text()).trim().split('\n\n').map(block => ({event:block.split('\n')[0].slice(7),data:JSON.parse(block.split('\n')[1].slice(6))}));

for (const [name, laterUsage, expected] of [
  ['partial', { completion_tokens: 13 }, { inputTokens: 29, outputTokens: 13 }],
  ['empty', {}, { inputTokens: 29, outputTokens: 11 }]
]) test(`SDK query retains known usage after a ${name} frame and filtering`, { timeout: 5000 }, async t => {
  const { config } = await fixture(t), savedFetch = globalThis.fetch;
  const keys = ['RAG_AGENT_ENABLED', 'RAG_AGENT_TOOL_CALLING_VERIFIED', 'RAG_JEV_ENABLED'];
  const previous = keys.map(key => process.env[key]);
  Object.assign(process.env, { RAG_AGENT_ENABLED: 'true', RAG_AGENT_TOOL_CALLING_VERIFIED: 'true', RAG_JEV_ENABLED: 'false' });
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  let modelCalls = 0, cancelled = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) !== config.chat.baseUrl) return savedFetch(url, init);
    modelCalls++;
    assert.ok(JSON.parse(init.body).tools, 'exercise the actual SDK tool path');
    const frames = [
      { choices: [], usage: { prompt_tokens: 29, completion_tokens: 11 } },
      { choices: [], usage: laterUsage },
      { choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] }
    ];
    const bytes = new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(''));
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return new Promise(() => {});
        controller.enqueue(bytes.slice(offset, offset + 17)); offset += 17;
      },
      cancel() { cancelled = true; }
    }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const result = await events(createRagQueryStream({ question: '合成记录的条件是什么？', history: [], mode: 'logs_only' }, config, new AbortController().signal));
  assert.equal(modelCalls, 1); assert.equal(cancelled, true);
  assert.equal(result.at(-1).event, 'error');
  assert.deepEqual(result.at(-1).data.diagnostics.usage, [{ model: 'mock', ...expected }]);
  assert.deepEqual(result.at(-1).data.diagnostics.agent.usage, expected);
  assert.ok(!result.some(item => ['delta', 'sources', 'done'].includes(item.event)));
});

test('mixed month/day question reads both actual MCP scopes before answering', async t => {
  const {config}=await fixture(t), savedFetch=globalThis.fetch, calls=[]; let generations=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const body=init?.body && JSON.parse(init.body);
    if(String(url)===config.chat.baseUrl){generations++;return new Response('data: '+JSON.stringify({choices:[{delta:{content:'九月和十月记录不同[S1][S2]'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
    if(body?.method==='tools/call')calls.push(body.params);
    return savedFetch(url,init);
  });
  const result=await events(createRagQueryStream({question:'比较2026年9月和2026年10月1日的学习内容',history:[],mode:'logs_only'},config,new AbortController().signal));
  assert.equal(result.at(-1).event,'done',JSON.stringify(result)); assert.equal(generations,1);
  assert.deepEqual(calls.map(call=>[call.name,call.arguments.dateFrom,call.arguments.dateTo]),[
    ['read_log_range','2026-09-01','2026-09-30'],['read_log_range','2026-10-01','2026-10-01']]);
  assert.deepEqual(result.at(-1).data.citations.map(item=>item.date),['2026-09-01','2026-10-01']);
});

test('invalid second month rejects the question without MCP or model calls',async t=>{
  const {config}=await fixture(t); t.mock.method(globalThis,'fetch',()=>assert.fail('invalid scope must not call services'));
  const result=await events(createRagQueryStream({question:'比较2026年9月和2026年13月的学习内容',history:[],mode:'logs_only'},config,new AbortController().signal));
  assert.equal(result.at(-1).event,'done'); assert.match(result.at(-1).data.answer,/日期.*有误/);
});

test('actual MCP cursor invalidation after a completed first month stops the whole query',async t=>{
  const {config,october}=await fixture(t,true), savedFetch=globalThis.fetch, reads=[]; let generations=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const body=init?.body && JSON.parse(init.body);
    if(String(url)===config.chat.baseUrl){generations++;return new Response('data: '+JSON.stringify({choices:[{delta:{content:'不能生成的回答[S1]'}}]})+'\n\ndata: [DONE]\n\n');}
    if(body?.method==='tools/call'){
      reads.push(body.params.arguments);
      if(body.params.arguments.cursor)await fs.appendFile(october,'\n源文件已修改。');
    }
    return savedFetch(url,init);
  });
  const result=await events(createRagQueryStream({question:'比较2026年9月和2026年10月的学习内容',history:[],mode:'logs_only'},config,new AbortController().signal));
  assert.equal(reads.length,3); assert.ok(reads[2].cursor); assert.equal(generations,0);
  assert.equal(result.at(-1).event,'error'); assert.equal(result.at(-1).data.code,'MCP_SOURCE_CHANGED');
  assert.ok(!result.some(item=>['delta','sources','done'].includes(item.event)));
});

test('ordinary range failure preserves partial answering and never exposes remote error text',async t=>{
  const {config}=await fixture(t),savedFetch=globalThis.fetch;
  const previous=process.env.RAG_AGENT_ENABLED;process.env.RAG_AGENT_ENABLED='false';
  t.after(()=>{if(previous===undefined)delete process.env.RAG_AGENT_ENABLED;else process.env.RAG_AGENT_ENABLED=previous;});
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const body=init?.body && JSON.parse(init.body);
    if(String(url)===config.chat.baseUrl)return new Response('data: '+JSON.stringify({choices:[{delta:{content:'只能根据九月已读记录回答[S1]'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    if(body?.method==='tools/call' && body.params.arguments.dateFrom==='2026-10-01')return Response.json({jsonrpc:'2.0',id:body.id,result:{isError:true,content:[{type:'text',text:JSON.stringify({code:'REQUEST_FAILED',error:'synthetic-private-path'})}]}});
    return savedFetch(url,init);
  });
  const result=await events(createRagQueryStream({question:'比较2026年9月和2026年10月的学习内容',history:[],mode:'logs_only'},config,new AbortController().signal));
  assert.equal(result.at(-1).event,'done');assert.equal(result.at(-1).data.diagnostics.coverage[1].status,'failed');
  assert.equal(result.at(-1).data.citations.length,1);assert.ok(!JSON.stringify(result).includes('synthetic-private-path'));
});
