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

test('search after a whole-day excerpt retains a section omitted from the current model evidence',async()=>{
  const date='2026-09-01';
  const blocks=parseDayBlocks(`## ${date}\n\n### Alpha\n\nAlpha完成初步整理。\n\n### Beta\n\nBeta只有核对地址后才能保存，没有确认不得继续。`,'2026-09_学习日志.md');
  const read=readers(blocks),evidence=run();
  await collectRagEvidence('',range(date),evidence,config,read);
  const original=evidence.contexts[0];evidence.compactionOriginals.set(original.sourceId,original.content);evidence.compactedSources.add(original.sourceId);original.content='Alpha完成初步整理。';
  assert.ok(!original.content.includes('Beta只有'));
  const changed=await collectRagEvidence('Beta',{strategy:'relevance'},evidence,config,read);
  assert.deepEqual(changed,['S2']);assert.equal(evidence.contexts[0].sourceId,'S1');
  assert.ok(evidence.contexts[1].content.includes('Beta只有核对地址后才能保存，没有确认不得继续'));
  assert.equal(evidence.sourceChanged,false);assert.equal(evidence.coverage[0].status,'complete');
});

test('same-version search restores a compacted source in place and reports the updated source',async()=>{
  const date='2026-09-01',file='2026-09_学习日志.md';
  const blocks=parseDayBlocks(`## ${date}\n\n### Beta\n\nBeta只有核对地址后才能保存，没有确认不得继续。`,file);
  const read=readers(blocks),evidence=run();
  await collectRagEvidence('Beta',{strategy:'relevance'},evidence,config,read);
  const original=structuredClone(evidence.contexts[0]);
  evidence.compactionOriginals.set('S1',original.content);evidence.compactedSources.add('S1');
  evidence.contexts[0].content=original.content.slice(0,4);evidence.contexts[0].truncated=true;
  const restored=await collectRagEvidence('Beta地址',{strategy:'relevance'},evidence,config,read);
  assert.deepEqual(restored,['S1']);assert.equal(evidence.contexts.length,1);
  assert.deepEqual(evidence.contexts[0],original);assert.equal(evidence.compactedSources.has('S1'),false);
  const duplicate=await collectRagEvidence('Beta确认',{strategy:'relevance'},evidence,config,read);
  assert.deepEqual(duplicate,[]);assert.equal(evidence.contexts.length,1);
  evidence.compactionOriginals.set('S1',original.content);evidence.compactedSources.add('S1');evidence.contexts[0].content=original.content.slice(0,4);
  const [restoredAgain,empty]=await Promise.all([
    collectRagEvidence('Beta恢复',{strategy:'relevance'},evidence,config,read),
    collectRagEvidence('UnrecordedTopic',{strategy:'relevance'},evidence,config,read)
  ]);
  assert.deepEqual(restoredAgain,['S1']);assert.deepEqual(empty,[]);assert.deepEqual(evidence.contexts[0],original);
  // A different day revision must still be rejected before any restoration.
  evidence.compactionOriginals.set('S1',original.content);evidence.compactedSources.add('S1');evidence.contexts[0].content=original.content.slice(0,4);
  const changed=parseDayBlocks(`## ${date}\n\n### Beta\n\nBeta现在无需确认。`,file);
  assert.deepEqual(await collectRagEvidence('Beta新条件',{strategy:'relevance'},evidence,config,readers(changed)),[]);
  assert.equal(evidence.sourceChanged,true);assert.equal(evidence.contexts[0].content,original.content.slice(0,4));
});

test('restoring an excerpt neither resets nor charges its original retention twice',async()=>{
  const date='2026-09-01',blocks=parseDayBlocks(`## ${date}\n\n### Beta\n\nBeta需要先核对地址。`,'2026-09_学习日志.md');
  const evidence=run(),read=readers(blocks);
  await collectRagEvidence('Beta',{strategy:'relevance'},evidence,config,read);
  const original=structuredClone(evidence.contexts[0]);evidence.compactionOriginals.set('S1',original.content);evidence.compactedSources.add('S1');evidence.contexts[0].content=original.content.slice(0,4);
  assert.deepEqual(await collectRagEvidence('Beta地址',{strategy:'relevance'},evidence,config,read),['S1']);
  const extra={date:'2026-10-01',fileName:'2026-10_学习日志.md',chunkId:'budget-fixture',contentHash:'a'.repeat(64),content:'原'.repeat(8*30000-original.content.length),truncated:false};
  assert.equal(evidence.add([extra]),1);
  assert.equal(evidence.add([{...extra,chunkId:'over-budget',content:'原'}]),0);
  assert.equal(evidence.stopReason,'evidence_limit');
});

