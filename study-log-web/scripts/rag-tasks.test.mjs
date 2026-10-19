import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { RagTaskRuntime } from '../lib/rag-task-runtime.ts';
import { RagTaskStore } from '../lib/rag-task-store.ts';
import { withRagSessionLock } from '../lib/rag-session-lock.ts';
import { createRagSession, getRagSession, listRagSessions, updateRagSession, deleteRagSession, applyRagTaskResult, applyGeneratedRagSessionTitle, renameRagSession, ensureRagTaskSessionFormat } from '../lib/rag-sessions-store.ts';

let fixture, oldEnv, runtimes, stores;
const uuid = () => randomUUID();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, ms = 4000) {
  const start = Date.now();
  while (true) { const value = await read(); if (predicate(value)) return value; if (Date.now() - start > ms) assert.fail(JSON.stringify(value)); await wait(15); }
}
const submission = overrides => ({ submissionId: uuid(), sessionId: uuid(), baseVersion: null, question: '合成记录如何保存？', mode: 'logs_only', history: [], ...overrides });
const completed = { answer: '合成回答。', citations: [] };
function executor({ delay = 20, error, onCall = () => {}, onAbort = () => {} } = {}) {
  return (_input, signal) => {
    onCall();
    return new ReadableStream({
      start(controller) {
        const send = (event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        send('delta', { text: '合成片段' });
        const timer = setTimeout(() => { send(error ? 'error' : 'done', error || completed); controller.close(); }, delay);
        signal.addEventListener('abort', () => { clearTimeout(timer); onAbort(); controller.error(signal.reason); }, { once: true });
      }
    });
  };
}
const runtime = execute => { const r = new RagTaskRuntime(process.env.LOG_ROOT, execute); runtimes.push(r); return r; };
const done = (r, id) => until(() => r.get(id), task => !['queued', 'running'].includes(task.state) && (task.state !== 'succeeded' || task.saveState !== 'pending'));
const pair = question => [{ id: uuid(), role: 'user', content: question, status: 'complete' }, { id: uuid(), role: 'assistant', content: '旧回答', status: 'complete' }];

beforeEach(async () => {
  oldEnv = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-durable-rag-'));
  process.env.LOG_ROOT = path.join(fixture, 'data'); process.env.BACKUP_ROOT = path.join(fixture, 'backups');
  await fs.mkdir(process.env.LOG_ROOT); await fs.mkdir(process.env.BACKUP_ROOT); runtimes = []; stores = [];
});
afterEach(async () => {
  for (const r of runtimes) r.stop();
  await wait(40);
  for (const r of runtimes) r.store.close();
  for (const s of stores) s.close();
  for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  assert.equal(path.dirname(fixture), path.resolve(os.tmpdir())); assert.ok(path.basename(fixture).startsWith('workbench-durable-rag-'));
  await fs.rm(fixture, { recursive: true, force: true });
});

test('no subscriber is needed to finish and atomically persist the answer in its session', async () => {
  let calls = 0;
  const r = runtime(executor({ onCall: () => calls++ })); r.start();
  const input = submission(), task = await r.create(input), final = await done(r, task.id);
  assert.equal(final.state, 'succeeded'); assert.equal(final.saveState, 'saved'); assert.equal(calls, 1);
  const saved = await getRagSession(input.sessionId);
  assert.equal(saved.messages.length, 2); assert.equal(saved.messages[1].content, completed.answer);
  assert.equal((await listRagSessions()).length, 1);
});

test('simultaneous and late identical submissions share one task; changed content conflicts', async () => {
  let calls = 0;
  const r = runtime(executor({ delay: 80, onCall: () => calls++ })); r.start(); const input = submission();
  const [a, b] = await Promise.all([r.create(input), r.create(structuredClone(input))]); assert.equal(a.id, b.id);
  await done(r, a.id); assert.equal((await r.create(input)).id, a.id); assert.equal(calls, 1);
  await assert.rejects(r.create({ ...input, question: '不同问题' }), { code: 'RAG_SUBMISSION_CONFLICT' }); assert.equal(calls, 1);
});

test('active cancellation wins before completion, but cancellation after completion cannot undo the result', async () => {
  let aborts = 0;
  const r = runtime(executor({ delay: 300, onAbort: () => aborts++ })); r.start();
  const input = submission(), task = await r.create(input); await until(() => r.get(task.id), x => x.state === 'running');
  assert.equal((await r.cancel(task.id)).state, 'cancelled'); await wait(350);
  assert.equal((await r.get(task.id)).state, 'cancelled'); assert.equal(aborts, 1); assert.deepEqual(await listRagSessions(), []);
  const next = await r.create(submission()); const final = await done(r, next.id);
  assert.equal(final.state, 'succeeded'); assert.equal((await r.cancel(next.id)).state, 'succeeded');
});

test('concurrent edit preserves new session bytes; task result remains available without overwriting', async () => {
  const first = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('旧问题') });
  const r = runtime(executor({ delay: 100 })); r.start();
  const task = await r.create(submission({ sessionId: first.id, baseVersion: first.version }));
  const edited = await updateRagSession(first.id, { mutationId: uuid(), baseVersion: first.version, answerMode: 'logs_only', messages: pair('其他端改动') });
  const final = await done(r, task.id); assert.equal(final.saveState, 'conflict'); assert.equal(final.result.answer, completed.answer);
  assert.deepEqual(await getRagSession(first.id), edited);
});

