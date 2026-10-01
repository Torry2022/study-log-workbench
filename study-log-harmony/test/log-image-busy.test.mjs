import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const start = source.indexOf('  private async receiveImages(');
const end = source.slice(start + 1).search(/^  private /m);
assert.ok(start >= 0 && end >= 0);
const method = source.slice(start, start + 1 + end);
const module = { exports: {} };
runInNewContext(ts.transpileModule(`export class Page { ${method} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module, exports: module.exports });

test('concurrent image paste reports the original wait message and releases its bookmark', async () => {
  const page = new module.exports.Page();
  let releases = 0;
  Object.assign(page, {
    imageBusy: true, linkOpen: false, backupOpen: false,
    session: { day: {}, selectedDate: '2026-02-05' },
    editor: { release: async () => { releases++; } },
    saveError: ''
  });
  await page.receiveImages({ documentKey: '2026-02-05' }, []);
  assert.equal(page.saveError, '请等待当前图片操作完成');
  assert.equal(releases, 1);
});
