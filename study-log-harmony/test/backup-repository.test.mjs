import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('Harmony backup requests use the public paged and two-version restore contract', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/features/logs/BackupRepository.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, encodeURIComponent });
  const calls = [];
  const repo = new module.exports.BackupRepository({
    get(path) { calls.push(['GET', path]); return Promise.resolve({}); },
    post(path, body) { calls.push(['POST', path, body]); return Promise.resolve({}); }
  });
  await repo.list('2026-09-24', 'page+/=');
  await repo.preview('2026-09-24', '2026-09_学习日志.md.1.bak');
  const request = { date: '2026-09-24', kind: 'write', id: 'backup-id',
    baseVersion: null, backupVersion: 'a'.repeat(64) };
  await repo.restore(request);
  assert.equal(calls[0][1], '/backups?date=2026-09-24&cursor=page%2B%2F%3D');
  assert.equal(calls[1][1], '/backups/preview?date=2026-09-24&kind=write&id=2026-09_%E5%AD%A6%E4%B9%A0%E6%97%A5%E5%BF%97.md.1.bak');
  assert.equal(calls[2][0], 'POST');
  assert.equal(calls[2][1], '/backups/restore');
  assert.deepEqual({ ...calls[2][2] }, request);
});
