import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function compile(source, globals = {}) {
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText, { module, exports: module.exports, ...globals });
  return module.exports;
}
const root = '../entry/src/main/ets/features/logs/';
const body = compile(await readFile(new URL(root + 'LogDayBody.ets', import.meta.url), 'utf8'));
const source = await readFile(new URL(root + 'components/BackupPanel.ets', import.meta.url), 'utf8');
const start = source.indexOf('  private async restore():');
assert.ok(start > 0);
const method = source.slice(start, source.indexOf('\n  @Builder', start));
class ApiError extends Error {
  constructor(statusCode) { super('synthetic response loss'); this.statusCode = statusCode; }
}
const { Panel } = compile(`export class Panel { ${method} }`, { ...body, ApiError, Error });
const date = '2026-02-05';
const historical = `## ${date}\n\n历史正文。`;
const day = (content, version = 'v3') => ({ date, exists: true, version, content });
function subject(read) {
  const applied = [], busy = [], requests = [];
  const panel = new Panel();
  Object.assign(panel, { preview: { date, id: 'synthetic', currentVersion: 'v1',
    backupVersion: 'history-v1', historicalContent: historical },
    lifecycle: 1, previewRevision: 1, webContentReady: true, conflict: false,
    busy: () => false, onBeforeRestore: async () => true,
    onBusyChange: value => busy.push(value), onRestored: async value => applied.push(value),
    repository: { restore: async request => { requests.push(request); throw new ApiError(502); }, day: read } });
  return { panel, applied, busy, requests };
}

test('actual backup restore rejects a different second-writer result after a lost response', async () => {
  const state = subject(async () => ({ day: day(`## ${date}\n\n另一客户端正文。`) }));
  await state.panel.restore();
  assert.equal(state.panel.conflict, true);
  assert.equal(state.panel.restoreError, '内容已变化，请重新预览并确认后再恢复。');
  assert.equal(state.applied.length, 0);
  assert.deepEqual(state.busy, [true, false]);
  await state.panel.restore();
  assert.equal(state.requests.length, 1, 'conflict requires a new preview, not blind retry');
});

test('actual backup restore accepts only the matching readback and retains an unverifiable result', async () => {
  const matched = subject(async () => ({ day: day(historical) }));
  await matched.panel.restore();
  assert.equal(matched.applied.length, 1);
  assert.equal(matched.panel.conflict, false);
  const unknown = subject(async () => { throw new ApiError(503); });
  await unknown.panel.restore();
  assert.equal(unknown.applied.length, 0);
  assert.equal(unknown.panel.restoreError, '恢复结果未确认，请检查连接后重试。');
  assert.equal(unknown.panel.restoring, false);
});

test('actual backup restore ignores verification arriving after its panel lifecycle ends', async () => {
  let resolve;
  const state = subject(() => new Promise(done => { resolve = done; }));
  const pending = state.panel.restore();
  while (!resolve) await Promise.resolve();
  state.panel.lifecycle++;
  resolve({ day: day(historical) });
  await pending;
  assert.equal(state.applied.length, 0);
});
