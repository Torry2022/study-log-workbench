import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the component's actual event handlers; native dialogs and frame scheduling are controlled here.
const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const names = ['selectedTab', 'selectTab', 'requestModule', 'switchModule', 'confirmNotesLeave', 'confirmQaLeave',
  'openNoteLink', 'openQaCitation', 'openFavorite', 'openStatsEntry'];
const methods = names.map(name => {
  const start = source.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing handler ${name}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/^  (?:private |@Builder|build\()/m);
  assert.ok(end >= 0, `Missing handler boundary ${name}`);
  return source.slice(start, start + 1 + end);
}).join('\n');

function workspace(tab) {
  const dialogs = [], frames = [], targets = [];
  const module = { exports: {} };
  const code = ts.transpileModule(`export class Workspace { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, $r: value => value,
    AlertDialog: { show: value => dialogs.push(value) },
    appFeedback: { show() {}, dismissScope() {} }, Curve: { EaseOut: 0 },
    FrameAction: class { constructor(action) { this.action = action; } } });
  const page = new module.exports.Workspace();
  Object.assign(page, {
    selectedModule: tab, moduleRequestedTab: -1, moduleSwitchRevision: 0, noteDiscardRevision: 0, qaDiscardRevision: 0,
    targetRevision: 0, savedText: 'saved', dirty: false,
    isWide: () => false, closeNavigation() {}, closeOutline() {}, closeSearch() {},
    readingTransition: { clear() {} }, workspaceTransition: { clear() {}, finish() {} },
    qaNavigation: { loadQaNavigation() {} },
    confirmDiscard: action => action(),
    getUIContext: () => ({ postFrameCallback: frame => frames.push(frame.action),
      animateTo: (options, action) => { action(); options.onFinish?.(); } }),
    loadTargetDate: async (date, action) => { targets.push(date); action(); }
  });
  return { page, dialogs, frames, targets };
}

test('note source navigation preserves its module and draft until leave is accepted', () => {
  const { page, dialogs, targets } = workspace(1);
  page.notesDirty = true;
  page.openNoteLink('2026-01-15', 'sample');
  assert.equal(page.selectedModule, 1);
  assert.equal(targets.length, 0);
  dialogs[0].primaryButton.action();
  assert.equal(page.selectedModule, 1);
  assert.equal(page.notesDirty, true);
  page.openNoteLink('2026-01-15', 'sample');
  dialogs[1].secondaryButton.action();
  assert.equal(page.selectedModule, 0);
  assert.equal(page.noteDiscardRevision, 1);
  assert.deepEqual(targets, ['2026-01-15']);
  assert.equal(page.targetHeading, 'sample');
});

test('citation navigation is blocked while streaming and protects pending answers', () => {
  const { page, dialogs, targets } = workspace(3);
  page.qaBusy = true;
  page.openQaCitation('2026-01-15', 'sample', 2);
  assert.equal(page.selectedModule, 3);
  assert.equal(targets.length, 0);
  page.qaBusy = false;
  page.qaPending = true;
  page.openQaCitation('2026-01-15', 'sample', 2);
  dialogs[0].primaryButton.action();
  assert.equal(page.selectedModule, 3);
  assert.equal(page.qaPending, true);
  page.openQaCitation('2026-01-15', 'sample', 2);
  dialogs[1].secondaryButton.action();
  assert.equal(page.selectedModule, 0);
  assert.equal(page.qaDiscardRevision, 1);
  assert.equal(page.targetHeadingIndex, 2);
});

test('favorite and statistics sources use the same module transition as navigation', () => {
  for (const tab of [2, 4]) {
    const { page, frames, targets } = workspace(tab);
    if (tab === 2) page.openFavorite({ date: '2026-01-15', exists: true, headingText: 'sample', headingId: 'h2' });
    else page.openStatsEntry({ date: '2026-01-15', rawHeading: 'sample', headingIndex: 2 });
    assert.equal(page.selectedModule, 0);
    assert.equal(page.outgoingTab, tab);
    assert.equal(page.moduleReveal, 0);
    assert.deepEqual(targets, ['2026-01-15']);
    frames[0]();
    assert.equal(page.moduleReveal, 1);
    assert.equal(page.outgoingTab, -1);
  }
});

test('server leave checks do not change modules before the final action', () => {
  const { page, dialogs } = workspace(3);
  page.notesDirty = true;
  let changed = false;
  page.confirmQaLeave(() => page.confirmNotesLeave(() => { changed = true; }));
  assert.equal(page.selectedModule, 3);
  dialogs[0].primaryButton.action();
  assert.equal(changed, false);
  assert.equal(page.selectedModule, 3);
});

test('late module capture cannot override a newer module selection', async () => {
  const { page } = workspace(0);
  const releases = [];
  page.isWide = () => true;
  page.workspaceTransition.cover = () => new Promise(resolve => releases.push(resolve));
  const old = page.switchModule(1, false, false);
  const latest = page.switchModule(4, false, false);
  releases[1]();
  await latest;
  releases[0]();
  await old;
  assert.equal(page.selectedModule, 4);
});

test('clicking the current module cancels an in-flight departure through the actual tab entrypoint', async () => {
  const { page } = workspace(0);
  const releases = [];
  page.isWide = () => true;
  page.workspaceTransition.cover = () => new Promise(resolve => releases.push(resolve));
  page.selectTab(1);
  page.selectTab(0);
  assert.equal(releases.length, 2, 'return to the current module must supersede pending departure');
  releases[1]();
  await new Promise(resolve => setImmediate(resolve));
  releases[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.selectedModule, 0);
  assert.equal(page.moduleRequestedTab, -1);
});
