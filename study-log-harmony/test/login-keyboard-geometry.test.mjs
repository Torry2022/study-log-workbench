import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/app/LoginPage.ets', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  private onAvoidAreaChange ='), source.indexOf("  @StorageLink('softwareKeyboardVisible')"));
const lifecycle = source.slice(source.indexOf('  aboutToDisappear(): void {'), source.indexOf('  private startTextureAnimation(): void {'));
assert.ok(callback.includes('topRect.height') && lifecycle.includes('observeTopInset'));
const code = ts.transpileModule(`export class Login { generation = 1; topInset = 0; ${callback} ${lifecycle} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function fixture(getLastWindow) {
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports,
    window: { getLastWindow, AvoidAreaType: { TYPE_SYSTEM: 0 } } });
  const login = new module.exports.Login();
  login.getUIContext = () => ({ getHostContext: () => ({}), px2vp: px => px / 2 });
  return login;
}

test('top viewport extends while initial content keeps its dynamic status-bar inset and full identity', () => {
  const build = source.slice(source.indexOf('  build()'));
  assert.equal((build.match(/expandSafeArea/g) || []).length, 2);
  assert.match(build, /id\('login_scroll'\).*height\(LayoutPolicy.matchParent\).*\r?\n\s*\.ignoreLayoutSafeArea\(\[LayoutSafeAreaType.SYSTEM\], \[LayoutSafeAreaEdge.TOP\]\)/);
  assert.match(build, /constraintSize\(\{ minHeight: '100%' \}\)\.padding\(\{ top: this.topInset \}\)/);
  const identity = source.slice(source.indexOf('  private identityContent('), source.indexOf('  private accessContent('));
  assert.doesNotMatch(identity, /softwareKeyboardVisible|Visibility.None/);
  assert.match(identity, /fontSize\(wide \? 58 : 38\)/);
  assert.match(build, /height\('34%'\)\.constraintSize\(\{ minHeight: 260, maxHeight: 320 \}\)/);
  assert.match(source, /id\('login_origin_input'\)/);
  assert.match(source, /type\(InputType.Password\)/);
  assert.match(build, /\.clip\(true\)\s*\.expandSafeArea\(\[SafeAreaType.SYSTEM\], \[SafeAreaEdge.TOP\]\)/);
  assert.match(build, /\.margin\(\{ bottom: 16 \}\)/);
  assert.match(build, /hitTestBehavior\(HitTestMode.None\)/);
  assert.doesNotMatch(build, /setKeyboardAvoidMode|previousKeyboardAvoidMode/);
  const narrowScroll = build.slice(build.indexOf('Scroll()'), build.indexOf(".id('login_scroll')"));
  assert.match(narrowScroll, /this.accessContent\(false\)[\s\S]*Text\('© 2026 学习日志工作台开源版'\)/);
  assert.match(build, /if \(this.viewportWidth >= 720\) \{\s*Stack\(\{ alignContent: Alignment.Bottom \}\)/);
});

test('status-bar inset updates in vp, ignores keyboard avoid events and removes the exact listener', async () => {
  let handler, removed;
  const main = { getWindowAvoidArea: () => ({ topRect: { height: 96 } }),
    on: (event, fn) => { assert.equal(event, 'avoidAreaChange'); handler = fn; },
    off: (event, fn) => { assert.equal(event, 'avoidAreaChange'); removed = fn; } };
  const login = fixture(async () => main);
  await login.observeTopInset(1);
  assert.equal(login.topInset, 48);
  handler({ type: 1, area: { topRect: { height: 800 } } });
  assert.equal(login.topInset, 48);
  handler({ type: 0, area: { topRect: { height: 120 } } });
  assert.equal(login.topInset, 60);
  login.aboutToDisappear();
  assert.equal(removed, handler);
  assert.equal(login.loginWindow, undefined);
});

test('a window obtained after leaving or re-entering cannot attach an obsolete listener', async () => {
  let resolve, registered = 0;
  const login = fixture(() => new Promise(done => { resolve = done; }));
  const pending = login.observeTopInset(1);
  login.aboutToDisappear();
  login.generation++;
  resolve({ on: () => registered++, getWindowAvoidArea: () => ({ topRect: { height: 96 } }) });
  await pending;
  assert.equal(registered, 0);
  assert.equal(login.topInset, 0);
});

test('a disappearing window does not reject the independent instance restoration lifecycle', async () => {
  const login = fixture(async () => { throw new Error('window gone'); });
  await assert.doesNotReject(login.observeTopInset(1));
  assert.equal(login.loginWindow, undefined);
});
