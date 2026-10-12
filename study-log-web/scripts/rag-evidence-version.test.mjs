import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EvidenceRun } from '../lib/rag-evidence.ts';
import { validateRetrievedContexts, validateRangePage } from '../lib/mcp-client.ts';
import { createRagQueryStream } from '../lib/rag-query.ts';
import { KeywordRetriever } from '../../study-log-mcp/src/retrieval.mjs';
import { parseDayBlocks } from '../../study-log-mcp/src/markdown-source.mjs';
import { readLogRange } from '../../study-log-mcp/src/range-reader.mjs';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';

const date = '2026-08-04', file = '2026-08_学习日志.md';
const blocks = text => parseDayBlocks(`## ${date}\n\n### Alpha\n\n${text}`, file);
const range = data => validateRangePage(readLogRange(data, { dateFrom: date, dateTo: date })).contexts;
const search = async data => validateRetrievedContexts(await new KeywordRetriever().retrieveContexts(data, 'Alpha')).contexts;

test('section, complete and paginated reads bind the same day revision, distinct from section hashes', async () => {
  const data = blocks('Alpha先核对地址。'.repeat(3000));
  const contexts = await search(data), first = range(data);
  assert.equal(contexts[0].dayContentHash, first[0].dayContentHash);
  assert.notEqual(contexts[0].contentHash, first[0].dayContentHash);
  const page = readLogRange(data, { dateFrom: date, dateTo: date });
  const next = validateRangePage(readLogRange(data, { dateFrom: date, dateTo: date, cursor: page.coverage.nextCursor }));
  assert.equal(next.contexts[0].dayContentHash, first[0].dayContentHash);
});

test('changed source is rejected across read orders and different headings before duplicate checks', async () => {
  const before = blocks('Alpha先核对地址。'), after = blocks('Alpha不必核对地址。\n\n### 新增\n\n这不是旧版本。');
  for (const [oldItems, newItems] of [[await search(before), range(after)], [range(before), await search(after)]]) {
    const evidence = new EvidenceRun(new AbortController().signal);
    evidence.add(oldItems); const original = structuredClone(evidence.contexts);
    assert.equal(evidence.add(newItems), 0);
    assert.equal(evidence.sourceChanged, true); assert.equal(evidence.stopReason, 'source_changed');
    assert.equal(evidence.limited, true); assert.deepEqual(evidence.contexts, original);
    assert.equal(evidence.take('retrieve_contexts', 'another query'), false);
  }
});

test('optional revision metadata is validated while old MCP responses remain accepted', async () => {
  const raw = await new KeywordRetriever().retrieveContexts(blocks('Alpha先核对地址。'), 'Alpha');
  assert.equal(validateRetrievedContexts(raw).contexts[0].dayContentHash.length, 64);
  for (const invalid of [null, 12, 'short', 'z'.repeat(64)]) {
    const changed = structuredClone(raw); changed.contexts[0].dayContentHash = invalid;
    assert.throws(() => validateRetrievedContexts(changed), { code: 'MCP_INVALID_RESPONSE' });
  }
  delete raw.contexts[0].dayContentHash;
  delete raw.contexts[0].dayFullyProvided;
  assert.equal(validateRetrievedContexts(raw).contexts[0].dayContentHash, undefined);
});

test('day completeness metadata requires a boolean and a validated day version', async () => {
  const raw = await new KeywordRetriever().retrieveContexts(blocks('Alpha先核对地址。'), 'Alpha');
  assert.equal(validateRetrievedContexts(raw).contexts[0].dayFullyProvided, true);
  for (const value of [null, 1, 'true']) {
    const changed = structuredClone(raw); changed.contexts[0].dayFullyProvided = value;
    assert.throws(() => validateRetrievedContexts(changed), { code: 'MCP_INVALID_RESPONSE' });
  }
  delete raw.contexts[0].dayContentHash;
  assert.throws(() => validateRetrievedContexts(raw), { code: 'MCP_INVALID_RESPONSE' });
});

test('different merged fragments of an unchanged day do not produce a false source-change error', async () => {
  const data = blocks('needlealpha '.repeat(5) + 'x'.repeat(5000) + ' needlebeta');
  const retriever = new KeywordRetriever();
  const first = validateRetrievedContexts(await retriever.retrieveContexts(data, 'needlealpha')).contexts;
  const second = validateRetrievedContexts(await retriever.retrieveContexts(data, 'needlealpha needlebeta')).contexts;
  assert.equal(first[0].chunkId, second[0].chunkId); assert.notEqual(first[0].contentHash, second[0].contentHash);
  assert.equal(first[0].dayContentHash, second[0].dayContentHash);
  const evidence = new EvidenceRun(new AbortController().signal);
  evidence.add(first); assert.equal(evidence.add(second), 1);
  assert.equal(evidence.sourceChanged, false); assert.equal(evidence.limited, false);
  assert.ok(evidence.contexts.some(item => item.content.includes('needlebeta')));
});

test('actual query stops after source modification during Agent read, without final answer or retry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-version-'));
  const data = path.join(root, 'data'); await fs.mkdir(data);
  const log = path.join(data, file); await fs.writeFile(log, blocks('Alpha先核对地址。\n\n### 其他\n\n另一个尚未命中的小节。')[0].content);
  const service = await startHttpServer({ logRoot: data, indexRoot: path.join(root, 'index'), port: 0, token: 'synthetic', retrieval: { embedding: { apiKey: '' }, reranker: { apiKey: '' }, rerankEnabled: false } });
  const old = Object.fromEntries(['RAG_AGENT_ENABLED','RAG_AGENT_TOOL_CALLING_VERIFIED','RAG_JEV_ENABLED'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { RAG_AGENT_ENABLED: 'true', RAG_AGENT_TOOL_CALLING_VERIFIED: 'true', RAG_JEV_ENABLED: 'false' });
  let calls = 0;
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++;
    if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({needsMoreEvidence:true,answer:'需读取未提供的小节。'})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}));return;}
    assert.ok(body.tools);
    await fs.writeFile(log, blocks('Alpha不必核对地址。')[0].content);
    const frame = delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
    res.setHeader('content-type', 'text/event-stream');
    res.end(frame({ tool_calls: [{ index: 0, id: 'read', type: 'function', function: { name: 'read', arguments: JSON.stringify({date}) } }] }) + 'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await service.close();
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('rag-version-')); await fs.rm(root, { recursive: true, force: true });
  });
  const chat = { baseUrl: `http://127.0.0.1:${model.address().port}`, apiKey: 'synthetic', model: 'mock' };
  const output = await new Response(createRagQueryStream({ question: 'Alpha为什么？', mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp: { url: `http://127.0.0.1:${service.address.port}/mcp`, token: 'synthetic' } }, new AbortController().signal)).text();
  assert.equal(calls, 2); assert.match(output, /event: error/); assert.match(output, /MCP_SOURCE_CHANGED/);
  assert.ok(!output.includes('event: done')); assert.ok(!output.includes('event: delta')); assert.ok(!output.includes('event: sources'));
});
