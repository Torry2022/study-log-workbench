import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

async function controller(transport) {
  const source = await readFile(new URL('../entry/src/main/ets/app/NavigationRefreshController.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports,
    require() { return {}; } });
  return new module.exports.NavigationRefreshController(transport);
}

test('navigation refresh updates lists without replacing the selected document', async () => {
  const requested = [];
  const c = await controller({ get: async path => {
    requested.push(path);
    return path === '/logs/months' ? { months: [{ id: '2026-02' }] } : { days: [{ date: '2026-02-05' }] };
  } });
  const state = { selectedDate: '2026-02-05', document: 'unsaved editor text', months: [], days: [] };
  await c.refresh(0, '2026-02', () => state.selectedDate === '2026-02-05', snapshot => {
    state.months = snapshot.months.months;
    state.days = snapshot.days.days;
  });
  assert.deepEqual(requested, ['/logs/months', '/logs?month=2026-02']);
  assert.equal(state.selectedDate, '2026-02-05');
  assert.equal(state.document, 'unsaved editor text');
  assert.equal(state.days[0].date, '2026-02-05');
});

test('late navigation response cannot replace a newer list', async () => {
  let release;
  const c = await controller({ get: path => path === '/notes' ?
    new Promise(resolve => { release = resolve; }) : Promise.resolve({ favorites: [], groups: [] }) });
  const published = [];
  const old = c.refresh(1, '', () => true, value => published.push(value));
  await c.refresh(2, '', () => true, value => published.push(value));
  release({ years: ['2025'], tags: [], notes: [] });
  await old;
  assert.equal(published.length, 1);
  assert.ok(published[0].favorites);
});
