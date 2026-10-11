import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceRun, collectRagEvidence } from '../lib/rag-evidence.ts';
import { validateRetrievedContexts, validateRangePage } from '../lib/mcp-client.ts';
import { KeywordRetriever } from '../../study-log-mcp/src/retrieval.mjs';
import { parseDayBlocks } from '../../study-log-mcp/src/markdown-source.mjs';
import { readLogRange } from '../../study-log-mcp/src/range-reader.mjs';
import { linkedCases } from './rag-linked-cases.mjs';

const config = { url: 'http://unused.test', token: 'synthetic' };
const readers = blocks => ({
  search: async (query, plan) => validateRetrievedContexts(await new KeywordRetriever().retrieveContexts(blocks, query, plan)),
  read: async args => validateRangePage(readLogRange(blocks, args))
});
const run = () => new EvidenceRun(new AbortController().signal);
const range = date => ({ strategy: 'timeline_summary', dateFrom: date, dateTo: date });

test('actual MCP short cases do not duplicate section and complete day sources in either read order', async () => {
  for (const entry of linkedCases) {
    const blocks = parseDayBlocks(`## ${entry.date}\n\n### 实践记录\n\n${entry.content}\n\n## ${entry.ruleDate}\n\n### ${entry.rule}\n\n${entry.guidance}`, `${entry.date.slice(0,7)}_学习日志.md`);
    const read = readers(blocks), searchFirst = run();
    await collectRagEvidence(entry.question, { strategy: 'relevance' }, searchFirst, config, read);
    const sources = structuredClone(searchFirst.contexts);
    assert.equal(sources.length, 2);
    for (const date of [entry.date, entry.ruleDate]) await collectRagEvidence('', range(date), searchFirst, config, read);
    assert.deepEqual(searchFirst.contexts, sources);
    assert.deepEqual(searchFirst.coverage.slice(1).map(scope => scope.status), ['complete', 'complete']);
    const readFirst = run();
    for (const date of [entry.date, entry.ruleDate]) await collectRagEvidence('', range(date), readFirst, config, read);
    const daySources = structuredClone(readFirst.contexts);
    // Summaries change prompt text, not the original evidence identity or its coverage proof.
    readFirst.contexts.forEach(item => { item.content = '合成摘要'; });
    await collectRagEvidence(entry.question, { strategy: 'relevance' }, readFirst, config, read);
    assert.equal(readFirst.contexts.length, 2);
    assert.deepEqual(readFirst.contexts.map(item => item.chunkId), daySources.map(item => item.chunkId));
    readFirst.contexts = [];
    readFirst.add((await read.search(entry.question, { strategy: 'relevance' })).contexts);
    assert.equal(readFirst.contexts.length, 2); // Cached coverage is not retained evidence on its own.
  }
});

test('new context, repeated titles, code headings and changed text are retained instead of fuzzy merged', async () => {
  const date = '2026-08-04', file = '2026-08_学习日志.md';
  const blocks = parseDayBlocks(`## ${date}\n\n开头条件不能丢。\n\n### 1. Alpha\n\nAlpha先核对地址。\n\n\`\`\`markdown\n### 这不是小节\n\`\`\`\n\n### 2. Alpha\n\n没有错误码不能判断原因。`, file);
  const read = readers(blocks), evidence = run();
  const selected = await read.search('Alpha', { maxChunks: 1 });
  evidence.add(selected.contexts);
  await collectRagEvidence('', range(date), evidence, config, read);
  assert.ok(evidence.contexts.some(item => item.content.includes('开头条件不能丢')));
  assert.ok(evidence.contexts.some(item => item.content.includes('没有错误码不能判断原因')));
  assert.ok(evidence.contexts.some(item => item.content.includes('### 这不是小节')));
  const count = evidence.contexts.length;
  evidence.add(await read.search('Alpha', {}).then(result => result.contexts));
  assert.equal(evidence.contexts.length, count);
  const changed = structuredClone(selected.contexts[0]);
  changed.contentHash = 'a'.repeat(64); changed.content = 'Alpha无需核对地址。';
  evidence.add([changed]);
  assert.equal(evidence.limited, true);
  assert.ok(!evidence.contexts.some(item => item.content === changed.content));
});

test('partial range fragments and truncated search results cannot prove a whole day duplicate', async () => {
  const date = '2026-08-04';
  const blocks = parseDayBlocks(`## ${date}\n\n### Alpha\n\n${'Alpha条件成立才适用。'.repeat(3000)}末尾不能丢。`, '2026-08_学习日志.md');
  const evidence = run(), read = readers(blocks);
  evidence.add((await read.search('Alpha', {})).contexts);
  await collectRagEvidence('', range(date), evidence, config, read);
  assert.ok(evidence.contexts.length > 1);
  assert.ok(evidence.contexts.some(item => item.content.includes('末尾不能丢')));
});

test('new or changed headings and empty sections are not silently discarded', async () => {
  const date = '2026-08-04', file = '2026-08_学习日志.md';
  const initial = parseDayBlocks(`## ${date}\n\n### Alpha\n\n共同正文。`, file);
  for (const body of ['### Beta\n\n共同正文。', '### Alpha\n\n共同正文。\n\n### 新标题']) {
    const evidence = run();
    evidence.add((await readers(initial).search('Alpha', {})).contexts);
    await collectRagEvidence('', range(date), evidence, config, readers(parseDayBlocks(`## ${date}\n\n${body}`, file)));
    assert.equal(evidence.contexts.length, 2);
    assert.ok(evidence.contexts[1].content.includes(body));
  }
});
