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
  for (const [x, dx, dy, expected] of [[20, 80, 5, 1], [70, 80, 0, 0], [200, 80, 0, 0],
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
  const event = x => ({ fingerList: [{ localX: x }], offsetX: 0, target: { area: { width: 400 } } });
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(70)), 'reject');
  assert.equal(h.judgeNavigationPan({ tag: 'workspace_drawer' }, event(20)), 'continue');
  assert.equal(h.judgeNavigationPan({ tag: 'child_control' }, event(70)), 'continue');
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
