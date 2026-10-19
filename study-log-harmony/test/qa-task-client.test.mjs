import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, task, submission, plain } from './qa-task-fixture.mjs';

for (const oldState of ['conflict', 'error']) for (const newState of ['running', 'error', 'saved']) for (const reverse of [false, true]) {
  test(`native discovery retains old ${oldState} beside new ${newState}, reverse ${reverse}`, async t => {
    const f = await fixture(); t.after(() => f.client.stop()); const sid = randomUUID();
    const old = task(sid, { state: 'succeeded', saveState: oldState, result: { answer: '旧完整答案', citations: [] } });
    const newer = task(sid, { createdAt: '2026-10-18T02:00:00.000Z', state: newState === 'running' ? 'running' : 'succeeded',
      saveState: newState === 'running' ? 'pending' : newState, result: newState === 'running' ? null : { answer: '新完整答案', citations: [] } });
    for (const value of reverse ? [newer, old] : [old, newer]) f.tasks.set(value.id, value);
    await f.client.connect(); assert.equal(f.client.tasks.length, 2); assert.equal(f.client.tasks.find(value => value.id === old.id).result.answer, '旧完整答案');
    const reads = f.requests.length; await f.client.refresh(); assert.equal(f.requests.length, reads + 1, 'unchanged snapshots do not reread full answers');
    assert.ok(f.requests.every(value => value.instance === f.instanceId));
  });
}

test('lost creation acknowledgement recovers the accepted identity after reopening without another generation', async t => {
  const f = await fixture(); await f.client.connect(); const input = submission(), post = f.transport.postForInstance;
  f.transport.postForInstance = async (...args) => { await post(...args); throw Error('lost response'); };
  await f.client.submit(input); assert.equal(f.tasks.size, 1); assert.equal(JSON.parse(f.local.raw)[0].submissionId, input.submissionId); f.client.stop();
  f.transport.postForInstance = post; const next = new f.QaTaskClient(f.transport, f.local, f.instanceId); t.after(() => next.stop());
  await next.connect(); assert.equal(next.pending.length, 0); assert.equal(next.tasks.length, 1);
  assert.equal(f.requests.filter(value => value.method === 'POST' && value.path === '/rag/tasks').length, 1);
});

test('unsent recovery retries the identical persisted submission and storage failure never sends', async t => {
  const f = await fixture(); await f.client.connect(); const input = submission(), post = f.transport.postForInstance;
  f.transport.postForInstance = async () => { throw Error('offline'); }; await f.client.submit(input); f.client.stop();
  f.transport.postForInstance = post; const next = new f.QaTaskClient(f.transport, f.local, f.instanceId); t.after(() => next.stop()); await next.connect();
  assert.equal(f.tasks.size, 1); assert.deepEqual(f.requests.find(value => value.method === 'POST').body, input);
  const count = f.requests.length; f.local.fail = true; await assert.rejects(next.submit(submission()), /storage unavailable/); assert.equal(f.requests.length, count);
});

test('stop intent survives an uncertain submission and is applied only to the recovered task', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); await f.client.connect(); const input = submission(), post = f.transport.postForInstance;
  f.transport.postForInstance = async (...args) => { await post(...args); throw Error('lost'); };
  await f.client.submit(input); await f.client.stopPending(input.sessionId); assert.equal(JSON.parse(f.local.raw)[0].cancelRequested, true);
  f.transport.postForInstance = post; await f.client.refresh(); assert.equal(f.client.pending.length, 0);
  assert.equal([...f.tasks.values()][0].state, 'cancelled'); assert.equal(f.tasks.size, 1);
  assert.equal(f.requests.filter(value => value.method === 'POST' && value.path === '/rag/tasks').length, 1);
});

test('save, cancel and discard keep selected identity and never use legacy generation or session writes', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); const sid = randomUUID(), old = task(sid, { state: 'succeeded', saveState: 'error', result: { answer: '旧答案', citations: [] } }), active = task(sid);
  f.tasks.set(old.id, old); f.tasks.set(active.id, active); await f.client.connect();
  await f.client.save(old.id); await f.client.cancel(active.id); await f.client.remove(old.id);
  assert.ok(!f.tasks.has(old.id)); assert.equal(f.tasks.get(active.id).state, 'cancelled');
  assert.deepEqual(f.requests.filter(value => value.method !== 'GET').map(value => value.path), [`/rag/tasks/${old.id}/save`, `/rag/tasks/${active.id}/cancel`, `/rag/tasks/${old.id}`]);
});

