import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const base = new URL('../entry/src/main/ets/', import.meta.url);
const rootSource = await readFile(new URL('pages/Index.ets', base), 'utf8');
const parts = await Promise.all(['app/WorkspaceReadingState.ets', 'app/ReadingTransitionCoordinator.ets'].map(path => readFile(new URL(path, base), 'utf8')));
const names = ['resetReadingMode', 'setLogsReadingMode', 'readingViewportChanged', 'readingViewportReady', 'updateBreakpoint', 'isWide'];
const methods = names.map(name => {
 const start = rootSource.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
 assert.ok(start >= 0, name);
 const end = rootSource.slice(start + 1).search(/^  (?:private |aboutTo|build\()/m);
 return rootSource.slice(start, start + end + 1);
}).join('\n');
const code = ts.transpileModule(parts.map(s => s.replace(/^import .*;\r?\n/gm, '').replace('@Observed', '')).join('\n') + `\nexport class Root { ${methods} }`, {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function fixture(capture = async () => ({ release() {} })) {
 const module = { exports: {} }, animations = [], timers = new Map(); let timerId = 0;
 runInNewContext(code, { module, exports: module.exports, READING_MAX_WIDTH: 1000, Curve: { EaseInOut: 0 },
  WorkspaceBreakpoint: { COMPACT: 'compact', MEDIUM: 'medium', LARGE: 'large', EXTRA_LARGE: 'xl' },
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
 const root = new module.exports.Root();
 Object.assign(root, { reading: new module.exports.WorkspaceReadingState(),
  readingTransition: new module.exports.ReadingTransitionCoordinator(), workspaceBreakpoint: 'large',
  workspaceTransition: {}, selectedModule: 0, workspaceNavigationView: {canRead: () => true, beforeReading() {}},
  getUIContext: () => ({getComponentSnapshot: () => ({get: capture}), animateTo: (options, update) => { update(); animations.push(options); }}) });
 return {root, animations, timers};
}

test('reading mode waits for both animation completion and the renderer before releasing its cover', async () => {
 let released = 0; const {root, animations} = fixture(async () => ({release() {released++;}}));
 root.reading.readingViewportWidth = 800; root.reading.readingViewportHeight = 600;
 const pending = root.setLogsReadingMode(true); await new Promise(resolve => setImmediate(resolve));
 assert.ok(root.readingTransition.snapshot); assert.equal(root.reading.logsReadingMode, false);
 root.readingTransition.rendered(); await pending;
 assert.equal(root.reading.logsReadingMode, true); assert.equal(root.reading.readingProgress, 1);
 root.readingViewportReady(); assert.equal(released, 0);
 animations[0].onFinish(); assert.equal(released, 1); assert.equal(root.readingTransition.animating, false);
 assert.equal(root.reading.workspaceLayoutRevision, 1);
});

test('late reading capture after workspace reset is released without changing the new layout', async () => {
 let finish, released = 0; const {root, animations} = fixture(() => new Promise(resolve => finish = resolve));
 root.reading.readingViewportWidth = 800;
 const pending = root.setLogsReadingMode(true); root.resetReadingMode();
 finish({release() {released++;}}); await pending;
 assert.equal(released, 1); assert.equal(root.reading.logsReadingMode, false); assert.equal(animations.length, 0);
});

test('narrowing the workspace cancels pending reading animation and ignores its late finish', async () => {
 const {root, animations} = fixture(); await root.setLogsReadingMode(true);
 assert.equal(root.reading.logsReadingMode, true); root.updateBreakpoint(500);
 assert.equal(root.reading.logsReadingMode, false); assert.equal(root.reading.readingProgress, 0);
 animations[0].onFinish(); assert.equal(root.reading.workspaceLayoutRevision, 0);
 assert.equal(root.readingTransition.animating, false);
});

test('capture failure still permits reading mode and image geometry keeps original raster dimensions', async () => {
 const {root, animations} = fixture(async () => {throw new Error('capture unavailable');});
 root.reading.readingViewportWidth = 800; await root.setLogsReadingMode(true);
 assert.equal(root.reading.logsReadingMode, true); animations[0].onFinish(); root.readingViewportReady();
 root.reading.workspaceOriginX = 10; root.reading.workspaceOriginY = 20;
 root.reading.readingImageWidth = 800; root.reading.readingImageHeight = 600;
 root.readingTransition.snapshot = {}; root.readingTransition.animating = true;
 root.readingViewportChanged({globalPosition: {x: 110, y: 220}, width: 1200, height: 700});
 assert.equal(root.reading.readingCoverX, 100); assert.equal(root.reading.readingCoverY, 200);
 assert.equal(root.reading.readingCoverWidth, 1200); assert.equal(root.reading.readingImageWidth, 800);
 assert.equal(root.reading.readingImageInset, 100);
});

test('module transitions and feature readiness block competing reading requests', async () => {
 for (const setup of [r => r.workspaceTransition.task = {}, r => r.workspaceTransition.snapshot = {},
  r => r.selectedModule = 1, r => r.workspaceNavigationView.canRead = () => false]) {
  const {root, animations} = fixture(); setup(root); await root.setLogsReadingMode(true);
  assert.equal(root.reading.logsReadingMode, false); assert.equal(animations.length, 0);
 }
});
