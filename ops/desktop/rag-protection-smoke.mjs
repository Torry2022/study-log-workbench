import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Execute with the candidate's own Node. Every service and archive operation
// below imports the candidate payload, never the checkout's implementation.
assert.ok(process.argv[2] && process.argv[3], 'Pass the current and previous unpacked EXE paths');
const executable = path.resolve(process.argv[2]), previous = path.resolve(process.argv[3]);
const payload = path.join(path.dirname(executable), 'resources/payload');
assert.equal(process.execPath.toLowerCase(), path.join(payload, 'runtime/node.exe').toLowerCase());
const { DesktopManager } = await import(pathToFileURL(path.join(payload, 'ops/desktop/manager.mjs')));
const archive = await import(pathToFileURL(path.join(payload, 'ops/archive.mjs')));
const oldArchive = await import(pathToFileURL(path.join(path.dirname(previous), 'resources/payload/ops/archive.mjs')));
const repo = path.resolve(import.meta.dirname, '../..'), root = path.join(repo, '.local', `rag-windows-protection-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const report = { root, executable, previous, payload, checks: [], paidModelCalls: 0, installed: false, errors: [] };
const hash = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 25000) { const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(50); } }
const mark = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const managers = [], waiting = new Map(); let streams = 0, active = 0, base, token;
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const bytes of req) raw += bytes; const input = JSON.parse(raw);
  if (!input.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ query: '合成归档', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }] })); return; }
  const n = ++streams; active++; waiting.set(n, res); res.setHeader('content-type', 'text/event-stream');
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `合成归档回答${n}：保留完整回答` }, finish_reason: null }] })}\n\n`);
  res.once('close', () => { active--; waiting.delete(n); });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const finish = n => { const res = waiting.get(n); assert.ok(res); res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '和任务收据。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`); };
async function prepare(name, configured = false) {
  const instance = path.join(root, name), manager = new DesktopManager({ packageRoot: payload, node: process.execPath }), password = `Synthetic-${randomUUID()}`;
  managers.push(manager); await manager.select({ root: instance, create: true, password });
  if (configured) {
    await manager.configure({ apiUrl: `http://127.0.0.1:${model.address().port}/chat`, model: 'synthetic-windows-protection-model', apiKey: 'synthetic-windows-key' });
    await fs.appendFile(path.join(instance, '.env'), '\nRAG_AGENT_ENABLED=false\nRAG_AGENT_TOOL_CALLING_VERIFIED=false\nRAG_JEV_ENABLED=false\n');
  }
  return { instance, manager, password };
}
async function start(f) {
  await f.manager.start(); base = f.manager.url + '/api';
  const response = await fetch(base + '/auth/app-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: f.password }) });
  assert.equal(response.status, 200); token = (await response.json()).token; assert.ok(token);
}
async function call(route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
const task = async id => (await call(`/rag/tasks/${id}`)).task;
const submit = async () => (await call('/rag/tasks', 'POST', { submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成归档怎么保存？', mode: 'logs_only' })).task;
const database = f => new DatabaseSync(path.join(f.instance, 'data/state/rag-tasks.sqlite'));
try {
  report.archiveSourceSha = hash(await fs.readFile(path.join(payload, 'ops/archive.mjs')));
  assert.equal(report.archiveSourceSha, hash(await fs.readFile(path.join(repo, 'ops/archive.mjs'))));
  const f = await prepare('source', true), source = '## 2026-09-01\n\n### 合成归档\n\n合成归档保存完整回答和任务收据。\n';
  const log = path.join(f.instance, 'data/2026-09_学习日志.md'); await fs.writeFile(log, source);
  await start(f); const first = await submit(); await until(() => streams, n => n === 1);
  const json = path.join(f.instance, 'data/state/rag-sessions.json');
  assert.deepEqual(JSON.parse(await fs.readFile(json, 'utf8')).taskReceipts, []);
  finish(1); await until(() => task(first.id), value => value.saveState === 'saved');
  const running = await submit(); await until(() => task(running.id), value => value.partial.includes('合成归档回答2'));
  const queued = await submit(); assert.equal(queued.state, 'queued');
  await assert.rejects(archive.backupInstance(f.instance, path.join(root, 'live.slarchive')));
  assert.equal(await fs.stat(path.join(root, 'live.slarchive')).catch(() => null), null);
  mark('packaged web commits empty receipt format before first result, saves cited answer and rejects live archive');
  await f.manager.shutdown(); await until(() => active, n => n === 0);
  const db = database(f);
  db.prepare("UPDATE tasks SET save_state='pending' WHERE id=?").run(first.id);
  db.prepare("UPDATE tasks SET state='running',owner='99999999:synthetic-crash' WHERE id=?").run(running.id);
  db.exec('DELETE FROM worker;DELETE FROM leases');
  db.prepare('INSERT INTO worker VALUES(1,?,?)').run('99999999:synthetic-crash', Date.now() + 130000);
  db.prepare('INSERT INTO leases VALUES(?,?,?,?)').run(running.id, '99999999:synthetic-crash', 'task', Date.now() + 130000); db.close();
  const jsonBefore = await fs.readFile(json), dbFile = path.join(f.instance, 'data/state/rag-tasks.sqlite'), dbBefore = await fs.readFile(dbFile);
  const file = path.join(root, 'snapshot.slarchive'); await archive.backupInstance(f.instance, file);
  const verified = await archive.verifyArchive(file); assert.equal(verified.manifest.version, 2);
  assert.equal(verified.manifest.entries.find(value => value.path.endsWith('state/rag-sessions.json')).sha256, hash(jsonBefore));
  assert.equal(verified.manifest.entries.find(value => value.path.endsWith('state/rag-tasks.sqlite')).sha256, hash(dbBefore));
  await assert.rejects(oldArchive.verifyArchive(file), { code: 'ARCHIVE_INVALID' });
  await assert.rejects(oldArchive.restoreInstance(file, path.join(root, 'old-target')), { code: 'ARCHIVE_INVALID' });
  assert.equal(await fs.stat(path.join(root, 'old-target')).catch(() => null), null);
  mark('packaged archive V2 captures exact JSON/SQLite bytes; previous candidate payload rejects verify/restore before writing');
  const restoredRoot = path.join(root, 'restored'); await archive.restoreInstance(file, restoredRoot);
  const restored = { instance: restoredRoot, password: f.password, manager: new DesktopManager({ packageRoot: payload, node: process.execPath }) };
  managers.push(restored.manager); await restored.manager.select({ root: restoredRoot });
  const restoredDb = database(restored);
  for (const id of [running.id, queued.id]) assert.equal(restoredDb.prepare('SELECT state FROM tasks WHERE id=?').get(id).state, 'interrupted');
  assert.equal(restoredDb.prepare('SELECT count(*) n FROM worker').get().n, 0); assert.equal(restoredDb.prepare('SELECT count(*) n FROM leases').get().n, 0); restoredDb.close();
  assert.deepEqual(await fs.readFile(path.join(restoredRoot, 'data/state/rag-sessions.json')), jsonBefore);
  await start(restored); await until(() => task(first.id), value => value.saveState === 'saved'); await pause(1200);
  assert.equal(streams, 2); assert.equal(active, 0);
  for (const id of [running.id, queued.id]) assert.equal((await task(id)).state, 'interrupted');
  const session = (await call(`/rag/sessions/${first.sessionId}`)).session; assert.equal(session.messages.length, 2); assert.ok(session.messages[1].citations.length);
  await restored.manager.shutdown(); assert.deepEqual(await fs.readFile(path.join(restoredRoot, 'data/state/rag-sessions.json')), jsonBefore);
  assert.deepEqual(await fs.readFile(json), jsonBefore); assert.deepEqual(await fs.readFile(dbFile), dbBefore); assert.equal(await fs.readFile(log, 'utf8'), source);
  mark('packaged restore interrupts old running/queued work and reconciles JSON-before-SQLite crash without replay or duplication');

  const blocked = await prepare('format-write-failure', true), blockedState = path.join(blocked.instance, 'data/state'); await fs.mkdir(blockedState);
  const blockedJson = path.join(blockedState, 'rag-sessions.json'), legacyJson = JSON.stringify({ schemaVersion: 1, sessions: [], tombstones: [] });
  await fs.writeFile(blockedJson, legacyJson); await fs.writeFile(path.join(blocked.instance, 'backups/rag-sessions'), 'synthetic backup blocker');
  await start(blocked);
  const rejected = await fetch(base + '/rag/tasks', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成归档怎么保存？', mode: 'logs_only' }) });
  const rejectedBody = await rejected.json();
  assert.equal(rejected.status, 503); assert.equal(rejectedBody.code, 'RAG_TASK_UNAVAILABLE'); assert.match(rejectedBody.error, /存储/);
  report.receiptWriteFailure = { status: rejected.status, code: rejectedBody.code };
  assert.deepEqual((await call('/rag/tasks')).tasks, []); assert.equal(streams, 2);
  assert.equal(await fs.readFile(blockedJson, 'utf8'), legacyJson); await blocked.manager.shutdown();
  mark('packaged API refuses admission on receipt-format write failure without creating a task or calling the model');

  const future = await prepare('future'); const state = path.join(future.instance, 'data/state'); await fs.mkdir(state);
  const futureFile = path.join(state, 'rag-tasks.sqlite'), futureDb = new DatabaseSync(futureFile);
  futureDb.exec('PRAGMA journal_mode=WAL;PRAGMA user_version=999'); futureDb.close(); const futureBefore = await fs.readFile(futureFile);
  const futureArchive = path.join(root, 'future.slarchive'); await archive.backupInstance(future.instance, futureArchive);
  const badTarget = path.join(root, 'future-restore');
  await assert.rejects(archive.restoreInstance(futureArchive, badTarget), { code: 'RESTORE_INCOMPLETE' });
  assert.ok(await fs.stat(path.join(badTarget, '.restore-incomplete.json'))); assert.ok(await fs.stat(path.join(badTarget, 'data/.instance-operation.lock')));
  mark('packaged restore rejects a future task database and retains incomplete target and maintenance lock');
  await assert.rejects(future.manager.start());
  assert.deepEqual(await fs.readFile(futureFile), futureBefore);
  mark('actual packaged Web startup rejects future SQLite schema before rewriting its journal metadata');
  report.models = { streams, active }; assert.equal(streams, 2); assert.equal(active, 0);
} catch (error) { report.failure = error.stack || String(error); throw error; }
finally {
  for (const manager of managers) await manager.shutdown();
  for (const res of waiting.values()) res.destroy(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  report.remainingWorkers = managers.flatMap(manager => manager.processes.filter(item => item.child.exitCode === null && item.child.signalCode === null).map(item => item.child.pid));
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(root);
  assert.deepEqual(report.remainingWorkers, []);
}
