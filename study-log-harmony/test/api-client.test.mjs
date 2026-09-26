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
    Uint8Array,
    require(name) {
      if (name === '@kit.ArkTS') return { util: { TextDecoder: { create: () => {
        const decoder = new TextDecoder();
        return { decodeToString: (bytes, options) => decoder.decode(bytes, options) };
      } } } };
      if (!(name in dependencies)) throw new Error(`Missing dependency: ${name}`); return dependencies[name];
    }
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
  const group = client.patch('/favorites', { action: 'renameGroup', groupId: 'synthetic', name: '合成分组' });
  assert.equal(requests[6].args[1], 'PATCH');
  assert.equal(JSON.parse(requests[6].args[3]).groupId, 'synthetic');
  pending[6]({ statusCode: 200, toString: () => '{"group":{"id":"synthetic"}}' });
  assert.equal((await group).group.id, 'synthetic');
  const unfavorite = client.delete('/favorites?id=synthetic');
  assert.equal(requests[7].args[1], 'DELETE');
  assert.equal(requests[7].args[3], undefined);
  pending[7]({ statusCode: 200, toString: () => '{"ok":true}' });
  assert.equal((await unfavorite).ok, true);
});

test('transport failures expose one actionable Chinese API error across request types', async () => {
  const { ApiClient } = await loadEts('ApiClient', {
    '@kit.RemoteCommunicationKit': { rcp: {
      Request: class { constructor() {} }, MultipartForm: class { constructor() {} },
      createSession() { return { fetch: () => Promise.reject(new Error("Couldn't connect to server")),
        cancel() {}, close() {} }; }
    } },
    './InstanceConfig': { activeInstance }
  });
  activeInstance.activate('https://offline.example', 'offline');
  const client = new ApiClient();
  const expected = error => error.statusCode === 0 && error.code === 'NETWORK_ERROR' &&
    error.message === '无法连接服务器，请检查网络后重试';
  await assert.rejects(client.get('/notes'), expected);
  await assert.rejects(client.download('/notes/export'), expected);
  await assert.rejects(client.postFiles('/assets/upload', [{ path: '/synthetic.png',
    name: 'synthetic.png', contentType: 'image/png' }]), expected);
  await assert.rejects(client.postStream('/rag/query', { question: 'synthetic' }, () => {}), expected);
});

test('SSE transport accepts only current instance, cancels stale streams and preserves chunks', async () => {
  const requests = [], pending = [], sessions = [];
  const { ApiClient, ApiStreamCancelledError } = await loadEts('ApiClient', {
    '@kit.RemoteCommunicationKit': { rcp: {
      Request: class { constructor(...args) { this.args = args; requests.push(this); } },
      createSession(configuration) { const session = {
        configuration, cancelled: false, closed: false,
        fetch: () => new Promise(resolve => pending.push(resolve)),
        cancel() { session.cancelled = true; }, close() { session.closed = true; }
      }; sessions.push(session); return session; }
    } },
    './InstanceConfig': { activeInstance }
  });
  const client = new ApiClient(); let unauthorized = 0;
  client.setUnauthorizedHandler(() => unauthorized++);
  activeInstance.activate('https://qa-one.example', 'one'); client.setToken('one-token');
  const chunks = [];
  const old = client.postStream('/rag/query', { question: 'synthetic' }, chunk => chunks.push(chunk));
  assert.equal(requests[0].args[0], 'https://qa-one.example/study-log/api/rag/query');
  assert.equal(requests[0].args[2].authorization, 'Bearer one-token');
  assert.equal(sessions[0].configuration.requestConfiguration.transfer.autoRedirect, false);
  sessions[0].configuration.requestConfiguration.tracing.httpEventsHandler.onDataReceive(
    new TextEncoder().encode('event: delta\\ndata: {"text":"A"}\\n\\n').buffer);
  assert.equal(chunks.length, 1);
  activeInstance.activate('https://qa-two.example', 'two'); client.setToken('two-token');
  assert.equal(sessions[0].cancelled, true);
  sessions[0].configuration.requestConfiguration.tracing.httpEventsHandler.onDataReceive(
    new TextEncoder().encode('stale').buffer);
  pending[0]({ statusCode: 401, toString: () => '{}' });
  await assert.rejects(old, error => error instanceof ApiStreamCancelledError);
  assert.equal(chunks.length, 1);
  assert.equal(unauthorized, 0);
  assert.equal(sessions[0].closed, true);
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