test('a successful captured snapshot cannot reappear after deletion is confirmed', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); const value = task(); f.tasks.set(value.id, value); await f.client.connect();
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve), get = f.transport.getForInstance;
  let hold = true; f.transport.getForInstance = async (...args) => { const result = await get(...args); if (args[0].endsWith(value.id) && hold) { hold = false; started(); await gate; } return result; };
  const reading = f.client.read(value.id); await start; f.tasks.delete(value.id); await f.client.refresh(); assert.equal(f.client.tasks.length, 0); release(); await reading;
  assert.equal(f.client.tasks.length, 0);
});

test('unknown or unavailable task capability blocks submission and malformed pending data is retained', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); const get = f.transport.getForInstance;
  f.transport.getForInstance = async (path, instance) => path === '/capabilities' ? { instanceId: f.instanceId, features: { ragTasks: { supported: true, configured: true, protocolVersion: 9 } } } : get(path, instance);
  await f.client.connect(); assert.equal(f.client.ready, false); await assert.rejects(f.client.submit(submission()), /尚未就绪/); assert.equal(f.requests.filter(value => value.method === 'POST').length, 0);
  f.local.raw = '{broken'; await f.client.connect(); assert.equal(f.client.ready, false); assert.equal(f.local.raw, '{broken');
});

test('a changed server instance is rejected before replay and disconnect keeps an unacknowledged submission', async t => {
  const f = await fixture(); await f.client.connect(); const input = submission(); let release;
  const post = f.transport.postForInstance; f.transport.postForInstance = async (...args) => { const value = await post(...args); await new Promise(resolve => release = resolve); return value; };
  const submitting = f.client.submit(input); while (!release) await new Promise(resolve => setImmediate(resolve)); f.client.stop(); release(); await submitting;
  assert.equal(JSON.parse(f.local.raw)[0].submissionId, input.submissionId);
  f.transport.getForInstance = async () => ({ instanceId: randomUUID(), features: {} }); const other = new f.QaTaskClient(f.transport, f.local, f.instanceId); t.after(() => other.stop());
  await other.connect(); assert.equal(other.ready, false); assert.match(other.error, /实例已变化/); assert.equal(JSON.parse(f.local.raw)[0].submissionId, input.submissionId);
});

test('reopening never replays pending preferences until their flush succeeds', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); const input = submission(); f.local.raw = JSON.stringify([input]); f.local.fail = true;
  await f.client.connect(); assert.equal(f.client.ready, false); assert.equal(f.tasks.size, 0); assert.equal(JSON.parse(f.local.raw)[0].submissionId, input.submissionId);
  f.local.fail = false; await f.client.connect(); assert.equal(f.tasks.size, 1); assert.equal(f.client.pending.length, 0);
});

test('disconnected or replaced connection cannot send task actions to a new instance binding', async () => {
  const f = await fixture(); await f.client.connect(); const value = task(); f.tasks.set(value.id, value); const before = f.requests.length;
  f.transport.getConnectionBinding = () => 'replacement-connection'; await assert.rejects(f.client.cancel(value.id), /连接已切换/);
  await assert.rejects(f.client.save(value.id), /连接已切换/); await assert.rejects(f.client.submit(submission()), /连接已切换/);
  assert.equal(f.requests.length, before); f.client.stop(); await assert.rejects(f.client.remove(value.id), /停止查看/);
});

test('historical presentation uses only its own pair, with stable message ids and original citations', async () => {
  const f = await fixture(), value = task(undefined, { state: 'succeeded', saveState: 'conflict', result: { answer: '旧回答', citations: [{ sourceId: 'S1', date: '2026-09-01' }] } });
  const saved = { messages: [{ id: 'later', role: 'assistant', content: '后来的已保存内容' }] };
  const messages = plain(f.taskMessages(value, saved, true)); assert.equal(messages.length, 2); assert.equal(messages[1].content, '旧回答');
  assert.equal(messages[1].id, `${value.id}:assistant`); assert.equal(messages[1].citations[0].date, '2026-09-01'); assert.equal(saved.messages[0].content, '后来的已保存内容');
});
