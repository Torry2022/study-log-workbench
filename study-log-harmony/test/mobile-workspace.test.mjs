import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const base = new URL('../entry/src/main/ets/', import.meta.url);
async function methods(file, names, globals = {}) {
  const source = await readFile(new URL(file, base), 'utf8');
  const selected = names.map(name => {
    const start = source.search(new RegExp(`^  (?:private )?(?:async )?${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    const end = source.indexOf('\n  }', start);
    assert.ok(end > start, name);
    return source.slice(start, end + 4);
  }).join('\n');
  const code = ts.transpileModule(`class Host { ${selected} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(globals), `${code}; return Host;`)(...Object.values(globals));
}

test('content refresh coalesces pulls, settles failure and permits an explicit retry', async () => {
  const feedback = [];
  const Host = await methods('common/ui/ContentRefresh.ets', ['refresh'], {
    appFeedback: { show: (...args) => feedback.push(args), dismissScope() {} }
  });
  let reject, calls = 0;
  const h = Object.assign(new Host(), { alive: true, refreshEnabled: true, inFlight: false,
    refreshing: false, feedbackScope: 'content-refresh', failureText: 'offline',
    onRefresh: () => { calls++; return new Promise((_, fail) => reject = fail); } });
  const first = h.refresh();
  await h.refresh();
  assert.equal(calls, 1);
  reject(new Error('offline')); await first;
  assert.equal(h.refreshing, false);
  assert.equal(h.inFlight, false);
  assert.equal(feedback.length, 1);
  h.onRefresh = async () => calls++;
  await h.refresh();
  assert.equal(calls, 2);
  assert.equal(h.refreshing, false);
});

test('disabled editor content never starts refresh; a removed surface receives no late feedback', async () => {
  let calls = 0, reject;
  const feedback = [];
  const Host = await methods('common/ui/ContentRefresh.ets', ['refresh'], {
    appFeedback: { show: (...args) => feedback.push(args), dismissScope: () => feedback.push('dismiss') }
  });
  const h = Object.assign(new Host(), { alive: true, refreshEnabled: false, inFlight: false,
    refreshing: false, onRefresh: () => { calls++; return new Promise((_, fail) => reject = fail); } });
  await h.refresh(); assert.equal(calls, 0);
  h.refreshEnabled = true;
  const pending = h.refresh();
  h.alive = false;
  reject(new Error('offline')); await pending;
  assert.equal(feedback.length, 0);
  assert.equal(h.inFlight, false);
});

test('drawer only accepts a horizontal pull starting in its edge, never a list-area swipe', async () => {
  const Host = await methods('pages/Index.ets', ['handleNavigationPanStart', 'handleNavigationPanEnd'], {
    WorkspaceTab: { LOGS: 0 }
  });
  const h = Object.assign(new Host(), { connected: true, isWide: () => false, isLargeWorkspace: () => false,
    workspaceShortcutBlocked: () => false, selectedTab: 0, navigationGestureActive: false });
  let opened = 0; h.openNavigation = () => opened++;
  for (const [x, dx, dy, expected] of [[20, 80, 5, 1], [50, 80, 5, 1], [64, 80, 0, 1], [70, 80, 0, 0], [200, 80, 0, 0],
    [20, 80, 100, 0], [20, -80, 0, 0], [4, 80, 0, 0]]) {
    opened = 0;
    h.handleNavigationPanStart({ fingerList: [{ localX: x }], offsetX: 0, target: { area: { width: 400 } } });
    h.handleNavigationPanEnd({ offsetX: dx, offsetY: dy, velocityX: 0 });
    assert.equal(opened, expected, `start=${x}, delta=${dx}/${dy}`);
    assert.equal(h.navigationGestureActive, false);
  }
});

test('drawer rejects non-edge recognition before it can compete with the child list', async () => {
  const Host = await methods('pages/Index.ets', ['judgeNavigationPan', 'handleNavigationPanStart'], {
    WorkspaceTab: { LOGS: 0 }, GestureJudgeResult: { CONTINUE: 'continue', REJECT: 'reject' }
  });
  const h = Object.assign(new Host(), { connected: true, isWide: () => false, isLargeWorkspace: () => false,
    workspaceShortcutBlocked: () => false, selectedTab: 0 });
  const event = (x, dx = 8, dy = 0) => ({ fingerList: [{ localX: x + dx }], offsetX: dx, offsetY: dy,
    target: { area: { width: 400 } } });
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(70)), 'reject');
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(20)), 'continue');
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(50)), 'continue');
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(4)), 'reject');
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(20, -8)), 'reject');
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(20, 8, 12)), 'reject');
  h.isWide = () => true;
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(20)), 'reject');
  h.isWide = () => false; h.workspaceShortcutBlocked = () => true;
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(20)), 'reject');
  assert.equal(h.judgeNavigationPan({ tag: 'child_control' }, event(70)), 'continue');
});