test('completed pagination is complete despite earlier search truncation, but exhausting the read budget remains partial', async () => {
  const date = '2026-09-01';
  for (const [size, expected] of [[4000, 'complete'], [15000, 'complete'], [30000, 'partial']]) {
    const blocks = parseDayBlocks(`## ${date}\n\n### Alpha\n\n${'Alpha条件成立才适用。'.repeat(size)}最终要求核对地址。`, '2026-09_学习日志.md');
    const evidence = run();
    await collectRagEvidence('Alpha', {strategy:'relevance',maxChars:1200}, evidence, config, readers(blocks));
    assert.equal(evidence.coverage[0].status, 'partial'); assert.equal(evidence.limited, true);
    await collectRagEvidence('Alpha', range(date), evidence, config, readers(blocks));
    assert.equal(evidence.coverage[1].status, expected);
    if (expected === 'complete') assert.ok(evidence.contexts.some(item => item.content.includes('最终要求核对地址')));
    else assert.equal(evidence.stopReason, 'tool_budget');
    assert.ok(evidence.calls<=8);assert.ok(evidence.contexts.reduce((sum,item)=>sum+item.content.length,0)<=8*30000);
    assert.equal(evidence.limited, true); // Does not declare whole-corpus search complete.
  }
});

test('a final page without all completed dates cannot prove complete range coverage', async () => {
  const blocks = parseDayBlocks('## 2026-09-01\n\n### Alpha\n\n第一天。\n\n## 2026-09-02\n\n### Beta\n\n第二天。', '2026-09_学习日志.md');
  const real = readers(blocks), evidence = run();
  await collectRagEvidence('Alpha', {strategy:'timeline_summary',dateFrom:'2026-09-01',dateTo:'2026-09-02'}, evidence, config, {
    ...real, read: async args => { const page = await real.read(args); page.coverage.completedDates = ['2026-09-01']; return page; }
  });
  assert.equal(evidence.coverage[0].totalDays, 2);
  assert.equal(evidence.coverage[0].status, 'partial');
});

test('complete supplied days disable reads while missing, legacy and compressed evidence remains readable', async () => {
  const blocks = parseDayBlocks('## 2026-09-01\n\n### Alpha\n\nAlpha需要核对地址。', '2026-09_学习日志.md');
  const evidence = run();
  await collectRagEvidence('Alpha', {strategy:'relevance'}, evidence, config, readers(blocks));
  assert.deepEqual(evidence.availableReadDates(), []);
  evidence.contexts[0].content = '压缩后的概述';
  assert.deepEqual(evidence.availableReadDates(), ['2026-09-01']);
  const legacy = run(); legacy.add(evidence.contexts.map(item => ({...item, dayFullyProvided:undefined})));
  assert.deepEqual(legacy.availableReadDates(), ['2026-09-01']);
  const missing = run();
  await collectRagEvidence('Alpha', {strategy:'relevance'}, missing, config, readers(parseDayBlocks(blocks[0].content+'\n\n### Beta\n\n别的小节。', '2026-09_学习日志.md')));
  assert.deepEqual(missing.availableReadDates(), ['2026-09-01']);
  missing.take('read_log_range', {dateFrom:'2026-09-01',dateTo:'2026-09-01'});
  assert.deepEqual(missing.availableReadDates(), []);
});

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
    await collectRagEvidence(entry.question, { strategy: 'relevance' }, readFirst, config, read);
    assert.deepEqual(readFirst.contexts,daySources); // Uncompressed day bodies still deduplicate sections.
    const excerpted = run();
    for (const date of [entry.date,entry.ruleDate]) await collectRagEvidence('',range(date),excerpted,config,read);
    excerpted.contexts.forEach(item=>{excerpted.compactionOriginals.set(item.sourceId,item.content);excerpted.compactedSources.add(item.sourceId);item.content=item.content.slice(0,20);});
    // Reading proof remains valid, but omitted section text must be supplied again.
    await collectRagEvidence(entry.question,{strategy:'relevance'},excerpted,config,read);
    assert.equal(excerpted.contexts.length,4);
    assert.deepEqual(excerpted.contexts.slice(0,2).map(item=>item.chunkId),daySources.map(item=>item.chunkId));
    assert.deepEqual(excerpted.contexts.slice(2).map(item=>item.content),sources.map(item=>item.content));
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
  changed.contentHash = 'a'.repeat(64); changed.dayContentHash = 'b'.repeat(64); changed.content = 'Alpha无需核对地址。';
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

test('changed headings stop the run and same-version empty sections are not silently discarded', async () => {
  const date = '2026-08-04', file = '2026-08_学习日志.md';
  const initial = parseDayBlocks(`## ${date}\n\n### Alpha\n\n共同正文。`, file);
  const evidence = run();
  evidence.add((await readers(initial).search('Alpha', {})).contexts);
  await collectRagEvidence('', range(date), evidence, config, readers(parseDayBlocks(`## ${date}\n\n### Beta\n\n共同正文。`, file)));
  assert.equal(evidence.contexts.length, 1); assert.equal(evidence.sourceChanged, true);
  const body = '### Alpha\n\n共同正文。\n\n### 新标题';
  const read = readers(parseDayBlocks(`## ${date}\n\n${body}`, file)), unchanged = run();
  unchanged.add((await read.search('Alpha', { maxChunks: 1 })).contexts);
  await collectRagEvidence('', range(date), unchanged, config, read);
  assert.equal(unchanged.sourceChanged, false); assert.equal(unchanged.contexts.length, 2);
  assert.ok(unchanged.contexts[1].content.includes(body));
});
