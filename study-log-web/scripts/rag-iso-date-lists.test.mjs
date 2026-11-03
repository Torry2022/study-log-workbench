import test from 'node:test';
import assert from 'node:assert/strict';
import { planRagRetrieval } from '../lib/rag-retrieval-plan.ts';

const day = date => ({ dateFrom: date, dateTo: date });
const examples = [
  ['比较2031-01-03和04-07的记录', ['2031-01-03', '2031-04-07'].map(day)],
  ['比较2031-01-03、02-05和04-07的记录', ['2031-01-03', '2031-02-05', '2031-04-07'].map(day)],
  ['比较2032/1/03，2/29及4/5的记录', ['2032-01-03', '2032-02-29', '2032-04-05'].map(day)],
  ['比较2031-12-02与2032-01-04和02-29的记录', ['2031-12-02', '2032-01-04', '2032-02-29'].map(day)],
  ['比较2033-03-04至03-06、05-08的记录', [{ dateFrom: '2033-03-04', dateTo: '2033-03-06' }, day('2033-05-08')]],
  ['比较2034-09-06、01-02和06-03的记录', ['2034-01-02', '2034-06-03', '2034-09-06'].map(day)],
  ['比较2036-01-03、02-05与02-05和04-07的记录', ['2036-01-03', '2036-02-05', '2036-04-07'].map(day)]
];
for (const [question, ranges] of examples) test(`ISO date lists preserve every scope without bridging gaps: ${question}`, () => {
  const plan = planRagRetrieval(question, new Date('2040-07-01T00:00:00Z'));
  assert.equal(plan.invalidDate, undefined);
  assert.deepEqual(plan.ranges, ranges);
  assert.equal(plan.dateFrom, ranges[0].dateFrom);
  assert.equal(plan.dateTo, ranges.at(-1).dateTo);
});
for (const question of ['比较2031-01-03、02-30和04-07的记录', '比较2031-01-03、02-05和04-31的记录'])
  test(`invalid abbreviated date cannot disappear from the scope: ${question}`, () => {
    assert.equal(planRagRetrieval(question).invalidDate, true);
  });

test('full ISO dates and abbreviated endpoints keep their existing roles', () => {
  assert.deepEqual(planRagRetrieval('比较2031-01-03、2031-02-05和2031-04-07的记录').ranges,
    ['2031-01-03', '2031-02-05', '2031-04-07'].map(day));
  const range = planRagRetrieval('回顾2032-03-04至06的日志');
  assert.equal(range.dateFrom, '2032-03-04'); assert.equal(range.dateTo, '2032-03-06');
  assert.deepEqual(planRagRetrieval('比较2031年1月3日、5日和7日的记录').ranges,
    ['2031-01-03', '2031-01-05', '2031-01-07'].map(day));
});

test('literal lookup dates, event dates and ordinary numbers do not become a date list', () => {
  const literal = '2031-01-03、02-05和04-07';
  const lookup = planRagRetrieval(`查找原文“${literal}”`);
  assert.equal(lookup.literalQuery, literal); assert.equal(lookup.dateFrom, undefined); assert.equal(lookup.ranges, undefined);
  const event = planRagRetrieval('回顾2031年9月日志中关于2031-01-03发布的内容');
  assert.equal(event.dateFrom, '2031-09-01'); assert.equal(event.dateTo, '2031-09-30');
  const ordinary = planRagRetrieval('2031-01-03，整理了2个问题和3个方案');
  assert.equal(ordinary.dateFrom, '2031-01-03'); assert.equal(ordinary.dateTo, '2031-01-03'); assert.equal(ordinary.ranges, undefined);
});
