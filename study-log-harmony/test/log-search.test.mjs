import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('Harmony search uses the public literal query, heading scope and case options', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogSearchRepository.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, encodeURIComponent });
  const paths = [];
  const search = new module.exports.LogSearchRepository({ get(path) { paths.push(path); return Promise.resolve({ results: [] }); } });
  await search.search('  C++  ', true, false);
  await search.search('并发', false, true);
  assert.deepEqual(paths, [
    '/search?q=C%2B%2B&ignoreCase=false&scope=heading',
    '/search?q=%E5%B9%B6%E5%8F%91&ignoreCase=true&scope=all'
  ]);
});
