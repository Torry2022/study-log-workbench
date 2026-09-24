import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { activeInstance } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

async function loadEts(name, dependencies = {}) {
  const source = await readFile(new URL(`../entry/src/main/ets/common/network/${name}.ets`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Error, SyntaxError, JSON, Date, ArrayBuffer,
    require(name) { if (!(name in dependencies)) throw new Error(`Missing dependency: ${name}`); return dependencies[name]; }
  });
  return module.exports;
}

test('native requests stay on the selected origin and ignore a late old-instance 401', async () => {
  const pending = [], requests = [], sessions = [];
  const { ApiClient } = await loadEts('ApiClient', {
    '@kit.RemoteCommunicationKit': { rcp: {
      Request: class { constructor(...args) { this.args = args; requests.push(this); } },
      createSession(configuration) { sessions.push(configuration); return {
        fetch: () => new Promise(resolve => pending.push(resolve)), close() {} }; }
    } },
    './InstanceConfig': { activeInstance }
  });
  const client = new ApiClient(); let expired = 0;
  client.setUnauthorizedHandler(() => expired++);
  activeInstance.activate('https://one.example', 'one'); client.setToken('first-token');
  const old = client.get('/notes');
  assert.equal(requests[0].args[0], 'https://one.example/study-log/api/notes');
  assert.equal(requests[0].args[2].authorization, 'Bearer first-token');
  assert.equal(sessions[0].requestConfiguration.transfer.autoRedirect, false);
  activeInstance.activate('https://two.example', 'two'); client.setToken('second-token');
  pending[0]({ statusCode: 401, toString: () => '{}' });
  await assert.rejects(old, /会话已切换/);
  assert.equal(expired, 0);
  assert.equal(client.getToken(), 'second-token');
  const next = client.get('/notes');
  pending[1]({ statusCode: 302, toString: () => '{}' });
  await assert.rejects(next);
  assert.equal(requests[1].args[0], 'https://two.example/study-log/api/notes');
  const previousToken = client.get('/notes');
  client.setToken('replacement-token');
  pending[2]({ statusCode: 401, toString: () => '{}' });
  await assert.rejects(previousToken, /会话已切换/);
  assert.equal(expired, 0);
  client.setToken('');
  const wrongPassword = client.post('/auth/app-login', { password: 'wrong' });
  pending[3]({ statusCode: 401, toString: () => '{"error":"密码错误"}' });
  await assert.rejects(wrongPassword, /密码错误/);
  assert.equal(expired, 0);
  client.setToken('second-token');
  const save = client.put('/logs/day', { date: '2026-09-24', content: '正文', baseVersion: 'v1' });
  assert.equal(requests[4].args[1], 'PUT');
  assert.deepEqual(JSON.parse(requests[4].args[3]),
    { date: '2026-09-24', content: '正文', baseVersion: 'v1' });
  pending[4]({ statusCode: 409, toString: () => '{"error":"日志已变化","code":"LOG_CONFLICT"}' });
  await assert.rejects(save, error => error.statusCode === 409 && error.code === 'LOG_CONFLICT');
  const remove = client.delete('/logs/day', { date: '2026-09-24', baseVersion: 'v2' });
  assert.equal(requests[5].args[1], 'DELETE');
  assert.equal(JSON.parse(requests[5].args[3]).baseVersion, 'v2');
  pending[5]({ statusCode: 200, toString: () => '{"day":{"exists":false,"version":null}}' });
  assert.equal((await remove).day.exists, false);
});

test('multipart uploads use only the active instance and reject a late response after switching', async () => {
  const requests = [], pending = [], sessions = [];
  const { ApiClient } = await loadEts('ApiClient', {
    '@kit.RemoteCommunicationKit': { rcp: {
      Request: class { constructor(...args) { this.args = args; requests.push(this); } },
      MultipartForm: class { constructor(fields) { this.fields = fields; } },
      createSession(configuration) { sessions.push(configuration); return {
        fetch: () => new Promise(resolve => pending.push(resolve)), close() {} }; }
    } },
    './InstanceConfig': { activeInstance }
  });
  const client = new ApiClient(); let expired = 0;
  client.setUnauthorizedHandler(() => expired++);
  activeInstance.activate('https://images-one.example', 'one'); client.setToken('one-token');
  const file = { path: '/cache/test.png', name: 'test.png', contentType: 'image/png' };
  const old = client.postFiles('/assets/upload', [file]);
  assert.equal(requests[0].args[0], 'https://images-one.example/study-log/api/assets/upload');
  assert.equal(requests[0].args[2].authorization, 'Bearer one-token');
  assert.equal(requests[0].args[3].fields.file[0].contentOrPath, file.path);
  assert.equal(sessions[0].requestConfiguration.transfer.autoRedirect, false);
  activeInstance.activate('https://images-two.example', 'two'); client.setToken('two-token');
  pending[0]({ statusCode: 401, toString: () => '{}' });
  await assert.rejects(old, /会话已切换/);
  assert.equal(expired, 0);
  const next = client.postFiles('/assets/upload', [file]);
  assert.equal(requests[1].args[0], 'https://images-two.example/study-log/api/assets/upload');
  assert.equal(requests[1].args[2].authorization, 'Bearer two-token');
  pending[1]({ statusCode: 200, toString: () => '{"assets":[{"markdown":"![image](./assets/image.png)"}]}' });
  assert.equal((await next).assets[0].markdown, '![image](./assets/image.png)');
});

test('export ZIP uses the current instance and does not treat binary data as JSON', async () => {
  const requests = [], pending = [];
  const { ApiClient } = await loadEts('ApiClient', {
    '@kit.RemoteCommunicationKit': { rcp: {
      Request: class { constructor(...args) { this.args = args; requests.push(this); } },
      createSession() { return { fetch: () => new Promise(resolve => pending.push(resolve)), close() {} }; }
    } },
    './InstanceConfig': { activeInstance }
  });
  const client = new ApiClient();
  activeInstance.activate('https://export.example', 'export'); client.setToken('export-token');
  const request = client.download('/export?scope=day&date=2026-09-24');
  assert.equal(requests[0].args[0], 'https://export.example/study-log/api/export?scope=day&date=2026-09-24');
  assert.equal(requests[0].args[2].authorization, 'Bearer export-token');
  const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
  pending[0]({ statusCode: 200, body, toString: () => 'not JSON' });
  assert.deepEqual(Array.from(new Uint8Array(await request)), [0x50, 0x4b, 0x03, 0x04]);
});
