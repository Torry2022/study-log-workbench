import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
function method(name) {
  const start = source.search(new RegExp(`^  private ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
  assert.ok(end >= 0, name + ' end');
  return source.slice(start, start + 1 + end);
}
const methods = ['toolbarRequiredWidth', 'updateToolbarWidth', 'showToolbarLabels', 'expandedModeSelector', 'documentActionsInHeader', 'editorActionsInHeader'];
const code = ts.transpileModule(`export class Reader { ${methods.map(method).join('\n')} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function reader(editing = true, dateWidth = 190) {
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, toolbarActionWidth: label => 44 + [...label].length * 12 });
  return Object.assign(new module.exports.Reader(), { toolbarStage: 14, headerDateWidth: dateWidth, toolbarMotionWidth: -1, sourceMode: editing, splitMode: false, isWide: () => true });
}

test('native toolbar fits actual date and editor budgets before moving controls to More', () => {
  for (const dateWidth of [120, 155, 190, 230]) for (const editing of [false, true]) {
    const page = reader(editing, dateWidth);
    for (let width = 460 + dateWidth; width <= 1900; width += 3) {
      page.updateToolbarWidth(width);
      assert.ok(page.toolbarRequiredWidth(page.toolbarStage, width) <= width, `${dateWidth}/${editing}/${width}`);
      if (page.toolbarStage > 0) assert.ok(page.toolbarRequiredWidth(page.toolbarStage - 1, width) + 12 > width, 'Do not skip a less compact layout that fits the upgrade margin');
      if (editing && width >= page.toolbarRequiredWidth(8, width) + 12) assert.equal(page.editorActionsInHeader(), true, 'All four editor icons fit: keep them outside More');
      if (page.toolbarStage >= 9) for (const group of ['navigation', 'mode', 'save', 'refresh', 'export', 'backup', 'delete', 'editor']) assert.equal(page.showToolbarLabels(group), false, 'Overflow follows label compaction');
    }
  }
});

test('native label and overflow order preserves navigation, mode and save priority', () => {
  const page = reader();
  const groups = ['navigation', 'mode', 'save', 'refresh', 'export', 'backup', 'delete', 'editor'];
  for (let stage = 0; stage <= 14; stage++) {
    page.toolbarStage = stage;
    const labels = groups.map(group => page.showToolbarLabels(group));
    assert.ok(labels.every((shown, index) => !shown || labels.slice(0, index).every(Boolean)));
    const actions = ['refresh', 'export', 'backup', 'delete'].map(action => page.documentActionsInHeader(action));
    assert.ok(actions.every((shown, index) => !shown || actions.slice(0, index).every(Boolean)));
    if (stage < 9) assert.equal(page.editorActionsInHeader(), true);
    if (stage >= 9) assert.equal(labels.some(Boolean), false);
  }
});

test('native toolbar retains the existing 12vp upgrade hysteresis and immediate shrink', () => {
  const page = reader(); page.toolbarStage = 9;
  const width = page.toolbarRequiredWidth(8, 900);
  page.updateToolbarWidth(width + 6); assert.equal(page.toolbarStage, 9);
  page.updateToolbarWidth(width + 12); assert.ok(page.toolbarStage <= 8);
  page.updateToolbarWidth(width - 1); assert.ok(page.toolbarStage >= 9);
});

test('native panel motion uses its reserved target width for the same toolbar plan', () => {
  const page = reader(); page.toolbarMotionWidth = 760;
  page.updateToolbarWidth(1800);
  assert.equal(page.headerWidth, 760);
  assert.ok(page.toolbarRequiredWidth(page.toolbarStage, 760) <= 760);
});
