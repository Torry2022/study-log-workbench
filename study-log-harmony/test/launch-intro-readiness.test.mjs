import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/app/LoginPage.ets', import.meta.url), 'utf8');
const start = source.indexOf('  async aboutToAppear(): Promise<void> {');
const end = source.indexOf('  aboutToDisappear(): void {', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`export class Login { ${source.slice(start, end)} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

async function restore(saved, token = '') {
  const calls = [];
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports,
    instanceStore: { async initialize() {}, async restore() { return saved; } },
    activeInstance: { activate() {} },
    TokenStore: { async read() { return token; }, async clear() {} },
    apiClient: { setToken() {}, async get() { return { instanceId: 'synthetic' }; } },
    validCapabilities: () => true,
    ApiError: class extends Error {},
    loginErrorMessage: () => 'restore failed'
  });
  const login = new module.exports.Login();
  Object.assign(login, {
    generation: 0, ready: false, restoreOnAppear: true,
    getUIContext: () => ({ getHostContext: () => ({}) }),
    onInitialReady: () => calls.push('intro-ready'),
    onConnected: () => calls.push('connected')
  });
  await login.aboutToAppear();
  return { login, calls };
}

test('first launch without a saved instance releases the original intro for login', async () => {
  const { login, calls } = await restore(null);
  assert.equal(login.ready, true);
  assert.deepEqual(calls, ['intro-ready']);
});

test('restored connection keeps intro until the log reader reports ready', async () => {
  const { login, calls } = await restore({ origin: 'http://synthetic.local', namespace: 'fixture',
    instanceId: 'synthetic', localHttp: true }, 'synthetic-token');
  assert.equal(login.ready, true);
  assert.deepEqual(calls, ['connected']);
});
