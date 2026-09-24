import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { activeInstance } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

async function loadRepository() {
  const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogReadRepository.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Map, encodeURIComponent,
    require(name) {
      if (name === '../../common/network/InstanceConfig') return { activeInstance };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  return module.exports.LogReadRepository;
}

test('pending log reads are shared only within one instance and released after failure', async () => {
  const LogReadRepository = await loadRepository();
  const calls = [];
  let sessionRevision = 0;
  const repo = new LogReadRepository({ getSessionRevision: () => sessionRevision, get(path) {
    let resolve; let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    calls.push({ path, resolve, reject });
    return promise;
  } });

  activeInstance.activate('https://one.example', 'one');
  const first = repo.months();
  assert.equal(repo.months(), first);
  assert.equal(calls.length, 1);
  activeInstance.activate('https://two.example', 'two');
  const second = repo.months();
  assert.notEqual(second, first);
  assert.equal(calls.length, 2);
  calls[0].resolve({ months: [{ id: '2026-01' }] });
  await first;
  assert.equal(repo.months(), second, 'old completion must not evict the new request');
  sessionRevision++;
  const newSession = repo.months();
  assert.notEqual(newSession, second, 'new login must not inherit a pending read');
  calls[1].reject(new Error('temporary failure'));
  await assert.rejects(second, /temporary failure/);
  assert.equal(repo.months(), newSession);
  calls[2].reject(new Error('temporary failure'));
  await assert.rejects(newSession, /temporary failure/);
  const retry = repo.months();
  assert.equal(calls.length, 4);
  calls[3].resolve({ months: [] });
  await retry;
});

test('month lists share in-flight reads and day details use the selected date', async () => {
  const LogReadRepository = await loadRepository();
  const calls = [];
  const repo = new LogReadRepository({ getSessionRevision: () => 0, get(path) {
    calls.push(path);
    return Promise.resolve({ days: [] });
  } });
  activeInstance.activate('https://one.example', 'one');
  const first = repo.days('2026-09');
  assert.equal(repo.days('2026-09'), first);
  await first;
  await repo.days('2026-09');
  await repo.day('2026-09-24');
  assert.deepEqual(calls, ['/logs?month=2026-09', '/logs?month=2026-09', '/logs/day?date=2026-09-24']);
});
