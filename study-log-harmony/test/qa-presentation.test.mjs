import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../entry/src/main/resources/rawfile/markdown/qa-presentation.js', import.meta.url), 'utf8');
const scope = { Intl }; runInNewContext(source, scope); const { QaPresentation } = scope;

test('presentation drains live fragments after execution completion but never replays history', () => {
  const job = new QaPresentation(); job.update('history', '完整历史', 'complete', 0);
  assert.equal(job.text, '完整历史'); assert.equal(job.pending, false);
  const fragment = '这是刚接收的第一段'.repeat(10);
  job.update('new', '', 'streaming', 0); job.update('new', fragment, 'streaming', 100);
  job.advance(150); assert.ok(job.text.length > 0 && job.text.length < job.target.length);
  const first = job.text; job.update('new', fragment + '还有后续内容', 'complete', 160);
  assert.equal(job.text, first); assert.equal(job.pending, true);
  job.advance(411); assert.equal(job.text, job.target); assert.equal(job.pending, false);
});

test('fragments have bounded deadlines and never split emoji clusters', () => {
  const job = new QaPresentation(); job.update('new', '', 'streaming', 0);
  job.update('new', '你👨‍👩‍👧‍👦好é', 'streaming', 10);
  const ends = new Set(['', '你', '你👨‍👩‍👧‍👦', '你👨‍👩‍👧‍👦好', '你👨‍👩‍👧‍👦好é']);
  for (let now = 20; now < 260; now += 10) { job.advance(now); assert.ok(ends.has(job.text), job.text); }
  job.update('new', `${job.target}追加`, 'streaming', 250); job.advance(261);
  assert.ok(job.text.startsWith('你👨‍👩‍👧‍👦好é'), 'the earlier fragment deadline is not reset by new arrivals');
});

test('new conversation/version, failures, stops and reduced motion flush without stale output', () => {
  for (const status of ['error', 'stopped']) {
    const job = new QaPresentation(); job.update('old', '合成片段', 'streaming', 0);
    job.update('old', '失败保留片段', status, 20); assert.equal(job.text, '失败保留片段'); assert.equal(job.pending, false);
    job.update('new-version', '已保存其他版本', 'complete', 30); assert.equal(job.text, '已保存其他版本');
  }
  const job = new QaPresentation(); job.update('a', '直接显示', 'streaming', 0, false);
  assert.equal(job.text, '直接显示'); assert.equal(job.pending, false);
});

test('long-answer appends segment only the trailing cluster and new fragment, not the full history', () => {
  const scanned = [];
  class Segmenter {
    constructor() { this.real = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); }
    segment(value) { scanned.push(value.length); return this.real.segment(value); }
  }
  const local = { Intl: { Segmenter } }; runInNewContext(source, local);
  const job = new local.QaPresentation();
  job.update('long', '合'.repeat(50000), 'streaming', 0); job.advance(251);
  scanned.length = 0;
  for (let index = 1; index <= 20; index++) {
    job.update('long', '合'.repeat(50000) + '追加片段。'.repeat(index), 'streaming', 251 + index * 50);
    job.advance(251 + index * 50 + 30);
  }
  assert.equal(scanned.length, 20);
  assert.ok(scanned.every(length => length <= 6), `incremental segment lengths: ${scanned}`);
});
