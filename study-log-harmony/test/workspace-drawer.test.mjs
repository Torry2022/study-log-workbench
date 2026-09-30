import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const methods = ['workspaceShortcutBlocked', 'handleNavigationPanStart', 'handleNavigationPanEnd', 'openNavigation', 'closeNavigation', 'cancelNavigationPan', 'resetNavigationDrawer'].map(name => {
  const start = source.indexOf(`  private ${name}(`);
  assert.ok(start >= 0);
  const end = source.slice(start + 1).search(/^  private /m);
  return source.slice(start, start + 1 + end);
}).join('\n');
function fixture() {
  const module = { exports: {} }, reveals = [], finishes = [], focus = [];
  runInNewContext(ts.transpileModule(`export class Root { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, Curve: { EaseIn: 0 },
    revealPanel: (_context, current, action) => reveals.push(() => { if (current()) action(); }) });
  const root = new module.exports.Root();
  Object.assign(root, { connected: true, modules: {}, qaNavigation: {}, desktopCommands: { blocked: () => false }, selectedModule: 0, workspaceNavigationView: { isLogOutlineOpen: () => false }, isWide: () => false,
    sidebar: { navigationOpen: false, navigationClosing: false, navigationOffset: -340,
      navigationScrimOpacity: 0, navigationMotionRevision: 0 },
    getUIContext: () => ({ animateTo: (options, action) => { action(); finishes.push(options.onFinish); },
      getFocusController: () => ({ requestFocus: id => focus.push(id), clearFocus: () => {} }) }) });
  return { root, reveals, finishes, focus };
}
test('navigation drawer retains reveal, close and focus return on the active narrow workspace', () => {
  const { root, reveals, finishes, focus } = fixture();
  root.openNavigation(); assert.equal(root.sidebar.navigationOpen, true);
  assert.equal(root.sidebar.navigationOffset, -340); reveals.shift()();
  assert.equal(root.sidebar.navigationOffset, 0); assert.equal(root.sidebar.navigationScrimOpacity, 1);
  root.closeNavigation(); assert.equal(root.sidebar.navigationClosing, true); finishes.shift()();
  assert.equal(root.sidebar.navigationOpen, false);
  assert.deepEqual(focus, ['navigation_drawer_close', 'workspace_navigation_open']);
});
test('late drawer reveals and close callbacks cannot focus a different or disconnected workspace', () => {
  for (const invalidate of [r => r.workspaceNavigationView = {}, r => r.workspaceNavigationView = undefined,
    r => r.resetNavigationDrawer()]) {
    const opening = fixture(); opening.root.openNavigation(); invalidate(opening.root); opening.reveals.shift()();
    assert.equal(opening.focus.length, 0);
    const closing = fixture(); closing.root.openNavigation(); closing.reveals.shift()();
    closing.root.closeNavigation(); invalidate(closing.root); closing.finishes.shift()();
    assert.equal(closing.focus.length, 1);
  }
});
test('wide or unbound workspaces do not open the narrow navigation drawer', () => {
  for (const mutate of [r => r.isWide = () => true, r => r.workspaceNavigationView = undefined, r => r.workspaceNavigationView.isLogOutlineOpen = () => true]) {
    const { root, reveals } = fixture(); mutate(root); root.openNavigation();
    assert.equal(root.sidebar.navigationOpen, false); assert.equal(reveals.length, 0);
  }
});

test('original left-edge gesture opens the drawer only for intentional horizontal navigation', () => {
  function start(x) { return { fingerList: [{ localX: x }], offsetX: 0, target: { area: { width: 420 } } }; }
  for (const [x, dx, dy, velocity, expected] of [[70, 80, 10, 0, true], [70, 20, 0, 500, true],
    [200, 80, 0, 0, false], [4, 80, 0, 0, false], [70, 80, 200, 600, false], [70, -80, 0, -600, false]]) {
    const { root } = fixture();
    root.handleNavigationPanStart(start(x));
    root.handleNavigationPanEnd({ offsetX: dx, offsetY: dy, velocityX: velocity });
    assert.equal(root.sidebar.navigationOpen, expected);
    assert.equal(root.navigationGestureActive, false);
  }
  for (const block of [r => r.desktopCommands.blocked = () => true, r => r.helpOpen = true,
    r => r.isWide = () => true, r => r.connected = false]) {
    const { root } = fixture(); block(root); root.handleNavigationPanStart(start(70));
    root.handleNavigationPanEnd({ offsetX: 80, offsetY: 0, velocityX: 0 });
    assert.equal(root.sidebar.navigationOpen, false);
  }
  const { root } = fixture(); root.handleNavigationPanStart(start(70)); root.resetNavigationDrawer();
  root.handleNavigationPanEnd({ offsetX: 80, offsetY: 0, velocityX: 0 });
  assert.equal(root.sidebar.navigationOpen, false);
});