test('deleting a completed session immediately scrubs its task bodies', async () => {
  const r = runtime(executor()); r.start(); const input = submission(), task = await r.create(input); await done(r, task.id);
  const saved = await getRagSession(input.sessionId);
  await deleteRagSession(saved.id, { mutationId: uuid(), baseVersion: saved.version });
  const raw = r.store.get(task.id, true);
  assert.deepEqual(raw.input, {}); assert.equal(raw.result, null); assert.equal(raw.partial, '');
  await assert.rejects(r.get(task.id), { status: 404 });
  await assert.rejects(r.create(input), { code: 'RAG_SUBMISSION_REMOVED' });
});

test('deleting a running session cancels its task and never recreates the JSON session', async () => {
  const first = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('旧问题') });
  let aborted = 0; const r = runtime(executor({ delay: 800, onAbort: () => aborted++ })); r.start();
  const task = await r.create(submission({ sessionId: first.id, baseVersion: first.version }));
  await until(() => r.get(task.id), x => x.state === 'running');
  await deleteRagSession(first.id, { mutationId: uuid(), baseVersion: first.version }); await wait(350);
  assert.equal(aborted, 1); assert.deepEqual(await listRagSessions(), []);
  assert.equal(r.store.get(task.id, true).result, null);
});

test('a save failure retains the result; save retry never calls the model again', async () => {
  const first = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('旧问题') });
  await ensureRagTaskSessionFormat();
  await fs.rename(path.join(process.env.BACKUP_ROOT, 'rag-sessions'), path.join(process.env.BACKUP_ROOT, 'rag-sessions-kept'));
  await fs.writeFile(path.join(process.env.BACKUP_ROOT, 'rag-sessions'), 'synthetic blocked backup path');
  let calls = 0; const r = runtime(executor({ onCall: () => calls++ })); r.start();
  const task = await r.create(submission({ sessionId: first.id, baseVersion: first.version })); const failedSave = await done(r, task.id);
  assert.equal(failedSave.state, 'succeeded'); assert.equal(failedSave.saveState, 'error'); assert.equal(failedSave.result.answer, completed.answer);
  await fs.unlink(path.join(process.env.BACKUP_ROOT, 'rag-sessions'));
  await fs.rename(path.join(process.env.BACKUP_ROOT, 'rag-sessions-kept'), path.join(process.env.BACKUP_ROOT, 'rag-sessions'));
  assert.equal((await r.save(task.id)).saveState, 'saved'); assert.equal(calls, 1);
  assert.equal((await getRagSession(first.id)).messages.length, 4);
});

