import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';



const source = await readFile(new URL('../entry/src/main/ets/app/LoginPage.ets', import.meta.url), 'utf8');
test('the shared home form stays scrollable in both compact and wide layouts', () => {
  const build = source.slice(source.indexOf('  build()'));
  assert.match(build, /if \(this\.wideLayout\(\)\)[\s\S]*this\.identityContent\(true\)/);
  assert.match(build, /if \(!this\.wideLayout\(\)\) this\.mobileWelcome\(\)[\s\S]*this\.accessContent\(\)/);
  assert.match(build, /id\('login_scroll'\).*layoutWeight\(1\).width\('100%'\)/);
  assert.equal((source.match(/Scroll\(this.formScroller\)/g) || []).length, 1);
  assert.match(source, /id\('login_origin_input'\)/);
  assert.match(source, /type\(InputType.Password\)/);
  assert.doesNotMatch(build, /setKeyboardAvoidMode|previousKeyboardAvoidMode|AppModalScrim/);
  assert.match(source, /height\(48\).fontSize\(16\)/);
});

test('password context uses the shared form keyboard policy', () => {
  assert.match(source, /new FormKeyboardContext\(this\.formScroller, 'login_scroll'\)/);
  assert.match(source, /formKeyboard\.focus\(this\.getUIContext\(\), 'login_password_input', 'login_credentials'\)/);
  assert.match(source, /formKeyboard\.reveal\(this\.getUIContext\(\)\)/);
  assert.doesNotMatch(source, /scrollEdge|revealPasswordContext/);
});
