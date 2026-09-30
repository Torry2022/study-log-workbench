import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
function method(name) {
  const start = source.search(new RegExp(`^  private ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.slice(start + 1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
  assert.ok(end >= 0, `Missing ${name} boundary`);
  return source.slice(start, start + 1 + end);
}

test('right panel transition starts with the rendered refresh slot width', () => {
  const code = ts.transpileModule(`export class Reader {
${method('desktopActionSlotWidth')}
${method('beginToolbarMotion')}
}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, Curve: { EaseInOut: 0 },
    toolbarActionWidth: label => 44 + [...label].length * 12
  });
  const reader = new module.exports.Reader();
  Object.assign(reader, {
    toolbarActionWidths: [], toolbarMotionWidth: -1,
    documentActionsInHeader: () => true, showToolbarLabels: () => true,
    updateToolbarWidth() {}, getUIContext: () => ({ animateTo: (_options, update) => update() })
  });
  const rendered = reader.desktopActionSlotWidth('refresh', '刷新中');
  const [initial] = reader.beginToolbarMotion(1000);
  assert.equal(initial[0], rendered);
  assert.equal(reader.desktopActionSlotWidth('refresh', '刷新中'), rendered);
});