test('a committed delete tombstone recovers failed SQLite scrubbing without waiting for a task read', async () => {
  const r = runtime(executor()); r.start(); const input = submission(), task = await r.create(input); await done(r, task.id);
  const session = await getRagSession(input.sessionId), request = { mutationId: uuid(), baseVersion: session.version };
  const scrub = RagTaskStore.prototype.scrubSession;
  try {
    RagTaskStore.prototype.scrubSession = () => { throw new Error('synthetic database write failure'); };
    await assert.rejects(deleteRagSession(session.id, request));
  } finally { RagTaskStore.prototype.scrubSession = scrub; }
  assert.deepEqual(await listRagSessions(), []);
  await until(async () => r.store.get(task.id, true), value => Object.keys(value.input).length === 0);
  assert.deepEqual(r.store.get(task.id, true).input, {});
  await deleteRagSession(session.id, request);
});

test('bounded admission rejects queue overflow and a second task in the same session', async () => {
  const r = runtime(() => assert.fail('Slot occupied by legacy request')); const lease = r.store.legacy(r.owner);
  const first = submission(); await r.create(first);
  await assert.rejects(r.create({ ...first, submissionId: uuid() }), { code: 'RAG_SESSION_BUSY' });
  for (let i = 0; i < 7; i++) await r.create(submission());
  await assert.rejects(r.create(submission()), { code: 'RAG_QUEUE_FULL', status: 429 });
  r.store.release(lease);
});

test('a pending session write blocks another turn before it can spend model calls on a stale version', () => {
  const s = new RagTaskStore(process.env.LOG_ROOT); stores.push(s); const owner = 'synthetic-owner'; s.leader(owner);
  const input = submission(); s.create(input); const task = s.claim(owner); s.finish(task, 'succeeded', completed);
  assert.throws(() => s.create({ ...input, submissionId: uuid(), question: '下一轮问题' }), { code: 'RAG_SESSION_BUSY' });
});

test('a short delta after status is checkpointed even if the provider then stalls', async () => {
  const r = runtime((_input, signal) => new ReadableStream({ start(controller) {
    const send = (event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    send('status', { message: '正在生成回答' }); send('delta', { text: '已经收到但尚未结束的片段' });
    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
  } })); r.start();
  const task = await r.create(submission());
  const checkpoint = await until(() => r.get(task.id), x => x.partial.length > 0);
  assert.equal(checkpoint.state, 'running'); assert.equal(checkpoint.partial, '已经收到但尚未结束的片段');
  await r.cancel(task.id);
});

test('follow-up history is captured from the versioned server session; regeneration excludes its last pair', async () => {
  const first = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('真正的历史问题') });
  let captured; const r = runtime((input, signal) => { captured = input.history; return executor()(input, signal); }); r.start();
  const request = submission({ sessionId: first.id, baseVersion: first.version, history: [{ role: 'user', content: '不可信的客户端历史' }] });
  const task = await r.create(request); await done(r, task.id);
  assert.equal(captured[0].content, '真正的历史问题'); assert.equal((await r.create(request)).id, task.id);
  const session = await getRagSession(first.id);
  const replacement = await r.create(submission({ sessionId: first.id, baseVersion: session.version, question: request.question, replaceLast: true }));
  await done(r, replacement.id); assert.equal(captured.length, 2);
  assert.equal((await getRagSession(first.id)).messages.length, 4);
});

test('atomic JSON receipt reconciles a crash before SQLite save acknowledgment, even after a later edit', async () => {
  const s = new RagTaskStore(process.env.LOG_ROOT); stores.push(s); const owner = 'synthetic-owner'; s.leader(owner);
  const input = submission(), created = s.create(input), task = s.claim(owner); assert.equal(task.id, created.id);
  s.finish(task, 'succeeded', completed);
  const saved = await applyRagTaskResult({ taskId: task.id, sessionId: task.sessionId, baseVersion: null, question: input.question, answerMode: input.mode, ...completed });
  const edited = await updateRagSession(saved.id, { mutationId: uuid(), baseVersion: saved.version, answerMode: 'logs_only', messages: pair('收据落盘之后的修改') });
  s.shutdown(owner);
  const r = runtime(() => assert.fail('Must not regenerate a completed result')); await r.tick();
  assert.equal((await r.get(task.id)).saveState, 'saved'); assert.deepEqual(await getRagSession(saved.id), edited);
});

