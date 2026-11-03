import test from 'node:test';
import assert from 'node:assert/strict';
import { planRagRetrieval } from '../lib/rag-retrieval-plan.ts';
import { prepareRagQuery } from '../lib/rag-planning.ts';

const now = new Date('2032-11-03T04:00:00Z');

test('single calendar days without a year use the current China calendar year', () => {
  for (const question of ['4月8日的记录', '四月八日的记录', '回顾四月八日']) {
    const plan = planRagRetrieval(question, now);
    assert.equal(plan.dateFrom, '2032-04-08'); assert.equal(plan.dateTo, '2032-04-08');
  }
  assert.equal(planRagRetrieval('去年四月八日的记录', now).dateFrom, '2031-04-08');
  assert.equal(planRagRetrieval('2月29日的记录', now).dateFrom, '2032-02-29');
  assert.equal(planRagRetrieval('2月29日的记录', new Date('2031-11-03T04:00:00Z')).invalidDate, true);
});

test('calendar lists inherit in order and a later year cannot change an earlier endpoint', () => {
  assert.deepEqual(planRagRetrieval('比较4月8日与2030年7月9日', now).ranges, [
    { dateFrom: '2030-07-09', dateTo: '2030-07-09' },
    { dateFrom: '2032-04-08', dateTo: '2032-04-08' }
  ]);
  assert.deepEqual(planRagRetrieval('比较4月1日、2日和3日的记录', now).ranges, [1, 2, 3].map(day => ({
    dateFrom: `2032-04-0${day}`, dateTo: `2032-04-0${day}`
  })));
  const range = planRagRetrieval('2032年6月22日至6月24日的记录', now);
  assert.equal(range.dateFrom, '2032-06-22'); assert.equal(range.dateTo, '2032-06-24');
  assert.equal(range.ranges, undefined);
});

test('invalid month or day tokens are rejected whole instead of becoming a valid prefix', () => {
  for (const value of ['1月123日', '100月1日', '0月1日', '1月0日', '零月一日', '一月零日', '4月31日', '1月9999999999999999999999日']) {
    assert.equal(planRagRetrieval(`${value}的记录`, now).invalidDate, true, value);
  }
});

test('calendar normalization retains event-date and literal-text exclusions', () => {
  for (const value of ['4月8日发布的版本', '4月8日至10日发布的版本', '四月八日至十日发布的版本']) {
    const plan = planRagRetrieval(`查找${value}的记录`, now);
    assert.equal(plan.dateFrom, undefined); assert.equal(plan.eventDates, true);
  }
  const literal = planRagRetrieval('哪里写过`4月8日`？', now);
  assert.equal(literal.dateFrom, undefined); assert.equal(literal.literalQuery, '4月8日');
});

test('a rewritten follow-up cannot drop the current calendar-day constraint', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    query: '相关主题记录', scopeSource: 0, strategy: 'relevance', useWiki: false
  }) }, finish_reason: 'stop' }] }));
  const prepared = await prepareRagQuery('更正，改为4月8日的记录。', [
    { role: 'user', content: '回顾2030年7月19日的记录' }, { role: 'assistant', content: '合成历史。' }
  ], new AbortController().signal, { baseUrl: 'https://synthetic.invalid/chat', apiKey: 'synthetic', model: 'synthetic' }, () => {}, now);
  assert.equal(prepared.kind, 'ready'); assert.equal(prepared.query, '相关主题记录');
  assert.equal(prepared.plan.dateFrom, '2032-04-08'); assert.equal(prepared.plan.dateTo, '2032-04-08');
});

test('Chinese abbreviated days and month-only ranges preserve all endpoints', () => {
  assert.deepEqual(planRagRetrieval('回顾四月八日、九日和十日', now).ranges, [8,9,10].map(day => ({ dateFrom: `2032-04-${String(day).padStart(2,"0")}`, dateTo: `2032-04-${String(day).padStart(2,"0")}` })));
  const range=planRagRetrieval('总结2030年八月到十月提到的方案',now);
  assert.deepEqual(range.ranges,[{dateFrom:'2030-08-01',dateTo:'2030-10-31'}]);
});

test('relative years in an event range do not create or widen a journal-date filter', () => {
  const event='去年四月八日至今年五月十日发布的版本';
  const onlyEvent=planRagRetrieval(`查找${event}的记录`,now);
  assert.equal(onlyEvent.eventDates,true);assert.equal(onlyEvent.dateFrom,undefined);
  const scoped=planRagRetrieval(`只看十月日志中${event}的记录`,now);
  assert.equal(scoped.dateFrom,'2032-10-01');assert.equal(scoped.dateTo,'2032-10-31');
  assert.equal(scoped.ranges,undefined);
});
