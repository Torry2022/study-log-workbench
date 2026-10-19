import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initialize } from './instance.mjs';
import { backupInstance, restoreInstance, verifyArchive } from './archive.mjs';
import { RagTaskStore } from '../study-log-web/lib/rag-task-store.ts';
import { RagTaskRuntime } from '../study-log-web/lib/rag-task-runtime.ts';
import { applyRagTaskResult, createRagSession } from '../study-log-web/lib/rag-sessions-store.ts';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
const input = () => ({ submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成归档如何保存？', mode: 'logs_only', history: [] });
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-rag-archive-')), root = path.join(base, 'source');
  await initialize(root); const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT }, runtimes = [];
  process.env.LOG_ROOT = path.join(root, 'data'); process.env.BACKUP_ROOT = path.join(root, 'backups');
  t.after(async () => {
    for (const r of runtimes) r.stop();
    await wait(50); for (const r of runtimes) r.store.close();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(base), path.resolve(os.tmpdir())); assert.ok(path.basename(base).startsWith('workbench-rag-archive-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, root, data: path.join(root, 'data'), archive: path.join(base, 'snapshot.slarchive'), target: path.join(base, 'restored'), runtimes };
}
function runtime(f, data) {
  let calls = 0;
  const r = new RagTaskRuntime(data, (_input, signal) => {
    calls++;
    return new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"合成未完成片段"}\n\n'));
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } });
  });
  f.runtimes.push(r);
  return { r, calls: () => calls };
}

test('first task commits the receipt-aware session format before any model can run', async t => {
  const f = await fixture(t), { r } = runtime(f, f.data); await r.create(input());
  const file = JSON.parse(await fs.readFile(path.join(f.data, 'state/rag-sessions.json'), 'utf8'));
  assert.deepEqual(file.taskReceipts, []); assert.deepEqual(file.sessions, []);
});

test('receipt format write failure prevents task acceptance and model execution', async t => {
  const f = await fixture(t), id = randomUUID();
  await createRagSession({ id, mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [
    { id: randomUUID(), role: 'user', content: '合成旧问题', status: 'complete' }, { id: randomUUID(), role: 'assistant', content: '合成旧回答', status: 'complete' }
  ] });
  await fs.writeFile(path.join(f.root, 'backups/rag-sessions'), 'synthetic backup blocker');
  const before = await fs.readFile(path.join(f.data, 'state/rag-sessions.json')), { r, calls } = runtime(f, f.data);
  await assert.rejects(r.create(input())); await wait(50);
  assert.equal(calls(), 0); assert.deepEqual(r.store.list(), []);
  assert.deepEqual(await fs.readFile(path.join(f.data, 'state/rag-sessions.json')), before);
});