test('killing a process after the JSON receipt commits reconciles on a fresh runtime without duplicating messages', async () => {
  const storeUrl = new URL('../lib/rag-task-store.ts', import.meta.url).href;
  const sessionUrl = new URL('../lib/rag-sessions-store.ts', import.meta.url).href;
  const input = submission();
  const code = `import {RagTaskStore} from ${JSON.stringify(storeUrl)}; import {applyRagTaskResult} from ${JSON.stringify(sessionUrl)};
    setInterval(()=>{},1000); const s=new RagTaskStore(process.env.LOG_ROOT),owner=process.pid+':synthetic';s.leader(owner);
    const input=${JSON.stringify(input)};s.create(input);const t=s.claim(owner);s.finish(t,'succeeded',${JSON.stringify(completed)});
    await applyRagTaskResult({taskId:t.id,sessionId:input.sessionId,baseVersion:null,question:input.question,answerMode:input.mode,...${JSON.stringify(completed)}});process.send({id:t.id});`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.on('data', () => {}); const [message] = await once(child, 'message');
  const closed = once(child, 'close'); child.kill(); await closed;
  const before = await fs.readFile(path.join(process.env.LOG_ROOT, 'state', 'rag-sessions.json'), 'utf8');
  const r = runtime(() => assert.fail('Must not regenerate an already completed answer')); r.start();
  assert.equal((await done(r, message.id)).saveState, 'saved');
  assert.equal((await getRagSession(input.sessionId)).messages.length, 2);
  assert.equal(await fs.readFile(path.join(process.env.LOG_ROOT, 'state', 'rag-sessions.json'), 'utf8'), before);
});

test('reconciliation is not limited by the latest 100 task list entries', async () => {
  const s = new RagTaskStore(process.env.LOG_ROOT); stores.push(s); const owner = 'synthetic-owner'; s.leader(owner);
  const pending = s.create(submission()), claimed = s.claim(owner); s.finish(claimed, 'succeeded', completed);
  for (let i = 0; i < 105; i++) { s.create(submission()); const t = s.claim(owner); s.finish(t, 'failed', null, 'synthetic failure'); }
  s.shutdown(owner);
  const r = runtime(() => assert.fail('No pending generation')); await r.tick();
  assert.equal((await r.get(pending.id)).saveState, 'saved');
});

test('source-version change is a failed task without successful save and keeps safe error classification', async () => {
  const r = runtime(executor({ error: { message: '来源内容已变化', code: 'MCP_SOURCE_CHANGED', diagnostics: { usage: [{ model: 'synthetic', inputTokens: 5, outputTokens: null }] } } })); r.start();
  const task = await r.create(submission()), final = await done(r, task.id);
  assert.equal(final.state, 'failed'); assert.equal(final.errorCode, 'MCP_SOURCE_CHANGED');
  assert.deepEqual(final.result.diagnostics.usage, [{ model: 'synthetic', inputTokens: 5, outputTokens: null }]);
  assert.deepEqual(await listRagSessions(), []);
});

test('legacy and durable queries use the same slot, including cancellation cleanup', async () => {
  const r = runtime(executor()); const lease = r.store.legacy(r.owner); assert.ok(lease);
  const input = submission(), task = await r.create(input); assert.equal(r.store.get(task.id).state, 'queued');
  r.store.release(lease); await r.tick(); assert.equal(r.store.legacy('another-owner'), null);
  await done(r, task.id); assert.ok(r.store.legacy(r.owner));
});