test('workspace drawer precedes child gestures while calendar arrows have no default button padding', async () => {
  const index = await readFile(new URL('pages/Index.ets', base), 'utf8');
  assert.match(index, /\.priorityGesture\(PanGesture\(\{ direction: PanDirection.Horizontal, distance: 1 \}\)[\s\S]*?\.tag\('workspace_drawer'\)/);
  const navigation = await readFile(new URL('app/components/WorkspaceLogNavigation.ets', base), 'utf8');
  for (const arrow of ['‹', '›']) {
    assert.ok(navigation.includes(`Button('${arrow}', { type: ButtonType.Normal }).width(36).height(36).padding(0)`));
  }
});

test('log outline yields the left edge to workspace navigation before recognition', async () => {
  const Host = await methods('features/logs/LogsReaderPage.ets', ['judgeOutlinePan', 'handleOutlinePanStart'], {
    GestureJudgeResult: { CONTINUE: 'continue', REJECT: 'reject' }
  });
  const h = Object.assign(new Host(), { selectedTab: () => 0, sidebar: {}, session: { day: {} },
    logSession: { day: {} }, readerReady: true, outlineHeadings: () => [1], logHeadings: () => [1] });
  const event = x => ({ fingerList: [{ localX: x }], offsetX: 0, target: { area: { width: 400 } } });
  assert.equal(h.judgeOutlinePan({ tag: 'log_outline' }, event(20)), 'reject');
  assert.equal(h.judgeOutlinePan({ tag: 'log_outline' }, event(370)), 'continue');
});


test('secondary note back preserves dirty work and uses the same close guard as the header', async () => {
  let dialog, focusCleared = 0, extractorBacks = 0;
  const Host = await methods('features/notes/NotesPage.ets', ['requestSecondaryBack', 'closeEditor'], {
    AlertDialog: { show: value => dialog = value }, $r: value => value
  });
  const h = Object.assign(new Host(), { data: { saving: false }, continuation: { busy: false },
    imageUploading: false, noteEditor: { editing: true, baseline: 'saved' }, extracting: false,
    extractorBack: () => extractorBacks++, editorValue: () => 'changed', reportDirty() {},
    getUIContext: () => ({ getFocusController: () => ({ clearFocus: () => focusCleared++ }) }) });
  h.requestSecondaryBack();
  assert.equal(h.noteEditor.editing, true);
  assert.ok(dialog); assert.equal(focusCleared, 1);
  dialog.primaryButton.action(); assert.equal(h.noteEditor.editing, true);
  dialog.secondaryButton.action(); assert.equal(h.noteEditor.editing, false);
  h.extracting = true; h.requestSecondaryBack(); assert.equal(extractorBacks, 1);
  h.noteEditor.editing = true; h.data.saving = true; dialog = undefined;
  h.requestSecondaryBack(); assert.equal(h.noteEditor.editing, true); assert.equal(dialog, undefined);
});

test('system dismissal of extraction cannot discard candidates or leave an active request', async () => {
  let dialog, closed = 0;
  const Host = await methods('features/notes/components/NoteCandidateExtractor.ets', ['confirmClose', 'confirmLeave'], {
    AlertDialog: { show: value => dialog = value }, $r: value => value
  });
  const h = Object.assign(new Host(), { backRevision: 1, loading: false, saving: false,
    drafts: [{ title: 'unsaved candidate' }], onClose: () => closed++, onNew() {},
    getUIContext: () => ({ getFocusController: () => ({ clearFocus() {} }) }) });
  h.confirmClose(); assert.equal(closed, 0); assert.ok(dialog);
  dialog.primaryButton.action(); assert.equal(closed, 0); assert.equal(h.drafts.length, 1);
  dialog.secondaryButton.action(); assert.equal(closed, 1);
  h.loading = true; dialog = undefined; h.confirmClose(); assert.equal(closed, 1); assert.equal(dialog, undefined);
  h.loading = false; h.drafts = []; h.confirmClose(); assert.equal(closed, 2);
});

test('compact secondary pages use native covers while preserving the mounted workspace', async () => {
  const notes = await readFile(new URL('features/notes/NotesPage.ets', base), 'utf8');
  assert.match(notes, /if \(this\.isLargeWorkspace\(\) && \(this\.noteEditor\.editing \|\| this\.extracting\)\)/);
  assert.match(notes, /bindContentCover\(this\.noteEditor\.editing \|\| this\.extracting, this\.secondaryPage\(\)/);
  assert.match(notes, /onWillDismiss: \(\) => this\.requestSecondaryBack\(\)/);
  assert.match(notes, /onRegisterBack: \(back: \(\) => void\) => this\.extractorBack = back/);
});


test('history Back cancels a narrow preview before leaving the version list and protects restore', async () => {
  const Host = await methods('features/logs/components/BackupPanel.ets', ['requestBack']);
  let closed = 0, locked = false;
  const h = Object.assign(new Host(), { backRevision: 1, panelWidth: 400, selected: { id: 'old' },
    preview: { id: 'old' }, previewLoading: true, previewRevision: 4, revision: 4,
    restoring: false, busy: () => locked, onClose: () => closed++ });
  h.requestBack();
  assert.equal(h.selected == null, true); assert.equal(h.preview == null, true);
  assert.equal(h.previewLoading, false); assert.equal(closed, 0);
  assert.ok(h.previewRevision === 5 || h.revision === 5);
  h.requestBack(); assert.equal(closed, 1);
  locked = true; h.restoring = true; h.selected = { id: 'keep' };
  h.requestBack(); assert.equal(h.selected.id, 'keep'); assert.equal(closed, 1);
});

test('history narrow navigation is a native cover with a full-height list and explicit detail step', async () => {
  const header = await readFile(new URL('features/logs/components/CompactLogHeader.ets', base), 'utf8');
  assert.match(header, /bindContentCover\(\$\$this.backupOpen/);
  assert.doesNotMatch(header, /bindSheet\(\$\$this.backupOpen/);
  const panel = await readFile(new URL('features/logs/components/BackupPanel.ets', base), 'utf8');
  assert.match(panel, /else if \(this.selected\)/);
  assert.doesNotMatch(panel, /this.panelHeight \* 0.32/);
  assert.match(panel, /id\(`backup_side_\$\{side\}`\)/);
});


test('a preview arriving after Back cannot reopen the history detail', async () => {
  let resolve;
  const pending = new Promise(done => resolve = done);
  const Host = await methods('features/logs/components/BackupPanel.ets', ['selectVersion', 'requestBack'], {
    apiClient: { get: () => pending }, backupTiming() {}
  });
  const h = Object.assign(new Host(), { panelWidth: 400, revision: 0, lifecycle: 0, previewRevision: 0,
    restoring: false, busy: () => false, date: '2026-01-02',
    repository: { preview: () => pending }, onClose() {},
    renderPreview() { assert.fail('obsolete preview must not render'); } });
  const loading = h.selectVersion({ id: 'old', kind: 'write' });
  h.requestBack(); resolve({ preview: { id: 'old' } }); await loading;
  assert.equal(h.selected == null, true); assert.equal(h.preview == null, true);
  assert.equal(h.previewLoading, false);
});


test('statistics groups retain labels, sort years and months, and leave the input intact', async () => {
  const Host = await methods('features/stats/components/StatsNavigation.ets', ['monthYears', 'monthsForYear']);
  const months = [{ id: '2024-12', label: '2024-12' }, { id: '2026-01', label: '2026-01' },
    { id: '2025-03', label: '2025-03' }, { id: '2026-10', label: '2026-10' }];
  const original = JSON.stringify(months);
  const h = Object.assign(new Host(), { statsMonths: months });
  assert.deepEqual(h.monthYears(), ['2026', '2025', '2024']);
  assert.deepEqual(h.monthsForYear('2026').map(month => month.label), ['2026-10', '2026-01']);
  assert.equal(JSON.stringify(months), original);
  h.statsMonths = [];
  assert.deepEqual(h.monthYears(), []);
});
