import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRagContextScope as resolveContextScope, contextualizeRagQuestion } from '../lib/rag-planning.ts';
const now = new Date('2026-10-13T04:00:00Z');
const history = [{ role: 'user', content: '总结2026年9月和11月的记录' }, { role: 'assistant', content: '合成回答，内部举例提到2025年1月。' }];
test('follow-up selected user scope survives omission and invented dates in query', () => {
  for (const query of ['这个项目的恢复会保存原文吗？', '2027年1月这个项目的恢复会保存原文吗？']) {
    const value = resolveContextScope('这个恢复会保存原文吗？', history, { query, scopeSource: 0 }, now);
    assert.equal(value.plan.dateFrom, '2026-09-01'); assert.equal(value.plan.dateTo, '2026-11-30');
    assert.deepEqual(value.plan.ranges, [{ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, { dateFrom: '2026-11-01', dateTo: '2026-11-30' }]);
  }
});
test('explicit current month overrides selected historical scope', () => {
  const value = resolveContextScope('2026年10月这个项目怎样？', history, { query: '9月该项目怎样？', scopeSource: 0 }, now);
  assert.equal(value.plan.dateFrom, '2026-10-01'); assert.equal(value.scopeSource, null);
});
test('new independent question does not inherit earlier date scope', () => {
  const value = resolveContextScope('BM25是什么？', history, { query: '2026年9月BM25是什么？', scopeSource: null }, now);
  assert.equal(value.plan.dateFrom, undefined);
});
test('current literal lookup and event dates are not overridden by prior scope', () => {
  const lookup = resolveContextScope('哪里写过`新主题`？', history, { query: '9月旧主题', scopeSource: 0 }, now);
  assert.equal(lookup.plan.literalQuery, '新主题'); assert.equal(lookup.plan.dateFrom, undefined);
  const event = resolveContextScope('我记录过2025年九月发布的模型吗？', history, { query: '9月模型', scopeSource: 0 }, now);
  assert.equal(event.plan.eventDates, true); assert.equal(event.plan.dateFrom, undefined);
});
test('assistant, nonexistent, fractional, uncertain and missing pointers cannot become scopes', () => {
  for (const scopeSource of [1, 9, -1, 0.5, 'uncertain', undefined]) assert.throws(() => resolveContextScope('它呢？', history, { query: '项目问题', scopeSource }, now));
  assert.throws(() => resolveContextScope('它呢？', history, { query: '项目问题' }, now));
});
test('relative historical periods require explicit clarification instead of recomputing today', () => {
  assert.throws(() => resolveContextScope('那后来呢？', [{ role: 'user', content: '总结最近7天' }], { query: '进展怎样', scopeSource: 0 }, now));
});
test('old yearless months and dateless intermediate questions do not become implicit current scopes', () => {
  for (const content of ['总结九月的记录', '这个恢复怎样？', '我记过2025年九月发布的模型吗？']) {
    assert.throws(() => resolveContextScope('它呢？', [{ role: 'user', content }], { query: '项目问题', scopeSource: 0 }, now));
  }
});
test('relative historical year cannot borrow an event year as its missing original timestamp', () => {
  for (const label of ['前年', '去年', '明年', '后年']) {
    assert.throws(() => resolveContextScope('它呢？', [{ role: 'user', content: `${label}9月，我读过2025年发布的模型` }], { query: '模型使用进展', scopeSource: 0 }, now));
  }
});
test('relative words in quoted text or event subjects do not invalidate a fixed historical scope', () => {
  for (const content of ['只查2026年9月，哪里写过`前年`？', '只看2026年9月，我记过今年发布的模型吗？']) {
    const result = resolveContextScope('这个主题还有什么？', [{ role: 'user', content }], { query: '主题内容', scopeSource: 0 }, now);
    assert.equal(result.plan.dateFrom, '2026-09-01'); assert.equal(result.plan.dateTo, '2026-09-30');
  }
});
test('no history uses original plan without transport', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected call'));
  const result = await contextualizeRagQuestion('2026年9月学了什么？', [], new AbortController().signal, {});
  assert.equal(result.plan.dateFrom, '2026-09-01');
});
test('one existing rewrite call selects scope; cancellation propagates without retry', async t => {
  const config = { baseUrl: 'https://synthetic.invalid/chat', model: 'mock', apiKey: 'synthetic' };
  let calls = 0;
  const stub = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ query: '项目恢复会保存原文吗？', scopeSource: 0 }) }, finish_reason: 'stop' }] })); });
  const result = await contextualizeRagQuestion('这个恢复会保存原文吗？', history, new AbortController().signal, config);
  assert.equal(calls, 1); assert.equal(result.plan.dateFrom, '2026-09-01'); stub.mock.restore();
  const control = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, init) => { calls++; return new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); control.abort(); }); });
  await assert.rejects(contextualizeRagQuestion('这个恢复呢？', history, control.signal, config));
  assert.equal(calls, 2);
});
