import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function controller(transport, overrides = {}) {
  const source = await readFile(new URL('../entry/src/main/ets/features/stats/StatsController.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Observed: value => value,
    require: () => ({ ApiError: Error }) });
  return new module.exports.StatsController(transport, {
    requestedMonth: () => '2026-01', monthsChanged() {}, monthsLoading() {}, monthsError() {},
    selectedMonthChanged() {}, prepareResult() {}, publishResult: (_stats, commit) => commit(), ...overrides
  });
}

test('initial statistics completion cannot clear loading for a newer selected month', async () => {
  for (const failOld of [false, true]) {
    const january = deferred(), february = deferred(), started = deferred();
    const c = await controller({ get: path => {
      if (path === '/logs/months') return Promise.resolve({ months: [{ id: '2026-01' }, { id: '2026-02' }] });
      if (path.endsWith('2026-01')) { started.resolve(); return january.promise; }
      return february.promise;
    } });
    const initial = c.loadMonths();
    await started.promise;
    const latest = c.loadStats('2026-02');
    if (failOld) january.reject(new Error('old request failed'));
    else january.resolve({ month: '2026-01' });
    assert.equal(await initial, false);
    assert.equal(c.loading, true);
    assert.equal(c.pendingMonth, '2026-02');
    assert.equal(c.errorMessage, '');
    assert.equal(c.stats, null);
    february.resolve({ month: '2026-02' });
    assert.equal(await latest, true);
    assert.equal(c.loading, false);
    assert.equal(c.selectedMonth, '2026-02');
  }
});

test('empty and failed month lists release their loading state', async () => {
  for (const fail of [false, true]) {
    const loading = [];
    const c = await controller({ get: async () => {
      if (fail) throw new Error('month list failed');
      return { months: [] };
    } }, { monthsLoading: value => loading.push(value) });
    assert.equal(await c.loadMonths(), !fail);
    assert.equal(c.loading, false);
    assert.deepEqual(loading, [true, false]);
    assert.equal(c.stats, null);
  }
});

test('disposed statistics cannot publish a delayed visual commit', async () => {
  let publish;
  const selected = [];
  const c = await controller({ get: async () => ({ month: '2026-01' }) }, {
    selectedMonthChanged: month => selected.push(month),
    publishResult: (_stats, commit, current) => { publish = { commit, current }; }
  });
  await c.loadStats('2026-01');
  c.dispose();
  assert.equal(publish.current(), false);
  publish.commit();
  assert.equal(c.stats, null);
  assert.deepEqual(selected, ['2026-01']);
});

test('failed month selection preserves old statistics and retries the requested month', async () => {
  let fail = false;
  const requests = [], selected = [];
  const c = await controller({ get: async path => {
    requests.push(path);
    if (fail) throw new Error('synthetic unavailable');
    return { month: path.split('=')[1] };
  } }, { selectedMonthChanged: month => selected.push(month) });
  await c.loadStats('2026-01');
  fail = true;
  assert.equal(await c.loadStats('2026-02'), false);
  assert.equal(c.stats.month, '2026-01');
  assert.equal(c.selectedMonth, '2026-01');
  assert.equal(selected.at(-1), '2026-01');
  assert.equal(c.pendingMonth, '');
  assert.equal(c.loading, false);
  assert.equal(c.refreshMonth(), '2026-02');
  assert.equal(c.errorMessage, 'synthetic unavailable');
  fail = false;
  assert.equal(await c.refresh(), true);
  assert.equal(requests.at(-1), '/stats?month=2026-02');
  assert.equal(c.stats.month, '2026-02');
  assert.equal(c.selectedMonth, '2026-02');
  assert.equal(c.errorMessage, '');
  assert.equal(c.loading, false);
});