test('offline archive keeps JSON receipt and SQLite result consistent; restore interrupts old active and queued tasks', async t => {
  const f = await fixture(t), store = new RagTaskStore(f.data), owner = `${process.pid}:${randomUUID()}`;
  const firstInput = input(), first = store.create(firstInput, []); assert.ok(store.leader(owner)); store.claim(owner);
  const result = { answer: '合成归档保留同一份完整回答。', citations: [] };
  store.finish(store.get(first.id), 'succeeded', result); store.release(first.id);
  await applyRagTaskResult({ taskId: first.id, sessionId: first.sessionId, baseVersion: null, question: firstInput.question, answerMode: 'logs_only', ...result });
  // Simulate the crash window: JSON receipt committed, SQLite save acknowledgement missing.
  assert.equal(store.get(first.id).saveState, 'pending');
  const running = store.create(input(), []); store.claim(owner); store.progress(store.get(running.id), '合成已生成片段', '合成生成中');
  const queued = store.create(input(), []); store.close();
  const jsonFile = path.join(f.data, 'state/rag-sessions.json'), jsonBefore = await fs.readFile(jsonFile);
  const dbBefore = await fs.readFile(path.join(f.data, 'state/rag-tasks.sqlite'));
  await backupInstance(f.root, f.archive); const verified = await verifyArchive(f.archive);
  assert.equal(verified.manifest.version, 2, 'task archives require a task-aware restore tool');
  for (const [name, bytes] of [['data/state/rag-sessions.json', jsonBefore], ['data/state/rag-tasks.sqlite', dbBefore]]) assert.equal(verified.manifest.entries.find(entry => entry.path === name).sha256, sha(bytes));
  await restoreInstance(f.archive, f.target); assert.deepEqual(await fs.readFile(path.join(f.target, 'data/state/rag-sessions.json')), jsonBefore);
  const restored = new RagTaskStore(path.join(f.target, 'data'));
  try {
    assert.equal(restored.get(running.id).state, 'interrupted'); assert.equal(restored.get(running.id).partial, '合成已生成片段');
    assert.equal(restored.get(queued.id).state, 'interrupted'); assert.equal(restored.get(first.id).state, 'succeeded');
  } finally { restored.close(); }
  process.env.LOG_ROOT = path.join(f.target, 'data'); process.env.BACKUP_ROOT = path.join(f.target, 'backups');
  const { r, calls } = runtime(f, process.env.LOG_ROOT); r.start();
  for (let n = 0; n < 100 && r.store.get(first.id).saveState !== 'saved'; n++) await wait(20);
  assert.equal(r.store.get(first.id).saveState, 'saved'); await wait(250); assert.equal(calls(), 0);
  const jsonAfter = JSON.parse(await fs.readFile(path.join(f.target, 'data/state/rag-sessions.json'), 'utf8'));
  assert.equal(jsonAfter.sessions.length, 1); assert.equal(jsonAfter.sessions[0].messages.length, 2); assert.equal(jsonAfter.taskReceipts.length, 1);
  assert.deepEqual(await fs.readFile(jsonFile), jsonBefore); assert.deepEqual(await fs.readFile(path.join(f.data, 'state/rag-tasks.sqlite')), dbBefore);
});

for (const kind of ['corrupt', 'future']) test(`restore fails closed for ${kind} task database and retains incomplete marker`, async t => {
  const f = await fixture(t), file = path.join(f.data, 'state/rag-tasks.sqlite'); await fs.mkdir(path.dirname(file));
  if (kind === 'corrupt') await fs.writeFile(file, 'synthetic invalid SQLite');
  else { const db = new DatabaseSync(file); db.exec('PRAGMA user_version=999'); db.close(); }
  await backupInstance(f.root, f.archive); const before = await fs.readFile(f.archive);
  await assert.rejects(restoreInstance(f.archive, f.target), { code: 'RESTORE_INCOMPLETE' });
  assert.ok(await fs.stat(path.join(f.target, '.restore-incomplete.json')));
  assert.ok(await fs.stat(path.join(f.target, 'data/.instance-operation.lock')));
  assert.deepEqual(await fs.readFile(f.archive), before);
});

test('opening a newer task schema does not rewrite its SQLite journal metadata', async t => {
  const f = await fixture(t), file = path.join(f.data, 'state/rag-tasks.sqlite'); await fs.mkdir(path.dirname(file));
  const db = new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL; PRAGMA user_version=999'); db.close();
  const before = await fs.readFile(file);
  assert.throws(() => new RagTaskStore(f.data), /newer application/);
  assert.deepEqual(await fs.readFile(file), before);
});

test('current restore also interrupts tasks from a legacy V1 archive', async t => {
  const f = await fixture(t), store = new RagTaskStore(f.data), queued = store.create(input(), []); store.close();
  await backupInstance(f.root, f.archive);
  const raw = await fs.readFile(f.archive), magic = Buffer.from('STUDY-LOG-INSTANCE\0V1\n'), offset = magic.length + 4;
  const length = raw.readUInt32BE(magic.length), manifest = JSON.parse(raw.subarray(offset, offset + length));
  assert.equal(manifest.version, 2); manifest.version = 1;
  const bytes = Buffer.from(JSON.stringify(manifest)); assert.equal(bytes.length, length);
  const legacy = Buffer.concat([raw.subarray(0, offset), bytes, raw.subarray(offset + length)]), file = path.join(f.base, 'legacy.slarchive');
  await fs.writeFile(file, legacy); await fs.writeFile(file + '.sha256', sha(legacy) + '\n');
  await restoreInstance(file, f.target); const restored = new RagTaskStore(path.join(f.target, 'data'));
  try { assert.equal(restored.get(queued.id).state, 'interrupted'); } finally { restored.close(); }
});
