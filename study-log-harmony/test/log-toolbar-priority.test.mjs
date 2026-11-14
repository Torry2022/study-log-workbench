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
const names = ['iconHeaderWidth', 'toolbarActionPriority', 'toolbarLabelCost', 'updateToolbarWidth',
  'showToolbarLabels', 'expandedModeSelector', 'documentActionsInHeader', 'editorActionsInHeader', 'desktopActionSlotWidth'];
const code = ts.transpileModule(`export class Reader { ${names.map(method).join('\n')} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const actionWidth = label => 44 + [...label].length * 12;
const actionLabels = { refresh: '刷新中', export: '导出', backup: '历史版本', delete: '删除',
  link: '内部链接', image: '插入图片', discard: '放弃修改', find: '查找替换' };
function reader(mode = 'preview', dateWidth = 144, statsReturnAvailable = false) {
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, toolbarActionWidth: actionWidth });
  return Object.assign(new module.exports.Reader(), { headerWidth: 0, headerDateWidth: dateWidth,
    sourceMode: mode === 'source', splitMode: mode === 'split', statsReturnAvailable, toolbarMotionWidth: -1,
    toolbarHeaderActions: [], toolbarLabelGroups: [], toolbarActionWidths: [], toolbarModesExpanded: false, isWide: () => true });
}

// Sum the real header's nested rows independently of the allocator.
function renderedWidth(h) {
  const gap = h.headerWidth < 440 ? 4 : 8, padding = h.headerWidth < 440 ? 8 : 16;
  const shown = group => h.showToolbarLabels(group);
  const navigation = shown('navigation') ? 2 * (actionWidth('上一篇') - 4) + 8 : 72;
  const statsReturn = h.statsReturnAvailable ? (shown('navigation') ? actionWidth('返回统计') : 32) + 8 : 0;
  const heading = h.headerDateWidth + 8 + gap + navigation + statsReturn + 8;
  const modes = h.expandedModeSelector() ? 3 * (shown('mode') ? actionWidth('浏览') : 34) + 6 : 40;
  const actions = h.toolbarHeaderActions.reduce((sum, action) => sum + (shown(action) ? actionWidth(actionLabels[action]) : 40), 0);
  return 2 * padding + heading + (h.toolbarHeaderActions.length + 4) * gap +
    modes + (shown('save') ? actionWidth('保存中') : 40) + 40 + actions;
}

test('all native modes fit measured date and individual actions before using priority labels', () => {
  for (const mode of ['preview', 'source', 'split']) for (const dateWidth of [120, 144, 190, 230]) {
    for (const stats of [false, true]) {
      const h = reader(mode, dateWidth, stats), priority = Array.from(h.toolbarActionPriority());
      const labels = ['navigation', 'mode', 'save', ...priority];
      let previousActions = priority.length, previousLabels = labels.length, partialEditor = false;
      for (let width = 2000; width >= dateWidth + 300 + (stats ? 40 : 0); width--) {
        h.updateToolbarWidth(width);
        assert.ok(renderedWidth(h) <= width, `${mode}/${dateWidth}/${stats}/${width}: ${renderedWidth(h)}`);
        assert.deepEqual(Array.from(h.toolbarHeaderActions), priority.slice(0, h.toolbarHeaderActions.length));
        assert.deepEqual(Array.from(h.toolbarLabelGroups), labels.slice(0, h.toolbarLabelGroups.length));
        assert.ok(h.toolbarHeaderActions.length <= previousActions);
        assert.ok(h.toolbarLabelGroups.length <= previousLabels);
        if (h.toolbarHeaderActions.length < priority.length) assert.equal(h.toolbarLabelGroups.length, 0);
        if (h.toolbarHeaderActions.length > 4 && h.toolbarHeaderActions.length < 8) partialEditor = true;
        for (const action of priority) {
          const direct = ['link', 'image', 'discard', 'find'].includes(action) ?
            h.editorActionsInHeader(action) : h.documentActionsInHeader(action);
          assert.equal(direct, h.toolbarHeaderActions.includes(action));
          assert.equal(h.desktopActionSlotWidth(action, actionLabels[action]), direct ?
            (h.showToolbarLabels(action) ? actionWidth(actionLabels[action]) : 40) : 0);
        }
        previousActions = h.toolbarHeaderActions.length; previousLabels = h.toolbarLabelGroups.length;
      }
      if (mode !== 'preview') assert.equal(partialEditor, true, 'Never fold all four editor actions when a prefix fits');
    }
  }
});

test('the native toolbar preserves 12vp upgrade hysteresis, immediate shrink and fixed-width stability', () => {
  const h = reader('source'); h.updateToolbarWidth(800);
  const threshold = h.iconHeaderWidth() + 8 * 48;
  h.updateToolbarWidth(threshold + 11); assert.equal(h.toolbarHeaderActions.includes('find'), false);
  h.updateToolbarWidth(threshold + 12); assert.equal(h.toolbarHeaderActions.includes('find'), true);
  h.updateToolbarWidth(threshold); assert.equal(h.toolbarHeaderActions.includes('find'), true);
  h.updateToolbarWidth(threshold - 1); assert.equal(h.toolbarHeaderActions.includes('find'), false);
  for (const mode of ['preview', 'source', 'split', 'preview']) {
    h.sourceMode = mode === 'source'; h.splitMode = mode === 'split'; h.updateToolbarWidth(1100);
    const state = JSON.stringify([h.toolbarHeaderActions, h.toolbarLabelGroups, h.toolbarModesExpanded]);
    for (let n = 0; n < 10; n++) {
      h.updateToolbarWidth(1100);
      assert.equal(JSON.stringify([h.toolbarHeaderActions, h.toolbarLabelGroups, h.toolbarModesExpanded]), state);
      assert.ok(renderedWidth(h) <= 1100);
    }
  }
});

test('native panel motion uses its reserved target width for the same toolbar plan', () => {
  const h = reader('source'); h.toolbarMotionWidth = 760; h.updateToolbarWidth(1800);
  assert.equal(h.headerWidth, 760); assert.ok(renderedWidth(h) <= 760);
});

test('header and desktop More use each editor identity without changing compact touch actions', () => {
  const header = source.slice(source.indexOf('  private editorActions()'), source.indexOf('  private enterReadingButton()'));
  const menu = source.slice(source.indexOf('  private moreActions()'), source.indexOf('  private async applyFormat('));
  for (const action of ['link', 'image', 'discard', 'find']) {
    assert.ok(header.includes(`if (this.editorActionsInHeader('${action}'))`));
    assert.ok(menu.includes(`!this.editorActionsInHeader('${action}')`));
    assert.ok(header.includes(`this.showToolbarLabels('${action}')`));
  }
  assert.doesNotMatch(source, /editorActionsInHeader\(\)|toolbarStage/);
  const compact = source.slice(source.indexOf('  private compactMoreActionContent()'), source.indexOf('  private compactMoreActionsPanel()'));
  for (const label of ['内部链接', '插入图片', '放弃修改', '查找替换']) assert.ok(compact.includes(label));
});