test('discovery keeps old active and unsaved tasks while bounding only terminal history', () => {
  const s = new RagTaskStore(process.env.LOG_ROOT); stores.push(s); const owner = 'synthetic-owner'; s.leader(owner);
  const attention = [];
  for (const saveState of ['pending', 'error', 'conflict']) {
    s.create(submission()); const task = s.claim(owner); s.finish(task, 'succeeded', completed);
    if (saveState !== 'pending') s.saved(task.id, saveState); attention.push(task.id);
  }
  const saved = s.create(submission()), claimedSaved = s.claim(owner); s.finish(claimedSaved, 'succeeded', completed); s.saved(saved.id, 'saved');
  const active = s.create(submission()); s.claim(owner); attention.push(active.id);
  for (let i = 0; i < 105; i++) { const task = s.create(submission()); s.cancel(task.id); }
  const visible = s.list(), ids = new Set(visible.map(task => task.id));
  for (const id of attention) assert.ok(ids.has(id), `Missing actionable task ${id}`);
  assert.equal(ids.size, visible.length); assert.equal(visible.filter(task => task.state === 'cancelled').length, 100);
  assert.ok(!ids.has(saved.id), 'old saved result belongs to the explicitly bounded history');
  assert.ok(visible.every(task => !('input' in task) && !('partial' in task) && !('result' in task)), 'discovery carries metadata; details are fetched by ID');
});

test('temporary status-write failure converges an ended executor after recovery without replay or a stuck lease', async () => {
  let calls = 0; const r = runtime(executor({ onCall: () => calls++ }));
  const fault = new DatabaseSync(path.join(process.env.LOG_ROOT, 'state', 'rag-tasks.sqlite')); stores.push(fault);
  fault.exec(`CREATE TRIGGER synthetic_status_outage BEFORE UPDATE ON tasks WHEN OLD.state='running'
    BEGIN SELECT RAISE(ABORT,'synthetic task status unavailable'); END;
    CREATE TRIGGER synthetic_lease_outage BEFORE DELETE ON leases WHEN OLD.kind='task'
    BEGIN SELECT RAISE(ABORT,'synthetic lease write unavailable'); END;`);
  try {
    r.start(); const task = await r.create(submission());
    await until(async () => calls, n => n === 1); await wait(500);
    assert.equal((await r.get(task.id)).state, 'running');
    fault.exec('DROP TRIGGER synthetic_status_outage; DROP TRIGGER synthetic_lease_outage');
    const recovered = await until(() => r.get(task.id), value => value.state === 'interrupted');
    assert.equal(recovered.result, null); assert.equal(calls, 1); await wait(400); assert.equal(calls, 1);
    const next = await r.create(submission()); assert.equal((await done(r, next.id)).state, 'succeeded'); assert.equal(calls, 2);
  } finally { fault.exec('DROP TRIGGER IF EXISTS synthetic_status_outage; DROP TRIGGER IF EXISTS synthetic_lease_outage'); }
});

test('an executor still waiting for its model is not treated as an orphan across multiple ticks', async () => {
  let finish, calls = 0;
  const r = runtime((_input, signal) => new ReadableStream({ start(controller) {
    calls++; finish = () => { controller.enqueue(new TextEncoder().encode(`event: done\ndata: ${JSON.stringify(completed)}\n\n`)); controller.close(); };
    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
  } })); r.start(); const task = await r.create(submission());
  await until(async () => calls, n => n === 1); await wait(650);
  assert.equal((await r.get(task.id)).state, 'running'); assert.equal(calls, 1);
  finish(); assert.equal((await done(r, task.id)).state, 'succeeded');
});

test('only a provable automatic title update may rebase task creation or result save', async () => {
  const r = runtime(executor({ delay: 150 })); r.start();
  const initial = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('首问') });
  const generated = await applyGeneratedRagSessionTitle(initial.id, initial.version, '自动合成标题');
  const task = await r.create(submission({ sessionId: initial.id, baseVersion: initial.version }));
  assert.equal((await done(r, task.id)).saveState, 'saved'); assert.equal((await getRagSession(initial.id)).title, generated.title);
  const second = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('另一首问') });
  const running = await r.create(submission({ sessionId: second.id, baseVersion: second.version }));
  await applyGeneratedRagSessionTitle(second.id, second.version, '生成中返回的自动标题');
  assert.equal((await done(r, running.id)).saveState, 'saved');
  const current = await getRagSession(second.id);
  await renameRagSession(second.id, { mutationId: uuid(), baseVersion: current.version, title: '手动标题不应被绕过' });
  await assert.rejects(r.create(submission({ sessionId: second.id, baseVersion: current.version })), error => error.code === 'RAG_SESSION_CONFLICT');
  const third = await createRagSession({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: 'logs_only', messages: pair('第三首问') });
  await applyGeneratedRagSessionTitle(third.id, third.version, '自动标题');
  const titled = await getRagSession(third.id);
  await updateRagSession(third.id, { mutationId: uuid(), baseVersion: titled.version, answerMode: 'logs_only', messages: pair('正文被修改') });
  await assert.rejects(r.create(submission({ sessionId: third.id, baseVersion: third.version })), error => error.code === 'RAG_SESSION_CONFLICT');
});

