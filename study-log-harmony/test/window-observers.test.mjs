import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await fs.readFile(new URL('../entry/src/main/ets/entryability/EntryAbility.ets', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function setup() {
  const module = { exports: {} }, state = new Map(), calls = [], listeners = new Map();
  let loaded = false, failKeyboard = false, destroyed = false, contentCallback;
  const mainWindow = {
    on(event, callback) {
      if (!loaded || destroyed || (event === 'keyboardHeightChange' && failKeyboard)) throw new Error('1300002');
      calls.push(event); listeners.set(event, callback);
    },
    off(event) { if (destroyed) throw new Error('1300002'); listeners.delete(event); },
    setWindowSystemBarProperties() {},
    getWindowAvoidArea(type) { if (destroyed) throw new Error('1300002'); return { bottomRect: { height: type === 1 ? 24 : 12 } }; }
  };
  const stage = { getMainWindowSync: () => mainWindow, loadContent(_path, callback) { contentCallback = callback; } };
  vm.runInNewContext(code, { module, exports: module.exports, console: { warn() {} },
    UIAbility: class { context = { config: { colorMode: 0 } }; },
    ConfigurationConstant: { ColorMode: { COLOR_MODE_DARK: 1 } },
    deviceInfo: { deviceType: 'tablet' }, DesktopWindow: {},
    window: { AvoidAreaType: { TYPE_SYSTEM: 0, TYPE_NAVIGATION_INDICATOR: 1 } },
    AppStorage: { setOrCreate(key, value) { state.set(key, value); } }
  });
  const ability = new module.exports.default();
  return { ability, stage, calls, listeners, state,
    ready(error = {}) { loaded = true; contentCallback(error); },
    pending: () => !!contentCallback,
    failKeyboard(value) { failKeyboard = value; },
    destroy() { destroyed = true; } };
}

test('window observers wait for loaded content, publish insets and do not duplicate on foreground', async () => {
  const r = setup(); r.ability.onWindowStageCreate(r.stage); r.ability.onForeground();
  assert.deepEqual(r.calls, []); await Promise.resolve();
  assert.deepEqual(r.calls, []); r.ready(); r.ability.onForeground();
  assert.deepEqual(r.calls, ['keyboardHeightChange', 'avoidAreaChange']);
  r.listeners.get('keyboardHeightChange')(280);
  assert.equal(r.state.get('softwareKeyboardHeightPx'), 280);
  assert.equal(r.state.get('windowBottomAvoidPx'), 24);
  r.ability.onWindowStageDestroy();
  assert.equal(r.listeners.size, 0); assert.equal(r.state.get('softwareKeyboardVisible'), false);
  assert.equal(r.state.get('windowBottomAvoidPx'), 0);
});

test('destroyed stages cannot resume deferred theme loading or publish stale content readiness', async () => {
  const before = setup(); before.ability.onWindowStageCreate(before.stage);
  before.ability.onWindowStageDestroy(); await Promise.resolve();
  assert.equal(before.pending(), false);
  const during = setup(); during.ability.onWindowStageCreate(during.stage); await Promise.resolve();
  during.ability.onWindowStageDestroy(); during.ready();
  assert.deepEqual(during.calls, []); assert.equal(during.state.get('windowBottomAvoidPx'), 0);
});

test('abnormal window registration does not crash startup and retries only the failed observer on foreground', async () => {
  const r = setup(); r.failKeyboard(true); r.ability.onWindowStageCreate(r.stage); await Promise.resolve();
  assert.doesNotThrow(() => r.ready()); assert.deepEqual(r.calls, ['avoidAreaChange']);
  r.failKeyboard(false); r.ability.onForeground(); r.ability.onForeground();
  assert.deepEqual(r.calls, ['avoidAreaChange', 'keyboardHeightChange']);
  r.destroy(); assert.doesNotThrow(() => r.listeners.get('avoidAreaChange')());
  assert.doesNotThrow(() => r.ability.onWindowStageDestroy());
  assert.equal(r.state.get('windowBottomAvoidPx'), 0);
});

test('failed content load does not register observers', async () => {
  const r = setup(); r.ability.onWindowStageCreate(r.stage); await Promise.resolve();
  r.ready({ code: 1300002 }); r.ability.onForeground(); assert.deepEqual(r.calls, []);
});
