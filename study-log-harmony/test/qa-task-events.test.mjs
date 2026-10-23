import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, task, qaView } from './qa-task-fixture.mjs';
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function streams(f) {
  const connections = [];
  f.transport.getEventStreamForInstance = (path, instance, emit, cancellation) => new Promise((resolve, reject) => {
    const connection = { path, instance, emit, cancellation, resolve, reject }; connections.push(connection);
    cancellation.bind(() => resolve());
  });
  return connections;
}
test('native viewed task accepts fragmented events before any polling or completion', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const first = task(undefined, { partial: '', revision: 1 }); f.tasks.set(first.id, first);
  f.client.viewSession(first.sessionId); await f.client.refresh(); await settle();
  assert.equal(connections.length, 1); assert.match(connections[0].path, /events\?after=1$/);
  const second = { ...first, revision: 2, partial: '先收到的文字' };
  const frame = `id: 2\r\nevent: snapshot\r\ndata: ${JSON.stringify({ task: second })}\r\n\r\n`;
  for (const ch of frame) connections[0].emit(ch);
  assert.equal(f.client.tasks[0].partial, second.partial);
  assert.equal(f.client.tasks[0].state, 'running');
  connections[0].emit(`event: snapshot\ndata: ${JSON.stringify({ task: first })}\n\n`);
  assert.equal(f.client.tasks[0].revision, 2, 'old snapshots cannot rewind output');
});
test('native disconnect reconciles and reconnects from accepted revision without new POST', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const first = task(); f.tasks.set(first.id, first); f.client.viewSession(first.sessionId); await f.client.refresh();
  connections[0].reject(Error('synthetic timeout')); await settle();
  assert.equal(f.client.tasks[0].state, 'running');
  await f.client.refresh(); await settle(); assert.equal(connections.length, 2);
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  const complete = { ...first, revision: 3, state: 'succeeded', saveState: 'saved', result: { answer: '完整回答', citations: [] } };
  connections[1].emit(`event: snapshot\ndata: ${JSON.stringify({ task: complete })}\n\n`);
  assert.equal(f.client.tasks[0].result.answer, '完整回答');
  assert.equal(f.client.connectionError, '', 'recovered task cannot retain transport timeout');
});
test('native switching view and stopping disconnect only observation, rejecting old connection callbacks', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const a = task(), b = task(); f.tasks.set(a.id, a); f.tasks.set(b.id, b);
  f.client.viewSession(a.sessionId); await f.client.refresh(); await settle();
  f.client.viewSession(b.sessionId); await settle();
  assert.equal(connections[0].cancellation.cancelled, true);
  connections[0].emit(`event: snapshot\ndata: ${JSON.stringify({ task: { ...a, revision: 9, partial: '过期回调' } })}\n\n`);
  assert.equal(f.client.tasks.find(x => x.id === a.id).revision, 1);
  f.client.stop(); assert.equal(connections[1].cancellation.cancelled, true);
  assert.equal(f.requests.some(r => r.path.endsWith('/cancel')), false);
});

test('native queued snapshots do not invent a previous blocker and live failure remains task-owned', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); await f.client.connect();
  const queued = task(undefined, { state: 'queued', partial: '', stage: '' }); f.tasks.set(queued.id, queued);
  const controller = new f.QaSessionController(f.transport, qaView(), f.client);
  controller.sessionId = queued.sessionId; f.client.onChange = () => controller.applyTasks();
  await f.client.refresh();
  assert.equal(controller.sending, true); assert.doesNotMatch(controller.statusText, /前一|上一/);
  Object.assign(queued, { revision: 2, state: 'failed', error: '真实任务失败' }); await f.client.refresh();
  assert.equal(controller.sending, false); assert.equal(controller.errorMessage, '真实任务失败');
});
test('native malformed or mismatched event leaves existing task intact and reconnects without resubmit', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const first = task(); f.tasks.set(first.id, first); f.client.viewSession(first.sessionId); await f.client.refresh();
  const foreign = { ...first, sessionId: task().sessionId, revision: 3 };
  assert.throws(() => connections[0].emit(`event: snapshot\ndata: ${JSON.stringify({ task: foreign })}\n\n`), /身份/);
  connections[0].reject(Error('invalid snapshot')); await settle();
  assert.equal(f.client.tasks[0].revision, 1); await f.client.refresh();
  assert.equal(connections.length, 2); assert.equal(f.requests.some(r => r.method === 'POST'), false);
});

test('native active EOF is reconciled and same-revision recovery clears connection feedback immediately', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const first = task(); f.tasks.set(first.id, first); f.client.viewSession(first.sessionId); await f.client.refresh();
  let notices = []; f.client.onChange = () => notices.push(f.client.connectionError);
  connections[0].resolve(); await settle(); assert.ok(f.client.connectionError, 'active EOF is an observation interruption');
  await f.client.refresh(); await settle(); assert.equal(connections.length, 2);
  notices=[]; f.client.connectionError='same-revision reconnect feedback'; connections[1].emit(`event: snapshot\ndata: ${JSON.stringify({ task: first })}\n\n`);
  assert.equal(f.client.connectionError, ''); assert.ok(notices.includes(''), 'unchanged valid snapshot publishes recovery');
  assert.equal(f.client.tasks[0].partial, first.partial); assert.equal(f.requests.some(r => r.method === 'POST'), false);
});

test('native new conversation detaches previous observation without stopping its task', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const first = task(); f.tasks.set(first.id, first);
  const controller = new f.QaSessionController(f.transport, qaView(), f.client);
  controller.sessionId = first.sessionId; f.client.onChange = () => controller.applyTasks();
  await f.client.refresh(); assert.equal(connections.length, 1);
  connections[0].reject(Error('old viewing error')); await settle(); assert.equal(controller.taskError, 'old viewing error');
  await f.client.refresh(); await settle(); await controller.newSession();
  assert.equal(connections.at(-1).cancellation.cancelled, true); assert.equal(controller.taskError, '');
  assert.equal(f.tasks.get(first.id).state, 'running');
  assert.equal(f.requests.some(r => r.path.endsWith('/cancel')), false);
});

test('native successful same-revision GET reconciles an event interruption even before another delta arrives', async t => {
  const f = await fixture(), connections = streams(f); t.after(() => f.client.stop()); await f.client.connect();
  const first = task(); f.tasks.set(first.id, first); f.client.viewSession(first.sessionId); await f.client.refresh();
  connections[0].reject(Error('temporary viewing timeout')); await settle();
  assert.equal(f.client.connectionError,'temporary viewing timeout');
  const reads=f.requests.filter(r=>r.path===`/rag/tasks/${first.id}`).length;
  await f.client.refresh(); await settle();
  assert.equal(f.requests.filter(r=>r.path===`/rag/tasks/${first.id}`).length,reads+1);
  assert.equal(f.client.connectionError,''); assert.equal(f.client.tasks[0].revision,first.revision);
});
