import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RagTaskClient, ragTaskMessages, validRagTask, newestRagTask, ragTaskRetained } from '../lib/rag-task-client.ts';
import { ApiRequestError } from '../lib/client-http.ts';

const instance = randomUUID();
const input = () => ({ submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成问题', mode: 'logs_only', createdAt: new Date().toISOString() });

test('newest and retained task selection ignore a newer superseded branch', () => {
  const usable={id:'first',sessionId:'s',createdAt:'2026-10-01T00:00:00Z',state:'running',saveState:'pending'};
  const oldBranch={...usable,id:'second',createdAt:'2026-10-02T00:00:00Z',applicable:false};
  assert.equal(newestRagTask([usable,oldBranch],'s'),usable);
  assert.equal(ragTaskRetained(oldBranch),false);assert.equal(ragTaskRetained(usable),true);
});

test('an older in-flight GET cannot revive a task after a same-revision superseded summary',async()=>{
 const original=taskFor(input()),snapshots=[];let release;
 const delayed=new Promise(resolve=>{release=resolve;});
 const client=new RagTaskClient(instance,{getItem:()=>null,setItem(){},removeItem(){}},
  {task:value=>snapshots.push(value),pending(){},rejected(){},missing(){},error(){}},
  async url=>url==='/api/rag/tasks'?{tasks:[{...original,applicable:false}]}:delayed);
 client.track(original);
 const oldRead=client.select(original.id);await client.refresh();
 assert.equal(snapshots.at(-1).applicable,false);
 release({task:{...original,applicable:true}});await oldRead;
 client.track(original);await client.select(original.id);
 assert.ok(snapshots.every(task=>task.applicable===false));client.stop();
});
const taskFor = value => ({ id: randomUUID(), ...value, replaceLast: false, state: 'running', revision: 1, updatedAt: value.createdAt,
  partial: '合成片段', stage: '正在回答', result: null, error: '', errorCode: '', saveState: 'pending', saveError: '' });
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
function fixture() {
  const local = storage(), tasks = new Map(), snapshots = [], errors = [], pending = [], rejected = [], missing = [], writes = [], actions = [];
  let lose = false, calls = 0;
  const request = async (url, init) => {
    assert.equal(init.headers['X-Study-Log-Instance'], instance);
    if (url === '/api/rag/tasks' && init.method === 'POST') {
      const value = JSON.parse(init.body); writes.push(value);
      let task = [...tasks.values()].find(task => task.submissionId === value.submissionId);
      if (!task) { calls++; task = taskFor({ ...value, createdAt: new Date().toISOString() }); tasks.set(task.id, task); }
      if (lose) { lose = false; throw new Error('synthetic response loss'); }
      return { task: { ...task } };
    }
    if (url === '/api/rag/tasks') return { tasks: [...tasks.values()].map(task => ({ ...task, questionPreview: task.question })) };
    const id = url.split('/')[4], task = tasks.get(id);
    if (!task) throw new ApiRequestError('deleted', 404);
    if (init.method) actions.push({ id, method: init.method, url });
    if (init.method === 'DELETE') { tasks.delete(id); return { removed: true }; }
    if (url.endsWith('/cancel')) Object.assign(task, { state: 'cancelled', revision: task.revision + 1 });
    if (url.endsWith('/save')) Object.assign(task, { saveState: 'saved', revision: task.revision + 1 });
    return { task: { ...task } };
  };
  const client = (id = instance, backing = local, transport = request) => new RagTaskClient(id, backing, { task: task => snapshots.push(task), error: value => errors.push(value), pending: value => pending.push(value), rejected: (...value) => rejected.push(value), missing: value => missing.push(value) }, transport);
  return { local, tasks, snapshots, errors, pending, rejected, missing, writes, actions, request, client, lose: () => { lose = true; }, calls: () => calls };
}

test('lost creation response survives a client restart with the same identity and one execution', async () => {
  const f = fixture(), value = input(), first = f.client(); f.lose();
  await first.submit(value); assert.equal(f.calls(), 1); assert.equal(f.local.values.size, 1); first.stop();
  const second = f.client(); await second.refresh();
  assert.equal(f.calls(), 1); assert.equal(f.local.values.size, 0); assert.equal(f.snapshots.length, 1);
  assert.equal(f.snapshots[0].submissionId, value.submissionId); second.stop();
});
test('uncertain submission retries reuse the exact body even when a later list omits it', async () => {
  const f = fixture(), value = input(), client = f.client(); f.lose(); await client.submit(value);
  f.tasks.clear(); await client.refresh();
  assert.deepEqual(f.writes[0], f.writes[1]); assert.equal(f.local.values.size, 0); client.stop();
});
test('pending submissions are isolated by instance and not replayed to a different instance', async () => {
  const f = fixture(), client = f.client(); f.lose(); await client.submit(input()); client.stop();
  let posts = 0;
  const other = new RagTaskClient(randomUUID(), f.local, { task() {}, pending() {}, rejected() {}, missing() {}, error() {} }, async () => { posts++; return { tasks: [] }; });
  await other.refresh(); assert.equal(posts, 1); assert.equal(f.local.values.size, 1); other.stop();
});
test('storage failure prevents the first network submission', async () => {
  const f = fixture(), client = f.client(instance, { getItem: () => null, setItem() { throw new Error('storage blocked'); }, removeItem() {} });
  await assert.rejects(client.submit(input()), /storage blocked/); assert.equal(f.calls(), 0); client.stop();
});
test('second browser discovers running tasks; revisions replace snapshots and reject duplicates', async () => {
  const f = fixture(), first = f.client(); await first.submit(input()); first.stop();
  f.snapshots.length = 0; const second = f.client(instance, storage()); await second.refresh(); await second.refresh();
  assert.equal(f.snapshots.length, 1);
  const task = [...f.tasks.values()][0]; task.revision++; task.partial = '合成片段更新'; await second.refresh();
  assert.equal(f.snapshots.length, 2); assert.equal(f.snapshots[1].partial, '合成片段更新'); second.stop();
});
test('cancel and save recovery do not create a new generation, and deletion clears tracked results', async () => {
  const f = fixture(), client = f.client(); await client.submit(input()); const task = [...f.tasks.values()][0];
  await client.stopSession(task.sessionId); assert.equal(f.snapshots.at(-1).state, 'cancelled');
  Object.assign(task, { state: 'succeeded', result: { answer: '完整回答', citations: [] }, saveState: 'error', revision: task.revision + 1 });
  await client.refresh(); await client.save(task.id); assert.equal(f.snapshots.at(-1).saveState, 'saved'); assert.equal(f.calls(), 1);
  Object.assign(task, { saveState: 'conflict', revision: task.revision + 1 }); await client.refresh();
  f.tasks.delete(task.id); await client.refresh(); assert.equal(f.missing.length, 1); client.stop();
});
test('task view uses stable message ids, never appends repeated snapshots and respects the saved session', () => {
  const task = taskFor(input()); const a = ragTaskMessages(task, null), b = ragTaskMessages({ ...task, partial: '新片段' }, null);
  assert.equal(a.length, 2); assert.equal(b.length, 2); assert.equal(a[1].id, b[1].id); assert.equal(b[1].content, '新片段');
  const session = { messages: [{ id: 'later', role: 'assistant', content: '另一端后续修改' }] };
  assert.deepEqual(ragTaskMessages({ ...task, saveState: 'saved' }, session), session.messages);
});

test('stop during an uncertain creation persists cancellation and applies it after discovery', async () => {
  const f = fixture(), value = input(), client = f.client(); f.lose(); await client.submit(value);
  await client.stopSession(value.sessionId); assert.equal(f.calls(), 1);
  const pending = JSON.parse([...f.local.values.values()][0]); assert.equal(pending[0].cancelRequested, true);
  await client.refresh(); assert.equal(f.snapshots.at(-1).state, 'cancelled'); assert.equal(f.calls(), 1); assert.equal(f.local.values.size, 0); client.stop();
});

test('a replacement viewer reconciles a retained active task that completed while disconnected', async () => {
  const f = fixture(), first = f.client(); await first.submit(input()); const old = f.snapshots.at(-1); first.stop();
  const task = f.tasks.get(old.id); Object.assign(task, { state: 'succeeded', result: { answer: '断开期间的完整回答', citations: [] }, saveState: 'saved', revision: task.revision + 2 });
  f.snapshots.length = 0; const next = f.client(instance, storage()); next.track(old); await next.refresh();
  assert.equal(f.snapshots.length, 1); assert.equal(f.snapshots[0].state, 'succeeded'); assert.equal(f.snapshots[0].result.answer, '断开期间的完整回答'); assert.equal(f.calls(), 1); next.stop();
});
test('regeneration replaces the old pair only in the task view, without mutating saved messages', () => {
  const previous = Array.from({ length: 4 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const task = { ...taskFor(input()), replaceLast: true };
  const view = ragTaskMessages(task, { messages: previous });
  assert.equal(view.length, 4); assert.deepEqual(view.slice(0, 2), previous.slice(0, 2)); assert.equal(previous.length, 4);
});

for (const olderState of ['conflict', 'error']) for (const newerState of ['running', 'error', 'saved']) for (const reverse of [false, true]) {
  test(`all retained results reach the viewer: old ${olderState}, new ${newerState}, reverse ${reverse}`, async () => {
    const f = fixture(), sid = randomUUID();
    const older = { ...taskFor({ ...input(), sessionId: sid, createdAt: '2026-10-18T00:00:01.000Z' }), state: 'succeeded', saveState: olderState, result: { answer: '旧的完整回答', citations: [] } };
    const newer = { ...taskFor({ ...input(), sessionId: sid, createdAt: '2026-10-18T00:00:02.000Z' }), state: newerState === 'running' ? 'running' : 'succeeded', saveState: newerState === 'running' ? 'pending' : newerState, result: newerState === 'running' ? null : { answer: '新的完整回答', citations: [] } };
    for (const task of reverse ? [newer, older] : [older, newer]) f.tasks.set(task.id, task);
    const client = f.client(); await client.refresh(); await client.refresh();
    assert.equal(f.snapshots.filter(task => task.id === older.id).length, 1);
    assert.equal(f.snapshots.find(task => task.id === older.id).result.answer, '旧的完整回答'); assert.equal(f.calls(), 0); client.stop();
  });
}

test('explicit selection publishes a cached old result and operations keep the chosen task identity', async () => {
  const f = fixture(), sid = randomUUID();
  const older = { ...taskFor({ ...input(), sessionId: sid, createdAt: '2026-10-18T00:00:01Z' }), state: 'succeeded', saveState: 'error', result: { answer: '旧回答', citations: [] } };
  const newer = { ...taskFor({ ...input(), sessionId: sid, createdAt: '2026-10-18T00:00:02Z' }) };
  f.tasks.set(older.id, older); f.tasks.set(newer.id, newer); const client = f.client(); await client.refresh();
  await client.select(older.id); assert.equal(f.snapshots.at(-1).id, older.id); assert.equal(f.snapshots.at(-1).result.answer, '旧回答');
  await client.save(older.id); assert.equal(f.tasks.get(older.id).saveState, 'saved'); assert.equal(f.tasks.get(newer.id).state, 'running');
  await client.remove(older.id); assert.equal(f.tasks.has(older.id), false); assert.equal(f.tasks.has(newer.id), true);
  assert.ok(f.actions.every(action => action.id === older.id)); assert.equal(f.calls(), 0); client.stop();
});
test('historical result presentation cannot merge later saved conversation messages into the old answer', () => {
  const older = { ...taskFor(input()), state: 'succeeded', saveState: 'conflict', result: { answer: '旧回答', citations: [] } };
  const session = { messages: [{ id: 'future', role: 'assistant', content: '后来的已保存回答' }] };
  const view = ragTaskMessages(older, session, true);
  assert.equal(view.length, 2); assert.equal(view[0].content, older.question); assert.equal(view[1].content, '旧回答'); assert.equal(session.messages[0].content, '后来的已保存回答');
});

test('a captured old snapshot cannot revive a task after discovery confirms deletion', async () => {
  const f = fixture(), old = taskFor(input()); f.tasks.set(old.id, old);
  let hold = false, release, started;
  const gate = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { started = resolve; });
  const client = f.client(instance, storage(), async (url, init) => {
    const response = await f.request(url, init);
    if (hold && url.endsWith(old.id)) { hold = false; started(); await gate; }
    return response;
  });
  await client.refresh(); const count = f.snapshots.length; hold = true; const selecting = client.select(old.id); await start;
  f.tasks.delete(old.id); await client.refresh(); assert.equal(f.missing.length, 1); release(); await selecting;
  assert.equal(f.snapshots.length, count); await client.refresh(); assert.equal(f.snapshots.length, count); client.stop();
});

test('scoped history loads saved versions outside discovery window and ignores unchanged revisions', async () => {
  const f=fixture(), value=input(), task=taskFor(value); Object.assign(task,{state:'succeeded',saveState:'saved',result:{answer:'saved',citations:[]},questionMessageId:'stable-question',previousAnswer:{id:'old-answer',role:'assistant',content:'previous'}}); f.tasks.set(task.id,task);
  const paths=[];const client=f.client(instance,storage(),async(url,init)=>{paths.push(url);if(url.startsWith('/api/rag/tasks?sessionId='))return {tasks:[{...task}]};return f.request(url,init)});
  await client.refresh();assert.equal(f.snapshots.length,0);await client.readSession(value.sessionId);assert.equal(f.snapshots.length,1);assert.equal(f.snapshots[0].previousAnswer.content,'previous');
  const reads=paths.filter(p=>p.endsWith(task.id)).length;await client.readSession(value.sessionId);assert.equal(paths.filter(p=>p.endsWith(task.id)).length,reads);client.stop();
  assert.equal(validRagTask({...task,questionMessageId:42}),false);assert.equal(validRagTask({...task,previousAnswer:{role:'user',id:'bad',content:'bad'}}),false);
});

test('retry causal identity survives acknowledgement loss, pending cancellation and reconnect', async () => {
  const f=fixture(), value={...input(),retryTaskId:randomUUID()}, first=f.client();f.lose();
  await first.submit(value);assert.equal(JSON.parse([...f.local.values.values()][0])[0].retryTaskId,value.retryTaskId);
  first.stop();const second=f.client();await second.stopSession(value.sessionId);await second.refresh();
  assert.equal(f.calls(),1);assert.equal(f.writes[0].retryTaskId,value.retryTaskId);assert.equal(f.local.values.size,0);
  assert.equal([...f.tasks.values()][0].state,'cancelled');second.stop();
});
