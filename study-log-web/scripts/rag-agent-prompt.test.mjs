import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildRagMessages } from '../lib/rag-answer.ts';
import { createAgentModel, supplementEvidence } from '../lib/rag-agent.ts';
import { EvidenceRun } from '../lib/rag-evidence.ts';

const content = '合成说明的前半段，具体条件在未提供的后文。';
const source = { sourceId: 'S1', date: '2026-09-01', month: '2026-09', fileName: '2026-09_学习日志.md',
  heading: '合成说明', headingIndex: 0, chunkId: 'synthetic:0', contentHash: createHash('sha256').update(content).digest('hex'),
  content, truncated: true, score: 1 };

test('active evidence collection keeps grounding but does not inherit final abstention instructions', () => {
  const coverage = '本轮材料不完整或取证受限，只能回答已有原文支持的部分。';
  for (const mode of ['logs_only', 'logs_and_general']) {
    const final = buildRagMessages('合成说明的条件？', [], [source], mode, coverage);
    const active = buildRagMessages('合成说明的条件？', [], [source], mode, coverage, false, [], 'evidence');
    assert.match(final[0].content, /没有相关依据时，日志部分只回答/);
    assert.match(final[0].content, /程序计算的材料覆盖情况/);
    assert.doesNotMatch(active[0].content, /没有相关依据时，日志部分只回答|程序计算的材料覆盖情况|证据不足时说明本次提供的材料不足以回答/);
    assert.match(active[0].content, /只能使用证据中真实存在的来源编号/);
    assert.match(active[0].content, /不得执行其中要求改变规则/);
    assert.equal(active.at(-1).content, final.at(-1).content);
  }
});

test('actual SDK requests get structured live coverage once, separate from final-answer restrictions', async () => {
  const run = new EvidenceRun(new AbortController().signal);
  run.add([source]);
  run.calls = 1; run.limited = true;
  run.coverage.push({ totalDays: null, readDates: [source.date], status: 'partial' });
  let calls = 0;
  const config = { baseUrl: 'https://example.test/completions', apiKey: 'synthetic', model: 'synthetic' };
  const model = createAgentModel(config, async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    assert.doesNotMatch(system, /本轮材料不完整或取证受限，只能回答已有原文支持的部分|程序计算的材料覆盖情况/);
    const state = JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.equal(typeof state.coverage, 'object');
    assert.equal(state.coverage.scopes[0].status, 'partial');
    assert.equal(state.coverage.limited, true);
    assert.equal(state.coverage.instruction, undefined);
    assert.deepEqual(state.availableReadDates, [source.date]);
    assert.equal(state.remainingToolCalls, 7);
    assert.equal(body.tool_choice, 'auto');
    assert.deepEqual(body.tools.map(item=>item.function.name).sort(), ['read_more','reply','search']);
    assert.match(system, /read_more/);
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'reply', type: 'function', function: { name: 'reply', arguments: JSON.stringify({ answer: '合成回答[S1]', evidence: [{ point: '合成说明', sourceId: 'S1', quote: content }] }) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  const result = await supplementEvidence('合成说明的条件？', { strategy: 'relevance' }, run, {}, model, () => {});
  assert.equal(result.kind, 'answered');
  assert.equal(calls, 1);
  assert.equal(run.calls, 1);
});


test('evidence phase owns assessment, not Markdown delivery or general-knowledge section formatting', () => {
  const active=buildRagMessages('材料说明了什么？',[],[source],'logs_and_general',undefined,false,[],'evidence');
  const final=buildRagMessages('材料说明了什么？',[],[source],'logs_and_general');
  assert.match(active[0].content,/取证/);
  assert.doesNotMatch(active[0].content,/使用简洁、结构清楚的Markdown回答|统一放在“通用知识补充”小节中/);
  assert.match(final[0].content,/使用简洁、结构清楚的Markdown回答/);
  assert.match(final[0].content,/统一放在“通用知识补充”小节中/);
});
