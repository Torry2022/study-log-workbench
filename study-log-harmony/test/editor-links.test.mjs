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
  assert.equal(markup({ kind: 'heading', date: '2026-09-24', heading: '并发控制', headingId: '2-并发控制' }, ''),
    '[[2026-09-24#2-并发控制|并发控制]]');
  assert.throws(() => markup({ kind: 'day', date: '2026-02-30', heading: null }, ''), /日期无效/);
  assert.throws(() => markup({ kind: 'heading', date: '2026-09-24', heading: '错误#标题' }, ''), /目标标题/);
  assert.throws(() => markup({ kind: 'heading', date: '2026-09-24', heading: '并发控制', headingId: '错误#标识' }, ''), /小节标识/);
  assert.throws(() => markup({ kind: 'day', date: '2026-09-24', heading: null }, '错误|别名'), /显示文字/);
});

test('Harmony log and note links pass an exact id to the reader while retaining the title fallback', async () => {
  const logSource = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
  const indexSource = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  function method(source, name) {
    const start = source.search(new RegExp(`  private (?:async )?${name}\\(`));
    const end = source.slice(start + 1).search(/^  (?:private |@Builder|build\()/m);
    assert.ok(start >= 0 && end >= 0);
    return source.slice(start, start + 1 + end);
  }
  function page(source) {
    const module = { exports: {} };
    runInNewContext(ts.transpileModule(`export class Page { ${source} }`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, { module, exports: module.exports });
    return new module.exports.Page();
  }
  const log = page(method(logSource, 'openInternalLink'));
  log.loadTargetDate = async (_date, apply) => apply();
  await log.openInternalLink('2026-01-15', '2-并发控制');
  assert.equal(log.targetHeading, '2-并发控制');
  assert.equal(log.targetHeadingId, '2-并发控制');
  const index = page(method(indexSource, 'openNoteLink'));
  index.openLogSource = target => { index.target = target; };
  index.openNoteLink('2026-01-15', '2-并发控制');
  assert.equal(index.target.headingId, '2-并发控制');
});
