import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { initialize } from './instance.mjs';
import { startHttpServer } from '../study-log-mcp/src/http-server.mjs';

// Requires a current production build. Every source, credential and provider below is isolated/synthetic.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repository, '.local', `rag-task-api-${Date.now()}`);
const instance = path.join(output, 'instance'), data = path.join(instance, 'data');
await fs.mkdir(output, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
const sourceFile = path.join(data, '2026-09_学习日志.md');
await fs.writeFile(sourceFile, '## 2026-09-01\n\n### 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n');
const sourceHash = createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex');
const report = { checks: [], instance, modelRequests: [], errors: [] };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 15000) {
  const started = Date.now();
  while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - started > timeout) throw new Error(`Timed out: ${JSON.stringify(value)}`); await sleep(40); }
}
let web, token, webUrl, modelDelay = 550, streams = 0, active = 0, peak = 0;
const timers = new Set();
const model = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw); report.modelRequests.push({ model: input.model, stream: input.stream === true });
  if (!input.stream) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); return;
  }
  streams++; active++; peak = Math.max(peak, active);
  response.setHeader('content-type', 'text/event-stream');
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '合成保存需要先确认内容' }, finish_reason: null }] })}\n\n`);
  let live = true;
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (!live) return;
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
  }, modelDelay); timers.add(timer);
  response.once('close', () => { if (live) { live = false; active--; clearTimeout(timer); timers.delete(timer); } });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-task-mcp-token',
  retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });

async function freePort() { const s = http.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port; }
async function startWeb() {
  const port = await freePort(); webUrl = `http://127.0.0.1:${port}/study-log/api`;
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: path.join(repository, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...environment, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
      CHAT_API_URL: `http://127.0.0.1:${model.address().port}/chat`, CHAT_API_KEY: 'synthetic-task-model-key', CHAT_MODEL: 'synthetic-task-model', CHAT_LIGHT_MODEL: 'synthetic-task-model',
      STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-task-mcp-token',
      RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false', RAG_DEEPSEEK_THINKING: '' }
  });
  const log = path.join(output, `web-${web.pid}.log`);
  web.stdout.on('data', chunk => { void fs.appendFile(log, chunk); }); web.stderr.on('data', chunk => { void fs.appendFile(log, chunk); });
  await until(async () => { try { return (await fetch(`${webUrl}/auth/app-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: environment.APP_PASSWORD }) })).json(); } catch { return {}; } }, x => { if (x.token) { token = x.token; return true; } return false; });
  assert.equal((await call('/capabilities')).features.ragTasks.configured, true);
}
async function stopWeb() {
  if (!web || web.exitCode !== null || web.signalCode !== null) return;
  const closed = once(web, 'close'); web.kill('SIGTERM'); await closed;
}
async function call(route, method = 'GET', body, expected = 200) {
  const response = await fetch(webUrl + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
const input = overrides => ({ submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成保存应如何操作？', mode: 'logs_only', history: [], ...overrides });
const create = async request => (await call('/rag/tasks', 'POST', request)).task;
const read = async id => (await call(`/rag/tasks/${id}`)).task;
const complete = id => until(() => read(id), x => !['queued', 'running'].includes(x.state) && (x.state !== 'succeeded' || x.saveState !== 'pending'));

try {
  await startWeb();
  assert.equal((await fetch(webUrl + '/rag/tasks')).status, 401);
  await call('/rag/tasks', 'POST', input({ sessionId: '../outside' }), 400);
  record('production startup, real authentication, task readiness and invalid input');

  const firstInput = input(), before = streams, first = await create(firstInput);
  const subscription = await fetch(`${webUrl}/rag/tasks/${first.id}/events`, { headers: { authorization: `Bearer ${token}` } });
  const subscriber = subscription.body.getReader(); assert.ok((await subscriber.read()).value.length); await subscriber.cancel();
  await sleep(900); const finished = await complete(first.id);
  assert.equal(finished.state, 'succeeded'); assert.equal(finished.saveState, 'saved'); assert.equal(streams - before, 1);
  assert.ok(finished.result.citations.length); assert.equal((await call(`/rag/sessions/${firstInput.sessionId}`)).session.messages.length, 2);
  record('all SSE subscriptions disconnected: task completes and server persists cited answer');

  const blockedBackup = path.join(instance, 'backups', 'rag-sessions');
  const retainedBackup = path.join(instance, 'backups', 'rag-sessions-kept');
  assert.ok(blockedBackup.startsWith(instance + path.sep) && retainedBackup.startsWith(instance + path.sep));
  await fs.rename(blockedBackup, retainedBackup);
  await fs.writeFile(blockedBackup, 'synthetic backup failure');
  const saveCalls = streams, unsaved = await create(input()), savedLater = await complete(unsaved.id);
  assert.equal(savedLater.state, 'succeeded'); assert.equal(savedLater.saveState, 'error');
  await fs.unlink(blockedBackup); await fs.rename(retainedBackup, blockedBackup);
  assert.equal((await call(`/rag/tasks/${unsaved.id}/save`, 'POST')).task.saveState, 'saved');
  assert.equal(streams - saveCalls, 1); record('save failure retains complete answer; save retry does not regenerate');

  modelDelay = 60;
  const backgroundWrites = await Promise.all(Array.from({ length: 4 }, () => create(input())));
  for (let i = 0; i < (process.argv.includes('--stress-long') ? 200 : 20); i++) {
    const current = (await call(`/rag/sessions/${firstInput.sessionId}`)).session;
    const responses = await Promise.all(['甲', '乙'].map(label => fetch(`${webUrl}/rag/sessions/${current.id}`, { method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mutationId: randomUUID(), baseVersion: current.version, title: `合成并发标题${label}${i}` }) })));
    const values = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));
    assert.deepEqual(values.map(value => value.status).sort(), [200, 409], JSON.stringify(values));
  }
  await Promise.all(backgroundWrites.map(task => complete(task.id))); modelDelay = 550;
  record('concurrent JSON mutations and background task saves preserve versions without storage errors');

  const duplicateInput = input(), duplicateCalls = streams;
  const [duplicate, repeated] = await Promise.all([create(duplicateInput), create(duplicateInput)]);
  assert.equal(duplicate.id, repeated.id); await complete(duplicate.id);
  assert.equal((await create(duplicateInput)).id, duplicate.id); assert.equal(streams - duplicateCalls, 1);
  await call('/rag/tasks', 'POST', { ...duplicateInput, question: '不同内容' }, 409);
  record('concurrent and late duplicate submissions execute once; mismatched reuse conflicts');

  modelDelay = 1200; const beforeCancel = streams, cancelled = await create(input());
  await until(async () => streams, n => n > beforeCancel);
  const cancelResult = await call(`/rag/tasks/${cancelled.id}/cancel`, 'POST'); assert.equal(cancelResult.task.state, 'cancelled');
  await until(async () => active, n => n === 0); assert.equal((await read(cancelled.id)).state, 'cancelled');
  assert.equal((await call(`/rag/tasks/${first.id}/cancel`, 'POST')).task.state, 'succeeded');
  record('active cancellation aborts provider; completion wins against a late cancel');

  modelDelay = 60000; const delayedCalls = streams, delayed = await create(input());
  await until(() => read(delayed.id), task => task.partial.length > 0);
  await sleep(15000);
  const delayedCancelAt = Date.now();
  assert.equal((await call(`/rag/tasks/${delayed.id}/cancel`, 'POST')).task.state, 'cancelled');
  await until(async () => active, n => n === 0, 5000);
  const delayedDb = new DatabaseSync(path.join(data, 'state/rag-tasks.sqlite'), { readOnly: true });
  try { assert.equal(delayedDb.prepare('SELECT count(*) AS n FROM leases').get().n, 0); } finally { delayedDb.close(); }
  await call(`/rag/sessions/${delayed.sessionId}`, 'GET', undefined, 404);
  assert.equal(streams, delayedCalls + 1);
  report.delayedCancel = { heldMs: 15000, cleanupMs: Date.now() - delayedCancelAt, active, leases: 0 };
  record('cancelling a body held for 15 seconds closes upstream and releases its lease without saving a session');
  modelDelay = 1200;

  const existing = (await call(`/rag/sessions/${firstInput.sessionId}`)).session;
  const editTask = await create(input({ sessionId: existing.id, baseVersion: existing.version }));
  const edited = (await call(`/rag/sessions/${existing.id}`, 'PATCH', { mutationId: randomUUID(), baseVersion: existing.version, title: '另一端修改的合成标题' })).session;
  const editResult = await complete(editTask.id); assert.equal(editResult.state, 'succeeded', JSON.stringify(editResult)); assert.equal(editResult.saveState, 'conflict');
  assert.equal((await call(`/rag/sessions/${existing.id}`)).session.version, edited.version);
  record('concurrent session mutation is preserved; result is retained as a save conflict');

  const deleteCalls = streams, deleteTask = await create(input({ sessionId: edited.id, baseVersion: edited.version }));
  await until(async () => streams, n => n > deleteCalls);
  await call(`/rag/sessions/${edited.id}`, 'DELETE', { mutationId: randomUUID(), baseVersion: edited.version });
  await until(async () => active, n => n === 0);
  await call(`/rag/tasks/${deleteTask.id}`, 'GET', undefined, 404); await call(`/rag/sessions/${edited.id}`, 'GET', undefined, 404);
  record('deleting session cancels execution, removes task bodies and never revives session');

  const legacyController = new AbortController(), legacyBefore = streams;
  const legacy = await fetch(webUrl + '/rag/query', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ question: '合成保存应如何操作？' }), signal: legacyController.signal });
  const legacyReader = legacy.body.getReader(); await legacyReader.read();
  await until(async () => streams, n => n > legacyBefore);
  const queued = await create(input()); assert.equal((await read(queued.id)).state, 'queued');
  await call('/rag/query', 'POST', { question: '合成保存应如何操作？' }, 429);
  legacyController.abort(); await legacyReader.cancel().catch(() => {}); await complete(queued.id);
  assert.equal(peak, 1); record('legacy and durable requests share one execution slot, released after cancel');

  modelDelay = 20000; const restartBefore = streams, interrupted = await create(input());
  await until(async () => streams, n => n > restartBefore);
  await until(() => read(interrupted.id), task => task.partial.length > 0);
  await stopWeb(); await until(async () => active, n => n === 0);
  const restartCalls = streams; modelDelay = 400; await startWeb();
  const recovered = await until(() => read(interrupted.id), x => x.state === 'interrupted');
  assert.ok(recovered.partial); await sleep(350); assert.equal(streams, restartCalls);
  await complete((await create(input())).id); assert.equal(streams, restartCalls + 1);
  record('real server restart marks interrupted, retains fragment, never replays and admits new tasks');

  modelDelay = 60000; const discoveryCalls = streams, held = await create(input());
  await until(async () => streams, n => n === discoveryCalls + 1);
  for (let i = 0; i < 105; i++) { const queuedTask = await create(input()); await call(`/rag/tasks/${queuedTask.id}/cancel`, 'POST'); }
  const listing = (await call('/rag/tasks')).tasks;
  assert.ok(listing.some(task => task.id === held.id && task.state === 'running'));
  assert.ok(listing.every(task => !('result' in task) && !('partial' in task)), 'list is discovery metadata, not full answers');
  assert.equal(streams, discoveryCalls + 1); await call(`/rag/tasks/${held.id}/cancel`, 'POST');
  await until(async () => active, n => n === 0);
  record('old running task remains discoverable after 105 later cancellations without loading answer bodies');

  modelDelay = 1500; const recoveryCalls = streams, failedWrite = await create(input());
  await until(async () => streams, n => n === recoveryCalls + 1);
  const fault = new DatabaseSync(path.join(data, 'state', 'rag-tasks.sqlite'));
  try {
    fault.exec(`CREATE TRIGGER synthetic_status_outage BEFORE UPDATE ON tasks WHEN OLD.state='running'
      BEGIN SELECT RAISE(ABORT,'synthetic task status unavailable'); END;`);
    await until(async () => active, n => n === 0); await sleep(350);
    assert.equal((await read(failedWrite.id)).state, 'running');
    fault.exec('DROP TRIGGER synthetic_status_outage');
    const reconciled = await until(() => read(failedWrite.id), task => task.state === 'interrupted');
    assert.equal(reconciled.errorCode, 'RAG_TASK_INTERRUPTED'); await sleep(400); assert.equal(streams, recoveryCalls + 1);
  } finally { fault.exec('DROP TRIGGER IF EXISTS synthetic_status_outage'); fault.close(); }
  modelDelay = 100; assert.equal((await complete((await create(input())).id)).state, 'succeeded');
  record('recovered task storage interrupts an ended executor without replay; next task can execute');

  assert.equal(createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex'), sourceHash);
  record('source Markdown unchanged; all model/MCP services are local synthetic fixtures');
  report.passed = true; report.maxConcurrentModelStreams = peak;
} catch (error) {
  report.passed = false; report.errors.push(error.stack || String(error)); throw error;
} finally {
  await stopWeb(); await mcp.close(); for (const timer of timers) clearTimeout(timer);
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${output}`);
}