test('session mutex recovers after a killed holder, without deleting another process lock', async () => {
  const moduleUrl = new URL('../lib/rag-session-lock.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import {withRagSessionLock} from ${JSON.stringify(moduleUrl)}; setInterval(()=>{},1000); await withRagSessionLock(process.env.LOG_ROOT, async()=>{console.log('locked');await new Promise(()=>{})});`], { env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', () => {});
  // Keep the lock holder alive while its promise is suspended.
  await until(async () => output, x => x.includes('locked'));
  const closed = once(child, 'close'); child.kill(); await closed;
  await withRagSessionLock(process.env.LOG_ROOT, async () => { await fs.writeFile(path.join(fixture, 'mutex-recovered'), 'yes'); });
  assert.equal(await fs.readFile(path.join(fixture, 'mutex-recovered'), 'utf8'), 'yes');
});

test('multiple real processes serialize asynchronous JSON writers without losing increments', async () => {
  const counter = path.join(fixture, 'counter.json'); await fs.writeFile(counter, '0');
  const moduleUrl = new URL('../lib/rag-session-lock.ts', import.meta.url).href;
  const code = `import fs from 'node:fs/promises'; import {withRagSessionLock} from ${JSON.stringify(moduleUrl)};
    for(let i=0;i<8;i++) await withRagSessionLock(process.env.LOG_ROOT,async()=>{const n=Number(await fs.readFile(${JSON.stringify(counter)},'utf8'));await new Promise(r=>setTimeout(r,8));await fs.writeFile(${JSON.stringify(counter)},String(n+1));});`;
  const children = Array.from({ length: 6 }, () => spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }));
  const results = await Promise.all(children.map(async child => { let error = ''; child.stderr.on('data', chunk => error += chunk); const [exit] = await once(child, 'close'); return { exit, error }; }));
  assert.equal(results.length, 6); for (const result of results) assert.equal(result.exit, 0, result.error);
  assert.equal(await fs.readFile(counter, 'utf8'), '48');
});

test('a killed task executor is interrupted on restart, preserves fragments, and is not replayed', async () => {
  const runtimeUrl = new URL('../lib/rag-task-runtime.ts', import.meta.url).href;
  const input = submission();
  const code = `import {RagTaskRuntime} from ${JSON.stringify(runtimeUrl)};
    const runtime=new RagTaskRuntime(process.env.LOG_ROOT,(_input,signal)=>new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: delta\\ndata: {"text":"重启前片段"}\\n\\n')); signal.addEventListener('abort',()=>c.error(signal.reason));}}));
    setInterval(()=>{},1000); runtime.start(); const task=await runtime.create(${JSON.stringify(input)});
    while(!(await runtime.get(task.id)).partial) await new Promise(r=>setTimeout(r,10)); process.send({id:task.id});`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.on('data', () => {}); const [message] = await once(child, 'message');
  const closed = once(child, 'close'); child.kill(); await closed;
  let calls = 0; const r = runtime(executor({ onCall: () => calls++ })); r.start();
  const interrupted = await until(() => r.get(message.id), x => x.state === 'interrupted', 8000);
  assert.equal(interrupted.partial, '重启前片段'); assert.equal(calls, 0); assert.deepEqual(await listRagSessions(), []);
  const next = await r.create(submission()); assert.equal((await done(r, next.id)).state, 'succeeded'); assert.equal(calls, 1);
});
