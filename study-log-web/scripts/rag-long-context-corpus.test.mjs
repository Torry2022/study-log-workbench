import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { EvidenceRun, collectRagEvidence } from '../lib/rag-evidence.ts';
import { createRagQueryStream } from '../lib/rag-query.ts';
import { longContextCorpus, longContextQuestion, linkedRules } from './rag-long-context-corpus.mjs';

test('three phrasings reach the same bounded tool loop and supply the linked rule through actual MCP', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-long-corpus-'));
  let service, model;
  const previous = Object.fromEntries(['RAG_AGENT_ENABLED', 'RAG_AGENT_TOOL_CALLING_VERIFIED', 'RAG_JEV_ENABLED'].map(key => [key, process.env[key]]));
  try {
    const data = path.join(root, 'data'); await fs.mkdir(data);
    await fs.writeFile(path.join(data, '2026-09_学习日志.md'), longContextCorpus());
    service = await startHttpServer({ logRoot: data, indexRoot: path.join(root, 'index'), port: 0, token: 'synthetic', retrieval: { embedding: { apiKey: '' }, reranker: { apiKey: '' }, rerankEnabled: false } });
    const config = { url: `http://127.0.0.1:${service.address.port}/mcp`, token: 'synthetic' };
    const run = new EvidenceRun(new AbortController().signal);
    await collectRagEvidence(longContextQuestion, { strategy: 'relevance' }, run, config);
    assert.ok(run.contexts.some(item => item.date === '2026-09-01'));
    assert.ok(!run.contexts.some(item => item.content.includes('河图检查规则')));
    await collectRagEvidence(longContextQuestion, { strategy: 'timeline_summary', dateFrom: '2026-09-01', dateTo: '2026-09-01' }, run, config);
    assert.ok(run.contexts.some(item => item.content.includes('河图检查规则')));
    assert.ok(run.contexts.reduce((sum, item) => sum + item.content.length, 0) > 30000);
    await collectRagEvidence('河图检查规则', { strategy: 'relevance' }, run, config);
    assert.ok(run.contexts.some(item => item.date === '2026-09-18' && item.content.includes(linkedRules)));
    assert.ok(run.calls <= 8);
    let steps = 0, summaries = 0;
    model = http.createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body.stream) {
        if(body.messages[0].content.includes('needsMoreEvidence')){
          response.setHeader('content-type','application/json');
          response.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({needsMoreEvidence:true,answer:'需读取北辰明确指向的规则，不能套用相似规则。'})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}));return;
        }
        summaries++;
        const { evidence } = JSON.parse(body.messages[1].content);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(evidence.map(item => ({ sourceId: item.sourceId, excerpts: [item.content.slice(-180)] }))) } }] }));
        return;
      }
      let delta, finish;
      if (body.tools) {
        const current = JSON.parse(body.messages.find(message => message.role === 'user').content);
          if (steps++) {
            assert.ok(current.previousReads.length >= 3);
            assert.ok(current.evidence.some(item => item.content.includes('河图检查规则')));
            assert.deepEqual(current.availableReadDates, []);
            assert.ok(!body.tools.some(item => item.function.name === 'read'));
          } else {
            assert.deepEqual(current.availableReadDates, ['2026-09-01']);
            assert.ok(current.evidence.some(item => item.truncated));
            assert.ok(body.messages.some(message => message.role === 'system' && message.content.includes('优先从availableReadDates')));
            assert.ok(body.tools.some(item => item.function.name === 'read'));
          }
          delta = { tool_calls: [{ index: 0, id: `call-${steps}`, type: 'function', function: {
            name: steps === 1 ? 'read' : 'search', arguments: JSON.stringify(steps === 1 ? { date: '2026-09-01' } : { query: '河图检查规则' })
          } }] };
          finish = 'tool_calls';
      } else {
        assert.ok(body.messages.at(-1).content.includes(linkedRules));
        const ruleBlock=body.messages.at(-1).content.split('\n\n---\n\n').find(item=>item.includes(linkedRules));
        delta = { content: `${linkedRules}[${ruleBlock.match(/\[(S\d+)\]/)[1]}]` }; finish = 'stop';
      }
      response.setHeader('content-type', 'text/event-stream');
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
    process.env.RAG_AGENT_ENABLED = 'true'; process.env.RAG_AGENT_TOOL_CALLING_VERIFIED = 'true'; process.env.RAG_JEV_ENABLED = 'false';
    const chat = { baseUrl: `http://127.0.0.1:${model.address().port}`, apiKey: 'synthetic', model: 'mock' };
    for (const question of [longContextQuestion, '北辰归档流程可以直接保存吗？请给出最终保存条件。', '列出北辰归档流程完成保存所需的条件。']) {
      const baseline = new EvidenceRun(new AbortController().signal);
      await collectRagEvidence(question, { strategy: 'relevance' }, baseline, config);
      const baselineHasProjectLink = baseline.contexts.some(item => item.date==='2026-09-01'&&item.content.includes('河图检查规则'));
      assert.equal(baselineHasProjectLink,false);
      steps = 0; summaries = 0;
      const output = await new Response(createRagQueryStream({ question, mode: 'logs_only', history: [] }, { chat, lightChat: chat, mcp: config }, new AbortController().signal)).text();
      const terminal = JSON.parse(output.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
      assert.match(output, /event: done/);
      // The rule alone cannot prove applicability: retain it, then read the project link.
      assert.equal(steps, 2); assert.ok(summaries > 0);
      assert.ok(terminal.citations.some(item => item.date === '2026-09-18'));
      assert.ok(terminal.answer.includes(linkedRules));
      assert.ok(!output.includes('内部文本'));
      assert.ok(terminal.diagnostics.toolCalls <= 8);
    }
  } finally {
    model?.closeAllConnections(); if (model) await new Promise(resolve => model.close(resolve));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await service?.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('rag-long-corpus-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
