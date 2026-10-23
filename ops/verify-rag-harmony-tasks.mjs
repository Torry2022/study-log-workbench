import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { initialize } from './instance.mjs';
import { startHttpServer } from '../study-log-mcp/src/http-server.mjs';
import { activeInstance } from '../study-log-harmony/entry/src/main/ets/common/network/InstanceConfig.ts';
import { loadQaTasks, qaView } from '../study-log-harmony/test/qa-task-fixture.mjs';
import { RagTaskClient } from '../study-log-web/lib/rag-task-client.ts';

// Real native protocol/controller/ApiClient source, with RCP and device preferences
// bridged to Node for HTTP integration. This is not device or native layout acceptance.
const repo = path.resolve(import.meta.dirname, '..'), root = path.join(repo, '.local', `rag-harmony-tasks-${Date.now()}`), instance = path.join(root, 'instance');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8')), data = path.join(instance, 'data');
const source = '## 2026-09-01\n\n### 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const sourceFile = path.join(data, '2026-09_学习日志.md'); await fs.writeFile(sourceFile, source);
const report = { root, checks: [], requests: [], modelRequests: [], errors: [], paidModelCalls: 0, deviceVerified: false };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 20000) {
  const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(40); }
}
let web, base, token, streams = 0, active = 0, peak = 0, serverLog = '', current, losePost = false, heldRead, disconnectNextEvent = false;
const waiting = new Map(), clients = [];
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw); report.modelRequests.push({ stream: input.stream === true, model: input.model });
  if (!input.stream) {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); return;
  }
  const n = ++streams; active++; peak = Math.max(peak, active); waiting.set(n, res); res.setHeader('content-type', 'text/event-stream');
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `合成回答${n}：先确认内容` }, finish_reason: null }] })}\n\n`);
  res.once('close', () => { waiting.delete(n); active--; });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const finish = (n, fail = false) => {
  const res = waiting.get(n); assert.ok(res, `model ${n} is waiting`);
  res.end(fail ? `data: ${JSON.stringify({ error: { message: 'synthetic provider failure' } })}\n\n` :
    `data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`);
};
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-native-task-mcp',
  retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
const portProbe = http.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
base = `http://127.0.0.1:${port}/study-log/api`;
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const call = async (route, method = 'GET', body, status = 200) => {
  const response = await fetch(base + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
};
const readTask = async id => (await call(`/rag/tasks/${id}`)).task;
const complete = id => until(() => readTask(id), task => !['running', 'queued'].includes(task.state) && (task.state !== 'succeeded' || task.saveState !== 'pending'));
const taskInput = (sessionId = randomUUID(), version = null) => ({ submissionId: randomUUID(), sessionId, baseVersion: version, question: '合成保存应如何操作？', mode: 'logs_only' });
const createTask = async input => (await call('/rag/tasks', 'POST', input)).task;

async function startWeb() {
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...environment, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
    CHAT_API_URL: `http://127.0.0.1:${model.address().port}/chat`, CHAT_API_KEY: 'synthetic-native-model-key', CHAT_MODEL: 'synthetic-native-model', CHAT_LIGHT_MODEL: 'synthetic-native-model',
    STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-native-task-mcp', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' } });
  web.stdout.on('data', value => serverLog += value); web.stderr.on('data', value => serverLog += value);
  await until(async () => fetch(base + '/auth/app-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: environment.APP_PASSWORD }) }).then(r => r.json()).catch(() => ({})), result => { if (result.token) { token = result.token; return true; } return false; });
}
async function stopWeb() {
  if (web && web.exitCode === null && web.signalCode === null) { const closed = once(web, 'close'); web.kill(); await closed; }
}
try {
  await startWeb();
  const capabilities = await call('/capabilities'); activeInstance.activate(`http://127.0.0.1:${port}`, 'synthetic-native-instance', capabilities);
  const ts = createRequire(new URL('../study-log-harmony/package.json', import.meta.url))('typescript');
  const sourceApi = await fs.readFile(path.join(repo, 'study-log-harmony/entry/src/main/ets/common/network/ApiClient.ets'), 'utf8');
  const module = { exports: {} };
  const rcp = { Request: class { constructor(url, method, headers, body) { Object.assign(this, { url, method, headers, body }); } },
    createSession(configuration) {
      const requests = new Map(); return {
        async fetch(request) {
          const url = new URL(request.url); assert.equal(url.origin, `http://127.0.0.1:${port}`, 'native bridge can only access its synthetic loopback service');
          const controller = new AbortController(); requests.set(request, controller);
          report.requests.push({ method: request.method, path: url.pathname, instance: request.headers['X-Study-Log-Instance'] || '' });
          const response = await fetch(url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
          const handler = configuration?.requestConfiguration?.tracing?.httpEventsHandler;
          const chunks = [];
          for await (const chunk of response.body) {
            chunks.push(chunk); handler?.onDataReceive?.(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
            if (disconnectNextEvent && url.pathname.endsWith('/events')) { disconnectNextEvent = false; controller.abort(); throw Error('synthetic task observation disconnect'); }
          }
          const bytes = Buffer.concat(chunks), value = { statusCode: response.status, body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), toString: () => bytes.toString('utf8') };
          if (request.method === 'POST' && url.pathname.endsWith('/rag/tasks') && losePost) { losePost = false; throw Error('synthetic acknowledgement lost'); }
          if (heldRead?.path === url.pathname) { const hold = heldRead; heldRead = undefined; hold.started(); await hold.gate; }
          return value;
        }, cancel(request) { requests.get(request)?.abort(); }, close() {}
      };
    } };
  runInNewContext(ts.transpileModule(sourceApi, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, Error, Date, JSON, ArrayBuffer, Uint8Array, require(name) {
      if (name === '@kit.RemoteCommunicationKit') return { rcp };
      if (name === '@kit.ArkTS') return { util: { TextDecoder: { create: () => { const decoder = new TextDecoder(); return { decodeToString: (bytes, options) => decoder.decode(bytes, options) }; } } } };
      if (name === './InstanceConfig') return { activeInstance };
      if (name === './ReadCancellation') return {};
      throw Error(`Unexpected native import ${name}`);
    } });
  const api = new module.exports.ApiClient(); api.setToken(token);
  const runtime = await loadQaTasks(module.exports), pendingFile = path.join(root, 'pending-native.json');
  await fs.writeFile(pendingFile, '[]');
  const storage = { read: () => fs.readFile(pendingFile, 'utf8'), write: raw => fs.writeFile(pendingFile, raw) };
  const native = async () => {
    const client = new runtime.QaTaskClient(api, storage, capabilities.instanceId), controller = new runtime.QaSessionController(api, qaView(), client);
    clients.push(controller); controller.activate(); await client.connect(); return { client, controller };
  };
  current = await native(); current.controller.question = '合成保存应如何操作？'; const n1 = streams + 1; await current.controller.send(); const sid = current.controller.sessionId;
  await until(() => streams, n => n >= n1);
  await until(() => current.controller.messages.at(-1)?.content || '', text => text.includes(`合成回答${n1}`));
  assert.equal(current.controller.sending, true); assert.ok(waiting.has(n1), 'native text arrives while model is still held open');
  record('native actual GET events expose first answer fragments before model completion');
  current.controller.dispose(); finish(n1); await complete((await call('/rag/tasks')).tasks.find(task => task.sessionId === sid).id);
  current = await native(); await current.controller.openSession(sid); assert.equal(current.controller.messages.length, 2); assert.ok(current.controller.messages[1].citations.length); assert.equal(streams, n1);
  record('native source submits once, disconnects, then reopens the server-saved cited answer');
  await until(() => ({ sending: current.controller.sending, loading: current.controller.sessionLoading, saving: current.controller.taskSaving, blocked: current.controller.taskBlocked, saveError: current.controller.taskSaveError }), value => !value.sending && !value.loading && !value.saving && !value.blocked && !value.saveError);
  const onNativeChange = current.client.onChange; report.connectionErrors = [];
  current.client.onChange = () => { if (current.client.connectionError) report.connectionErrors.push(current.client.connectionError); onNativeChange(); };
  disconnectNextEvent = true; const continuous = streams + 1;
  current.controller.question = '合成保存下一次如何操作？'; await current.controller.send();
  await until(() => current.controller.messages.at(-1)?.content || '', text => text.includes(`合成回答${continuous}`));
  await until(() => report.connectionErrors.length, value => value > 0);
  const accepted = current.client.tasks.find(task => task.sessionId === sid && task.state === 'running'); assert.ok(accepted);
  await current.client.refresh();
  await until(() => current.client.connectionError, value => value === '');
  assert.equal(streams, continuous); assert.ok(waiting.has(continuous));
  assert.ok(current.controller.messages.at(-1).content.includes(`合成回答${continuous}`));
  await current.controller.stop(); await until(() => readTask(accepted.id), value => value.state === 'cancelled');
  await current.client.refresh(); assert.equal(current.controller.sending, false);
  record('continuous native question reconnects the same observed task without duplicate execution and stops explicitly');


  const local = new Map(), createWebClient = () => new RagTaskClient(capabilities.instanceId, { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    { task() {}, pending() {}, rejected(_input, error) { throw error; }, missing() {}, error() {} }, async (route, init = {}) => {
      const response = await fetch(base + route.replace('/api', ''), { ...init, headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
      assert.equal(response.status, 200); return response.json();
    });
  const webClient = createWebClient();
  const saved = (await call(`/rag/sessions/${sid}`)).session, n2 = streams + 1;
  await webClient.submit({ ...taskInput(sid, saved.version), createdAt: new Date().toISOString() }); await until(() => streams, n => n >= n2);
  await current.client.refresh(); await current.controller.openSession(sid); assert.equal(current.controller.sending, true); webClient.stop(); finish(n2);
  await until(async () => { await current.client.refresh(); return current.controller.messages.length; }, n => n === 4);
  record('an independent web protocol client starts a task and native discovery follows it through server save');

  await current.controller.newSession(); current.controller.question = '合成保存甲如何操作？'; const qa = streams + 1; await current.controller.send(); const firstSid = current.controller.sessionId;
  await until(() => streams, n => n >= qa); await current.controller.newSession(); current.controller.question = '合成保存乙如何操作？'; await current.controller.send(); const secondSid = current.controller.sessionId;
  assert.notEqual(firstSid, secondSid); assert.equal(streams, qa); assert.equal(current.controller.sending, true); finish(qa);
  await until(() => streams, n => n > qa); finish(qa + 1);
  await until(async () => (await call('/rag/tasks')).tasks.filter(task => [firstSid, secondSid].includes(task.sessionId)).every(task => task.saveState === 'saved'), Boolean);
  record('native switches sessions during execution and queues a second task under the shared execution limit');

  await current.controller.newSession(); current.controller.question = '合成保存确认响应丢失'; losePost = true; const lost = streams + 1; await current.controller.send(); const lostSid = current.controller.sessionId;
  await until(() => streams, n => n >= lost); assert.ok(JSON.parse(await storage.read()).length); current.controller.dispose(); finish(lost);
  await until(async () => (await call('/rag/tasks')).tasks.find(task => task.sessionId === lostSid)?.saveState, value => value === 'saved');
  current = await native(); await current.controller.openSession(lostSid); assert.equal(current.client.pending.length, 0); assert.equal(streams, lost);
  record('native pending identity survives acknowledgement loss and reopening without a repeated model call');

  const baseline = (await call(`/rag/sessions/${sid}`)).session, backup = path.join(instance, 'backups', 'rag-sessions'), kept = path.join(instance, 'backups', 'rag-sessions-kept');
  assert.ok(backup.startsWith(instance + path.sep) && kept.startsWith(instance + path.sep)); await fs.rename(backup, kept); await fs.writeFile(backup, 'synthetic save blocker');
  const oldError = await createTask(taskInput(sid, baseline.version)); await until(() => waiting.size, Boolean); finish(streams); assert.equal((await complete(oldError.id)).saveState, 'error');
  const newError = await createTask(taskInput(sid, baseline.version)); await until(() => waiting.size, Boolean); finish(streams); assert.equal((await complete(newError.id)).saveState, 'error');
  await fs.unlink(backup); await fs.rename(kept, backup);
  await current.client.refresh(); await current.controller.openSession(sid);
  assert.equal(current.controller.answerMessages().find(message => message.taskId === oldError.id)?.content, (await readTask(oldError.id)).result.answer);
  assert.equal(current.controller.answerMessages().find(message => message.taskId === oldError.id)?.canSave, true);
  const beforeSave = streams, requestsBefore = report.requests.length; await current.controller.saveAnswer(oldError.id); assert.equal((await readTask(oldError.id)).saveState, 'saved');
  assert.equal((await readTask(newError.id)).saveState, 'error'); assert.equal(streams, beforeSave); assert.ok(report.requests.slice(requestsBefore).some(value => value.path.endsWith(`/${oldError.id}/save`)));
  const versionBeforeDiscard = (await call(`/rag/sessions/${sid}`)).session.version; await current.controller.discardTask(newError.id);
  assert.equal((await call(`/rag/sessions/${sid}`)).session.version, versionBeforeDiscard); await call(`/rag/tasks/${newError.id}`, 'GET', undefined, 404);
  record('two actual save failures remain inline; native retries or discards only the addressed answer without generation');

  const version = (await call(`/rag/sessions/${sid}`)).session.version, conflict = await createTask(taskInput(sid, version)); await until(() => waiting.size, Boolean);
  const renamed = (await call(`/rag/sessions/${sid}`, 'PATCH', { mutationId: randomUUID(), baseVersion: version, title: '另一端修改的合成标题' })).session;
  finish(streams); assert.equal((await complete(conflict.id)).saveState, 'conflict');
  const newer = await createTask(taskInput(sid, renamed.version)); await until(() => waiting.size, Boolean); finish(streams); assert.equal((await complete(newer.id)).saveState, 'saved');
  current.controller.dispose(); current = await native(); await current.controller.openSession(sid);
  const conflictAnswer = current.controller.answerMessages().find(message => message.taskId === conflict.id);
  assert.ok(conflictAnswer); assert.equal(conflictAnswer.canSave, false); assert.equal(conflictAnswer.saveError.length > 0, true);
  record('native reopening discovers a historical conflict beside a later saved answer and exposes no overwrite action');

  await current.controller.newSession(); current.controller.question = '合成保存停止与失败'; const cancel = streams + 1; await current.controller.send(); const cancelSid = current.controller.sessionId;
  await until(() => streams, value => value >= cancel); current.controller.stop(); await until(() => active, value => value === 0); await current.client.refresh(); assert.equal(current.controller.taskCanRetry, true);
  const failed = streams + 1; await current.controller.retryTask(); await until(() => streams, value => value >= failed); finish(failed, true);
  await until(async () => { await current.client.refresh(); return current.controller.taskCanRetry && !current.controller.sending; }, Boolean);
  assert.equal((await call(`/rag/sessions/${cancelSid}`, 'GET', undefined, 404)).code, 'RAG_SESSION_NOT_FOUND'); const beforeRetry = streams;
  await current.controller.retryTask(); await until(() => streams, value => value > beforeRetry); finish(streams);
  await until(async () => (await call('/rag/tasks')).tasks.find(task => task.sessionId === cancelSid && task.saveState === 'saved'), Boolean);
  record('native stop aborts the selected upstream call, failure stays unsaved and only explicit retry regenerates');

  // A retry creates a new execution, but must retain whether the original web
  // submission replaces the final pair or appends. Verify the real JSON outcome.
  report.retrySemantics = [];
  for (const state of ['failed', 'interrupted', 'cancelled']) for (const replaceLast of [true, false]) {
    const before = (await call(`/rag/sessions/${sid}`)).session;
    assert.ok(before.messages.length >= 4);
    const originalInput = { ...taskInput(sid, before.version), replaceLast,
      question: replaceLast ? before.messages.at(-2).content : `合成保存普通追加${state}` };
    const originatingWeb = createWebClient(), originalStream = streams + 1;
    await originatingWeb.submit({ ...originalInput, createdAt: new Date().toISOString() }); originatingWeb.stop();
    const original = (await call('/rag/tasks')).tasks.find(task => task.submissionId === originalInput.submissionId); assert.ok(original);
    await until(() => streams, value => value >= originalStream);
    if (state === 'failed') finish(originalStream, true);
    else if (state === 'cancelled') { await call(`/rag/tasks/${original.id}/cancel`, 'POST', {}); await until(() => active, value => value === 0); }
    else { await stopWeb(); await until(() => active, value => value === 0); await startWeb(); }
    assert.equal((await complete(original.id)).state, state);
    assert.deepEqual((await call(`/rag/sessions/${sid}`)).session.messages, before.messages);
    // A fresh native viewer retries the latest failed web task, while older
    // retained results remain readable beside their own question.
    current.controller.dispose(); current = await native(); await current.controller.openSession(sid); assert.equal(current.controller.taskCanRetry, true);
    await until(() => ({ loading: current.controller.sessionLoading, blocked: current.controller.taskBlocked, saving: current.controller.taskSaving }), value => !value.loading && !value.saving);
    const retryStream = streams + 1, priorIds = new Set(current.client.tasks.map(task => task.id)); await current.controller.retryAnswer(`${original.id}`);
    const retriedId = current.client.tasks.find(task => task.sessionId === sid && !priorIds.has(task.id))?.id; assert.ok(retriedId); assert.notEqual(retriedId, original.id);
    const retried = await readTask(retriedId); assert.equal(retried.replaceLast, replaceLast); assert.equal(retried.question, originalInput.question);
    await until(() => streams, value => value >= retryStream); finish(retryStream); assert.equal((await complete(retriedId)).saveState, 'saved');
    const after = (await call(`/rag/sessions/${sid}`)).session, prefix = replaceLast ? before.messages.slice(0, -2) : before.messages;
    assert.equal(after.messages.length, before.messages.length + (replaceLast ? 0 : 2));
    assert.deepEqual(after.messages.slice(0, prefix.length), prefix); assert.equal(after.messages.at(-2).content, originalInput.question);
    assert.equal(after.messages.at(-2).id, retried.questionMessageId);
    assert.equal(after.messages.at(-1).content, (await readTask(retriedId)).result.answer); assert.equal((await readTask(original.id)).state, state);
    report.retrySemantics.push({ state, replaceLast, beforeMessages: before.messages.length, afterMessages: after.messages.length, prefixUnchanged: true });
    record(`web ${replaceLast ? 'regeneration' : 'append'} task ${state}: native retry preserves intent and saved JSON prefix`);
  }

  await current.client.refresh(); await current.controller.openSession(sid);
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve);
  heldRead = { path: `/study-log/api/rag/tasks/${conflict.id}`, gate, started };
  const reading = current.client.read(conflict.id); await start; const deleting = (await call(`/rag/sessions/${sid}`)).session;
  await call(`/rag/sessions/${sid}`, 'DELETE', { mutationId: randomUUID(), baseVersion: deleting.version }); await current.client.refresh();
  await until(() => current.controller.sessionId, id => id === ''); release(); await reading; assert.equal(current.controller.messages.length, 0);
  assert.ok(!current.controller.sessions.some(session => session.id === sid));
  record('a real cross-client delete removes native retained results before releasing an older successful HTTP response');

  assert.ok(!report.requests.some(value => ['POST', 'PUT'].includes(value.method) && /\/rag\/sessions(?:\/[^/]+)?$/.test(value.path)), 'durable native path never saves a session from the client');
  report.durableClientSessionWrites = 0;
  assert.ok(report.requests.filter(value => value.path.includes('/rag/tasks')).every(value => value.instance === capabilities.instanceId));
  current.controller.dispose();
  const olderCapabilities = { ...capabilities, features: { ...capabilities.features } }; delete olderCapabilities.features.ragTasks;
  activeInstance.activate(`http://127.0.0.1:${port}`, 'synthetic-legacy-instance', olderCapabilities);
  const connectionModule = { exports: {} }, connectionSource = await fs.readFile(path.join(repo, 'study-log-harmony/entry/src/main/ets/features/qa/QaTaskConnection.ets'), 'utf8');
  const connectionDependencies = { '../../common/network/ApiClient': { apiClient: api }, '../../common/network/InstanceConfig': { activeInstance },
    '../../common/storage/InstanceStore': { instanceStore: { readQaPending: async () => assert.fail('legacy path has no pending task store'), writeQaPending: async () => assert.fail('legacy path has no pending task store') } },
    './QaTaskClient': { QaTaskClient: runtime.QaTaskClient } };
  runInNewContext(ts.transpileModule(connectionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: connectionModule, exports: connectionModule.exports, require: name => connectionDependencies[name] });
  const legacyConnection = connectionModule.exports.createQaTaskConnection(); assert.equal(legacyConnection, undefined);
  const legacy = new runtime.QaSessionController(api, qaView(), legacyConnection); clients.push(legacy);
  const legacyStart = report.requests.length, legacyStream = streams + 1; legacy.question = '合成保存旧接口'; const legacySend = legacy.send();
  await until(() => streams, value => value >= legacyStream); finish(legacyStream); await legacySend;
  assert.equal(legacy.messages.length, 2); assert.equal((await call(`/rag/sessions/${legacy.sessionId}`)).session.messages.length, 2);
  report.legacyClientSessionWrites = report.requests.slice(legacyStart).filter(value => value.method === 'POST' && value.path.endsWith('/rag/sessions')).length;
  assert.equal(report.legacyClientSessionWrites, 1);
  record('absent task capability uses the actual native legacy SSE and one versioned client save');
  assert.equal(await fs.readFile(sourceFile, 'utf8'), source); report.sourceUnchanged = true; report.maxConcurrentModelStreams = peak; assert.equal(peak, 1); report.passed = true;
} catch (error) { report.passed = false; report.errors.push(error.stack || String(error)); throw error; }
finally {
  clients.forEach(controller => controller.dispose()); await stopWeb();
  for (const response of waiting.values()) response.destroy(); await mcp.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}
