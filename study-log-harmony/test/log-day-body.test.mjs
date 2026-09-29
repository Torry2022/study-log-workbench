import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

async function loadBody() {
  const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogDayBody.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports });
  return module.exports;
}

test('a lost day-write response is accepted only for the exact saved body', async () => {
  const { editableDayBody, matchesSubmittedDay } = await loadBody();
  const body = '### 1. 并发控制\n\n跨月合成资料。\nsynthetic-log-loss-20260929';
  const day = { date: '2026-02-05', exists: true, version: 'v2',
    content: `## 2026-02-05\n\n${body}\n\n---\n` };
  assert.equal(editableDayBody(day), body);
  assert.equal(matchesSubmittedDay(day, body), true);
  assert.equal(matchesSubmittedDay(day, `${body}\n另一个客户端的文字`), false);
  assert.equal(matchesSubmittedDay({ ...day, exists: false }, body), false);
  assert.equal(matchesSubmittedDay({ ...day, version: null }, body), false);
  assert.equal(matchesSubmittedDay(day, `${body}\n`), false);
});

test('a lost delete response is accepted only when the selected day is absent', async () => {
  const { matchesDeletedDay } = await loadBody();
  const day = { date: '2026-02-05', exists: false, version: null, content: '' };
  assert.equal(matchesDeletedDay(day, '2026-02-05'), true);
  assert.equal(matchesDeletedDay({ ...day, exists: true }, '2026-02-05'), false);
  assert.equal(matchesDeletedDay({ ...day, date: '2026-02-06' }, '2026-02-05'), false);
});

test('a restored backup is confirmed only for the selected day and historical body', async () => {
  const { matchesRestoredContent } = await loadBody();
  const day = { date: '2026-02-05', exists: true, version: 'v3',
    content: '## 2026-02-05\n\n### 1. 并发控制\n\n原有资料。' };
  const historical = '## 2026-02-05\n\n### 1. 并发控制\n\n原有资料。\n\n---\n';
  assert.equal(matchesRestoredContent(day, '2026-02-05', historical), true);
  assert.equal(matchesRestoredContent(day, '2026-02-06', historical), false);
  assert.equal(matchesRestoredContent({ ...day, exists: false }, '2026-02-05', historical), false);
  assert.equal(matchesRestoredContent({ ...day, content: `${day.content}\n他人修改` }, '2026-02-05', historical), false);
});
