import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('Harmony internal-link markup matches public target and rejects ambiguous syntax', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/common/editor/EditorLinks.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Date, Number });
  const markup = module.exports.editorLinkMarkup;
  assert.equal(markup({ kind: 'day', date: '2026-09-24', heading: null }, ''), '[[2026-09-24]]');
  assert.equal(markup({ kind: 'heading', date: '2026-09-24', heading: '并发控制' }, '参考  这里'),
    '[[2026-09-24#并发控制|参考 这里]]');
  assert.throws(() => markup({ kind: 'day', date: '2026-02-30', heading: null }, ''), /日期无效/);
  assert.throws(() => markup({ kind: 'heading', date: '2026-09-24', heading: '错误#标题' }, ''), /目标标题/);
  assert.throws(() => markup({ kind: 'day', date: '2026-09-24', heading: null }, '错误|别名'), /显示文字/);
});
