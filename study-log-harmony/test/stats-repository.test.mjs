import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('Harmony monthly stats uses the public month contract and rejects invalid input', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/features/stats/StatsRepository.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Error, Promise });
  const paths = [];
  const repo = new module.exports.StatsRepository({ get(path) { paths.push(path); return Promise.resolve({ stats: { month: '2026-09' } }); } });
  assert.equal((await repo.month('2026-09')).stats.month, '2026-09');
  assert.deepEqual(paths, ['/stats?month=2026-09']);
  await assert.rejects(repo.month('2026-13'), /统计月份无效/);
  assert.deepEqual(paths, ['/stats?month=2026-09']);
});
