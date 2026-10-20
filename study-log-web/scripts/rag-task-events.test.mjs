import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RagTaskClient, requestRagTaskEvents } from '../lib/rag-task-client.ts';

const instance = randomUUID();
const input = () => ({ submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成问题', mode: 'logs_only', createdAt: new Date().toISOString() });
const taskFor = value => ({ id: randomUUID(), ...value, replaceLast: false, state: 'running', revision: 1, updatedAt: value.createdAt,
  partial: '合成片段', stage: '正在回答', result: null, error: '', errorCode: '', saveState: 'pending', saveError: '' });
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

test('visible running task consumes real snapshots before polling; leaving aborts only the viewing stream', async () => {
  const value = input(), task = taskFor(value), seen = [], connections = [];
  const request = async () => ({ tasks: [], task });
  const events = (url, init, emit) => new Promise(resolve => {
    connections.push({ url, init, emit }); init.signal.addEventListener('abort', resolve, { once: true });
  });
  const client = new RagTaskClient(instance, storage(), { task: item => seen.push(item), pending() {}, rejected() {}, missing() {}, error() {} }, request, events);
  client.track(task); client.viewSession(value.sessionId);
  assert.equal(connections.length, 1);
  assert.ok(connections[0].url.includes(`/${task.id}/events?after=1`));
  assert.equal(connections[0].init.headers['X-Study-Log-Instance'], instance);
  await connections[0].emit({ ...task, revision: 2, partial: '第一片' });
  await connections[0].emit({ ...task, revision: 3, partial: '第一片第二片' });
  await connections[0].emit({ ...task, revision: 2, partial: '迟到旧片' });
  assert.deepEqual(seen.map(item => item.partial), ['第一片', '第一片第二片']);
  client.viewSession(''); assert.equal(connections[0].init.signal.aborted, true);
  await connections[0].emit({ ...task, revision: 50, partial: '已离开视图的迟到片段' });
  assert.equal(seen.length, 2);
  client.viewSession(value.sessionId); assert.equal(connections.length, 2);
  assert.ok(connections[1].url.endsWith('after=3'));
  await connections[1].emit({ ...task, revision: 4, state: 'succeeded', result: { answer: '完整回答', citations: [] }, saveState: 'saved' });
  assert.equal(connections[1].init.signal.aborted, true); client.stop();
});

test('native task events carry the instance identity and replace complete Unicode snapshots without replay', async () => {
  const original = globalThis.EventSource, originalFetch = globalThis.fetch, seen = [], controller = new AbortController();
  let connection;
  globalThis.EventSource = class {
    listeners = new Map(); closed = false;
    constructor(url) { this.url = url; connection = this; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    close() { this.closed = true; }
  };
  globalThis.fetch = async () => { throw new Error('Task viewing must use native event framing'); };
  let failure;
  try {
    const work = requestRagTaskEvents('/api/rag/tasks/synthetic/events?after=1', { signal: controller.signal, headers: { 'X-Study-Log-Instance': instance } }, async task => seen.push(task)).catch(error => { failure = error; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(connection, failure?.message);
    assert.equal(connection.url, '/study-log/api/rag/tasks/synthetic/events?after=1&instance=' + instance);
    const previousAnswer = '中文👩🏽‍💻完整旧回答'.repeat(2000);
    connection.listeners.get('snapshot')({ data: JSON.stringify({ task: { revision: 2, partial: '第一片', previousAnswer } }) });
    connection.listeners.get('snapshot')({ data: JSON.stringify({ task: { revision: 3, partial: '完整第二片', previousAnswer } }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(seen.map(task => task.partial), ['第一片', '完整第二片']);
    assert.ok(seen.every(task => task.previousAnswer === previousAnswer));
    controller.abort(); await work; assert.equal(connection.closed, true);
  } finally { globalThis.EventSource = original; globalThis.fetch = originalFetch; controller.abort(); }
});

test('native event errors close once and abort drops queued snapshots without reconnecting itself', async () => {
  const original = globalThis.EventSource, connections = [], seen = [];
  globalThis.EventSource = class {
    listeners = new Map(); closes = 0;
    constructor() { connections.push(this); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    close() { this.closes++; }
  };
  const options = controller => ({ signal: controller.signal, headers: { 'X-Study-Log-Instance': instance } });
  try {
    for (const event of ['error', 'invalid']) {
      const controller = new AbortController();
      const work = requestRagTaskEvents('/api/rag/tasks/synthetic/events?after=4', options(controller), async task => seen.push(task));
      const rejected = assert.rejects(work, /任务事件连接中断/), source = connections.at(-1);
      if (event === 'error') source.listeners.get('error')({});
      else source.listeners.get('snapshot')({ data: 'invalid JSON' });
      await rejected; assert.equal(source.closes, 1); controller.abort(); assert.equal(source.closes, 1);
    }
    const controller = new AbortController();
    const work = requestRagTaskEvents('/api/rag/tasks/synthetic/events?after=4', options(controller), async task => seen.push(task));
    const source = connections.at(-1);
    source.listeners.get('snapshot')({ data: JSON.stringify({ task: { partial: '迟到正文' } }) });
    controller.abort(); await work; await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(seen, []); assert.equal(source.closes, 1); assert.equal(connections.length, 3);
    await assert.rejects(requestRagTaskEvents('/api/rag/tasks/synthetic/events', options(controller), async () => {}), { name: 'AbortError' });
    assert.equal(connections.length, 3);
  } finally { globalThis.EventSource = original; }
});

test('event disconnect reconnects from the reconciled revision without another submission', async () => {
  const task = taskFor(input()), seen = [], connections = []; let posts = 0;
  const request = async (url, init) => { if (init.method === 'POST') posts++; return url === '/api/rag/tasks' ? { tasks: [task] } : { task }; };
  const events = async (url, init, emit) => { connections.push({ url, init, emit }); throw new Error('synthetic disconnect'); };
  const client = new RagTaskClient(instance, storage(), { task: task => seen.push(task), pending() {}, rejected() {}, missing() {}, error() {} }, request, events);
  client.track(task); client.viewSession(task.sessionId); await new Promise(resolve => setTimeout(resolve, 0));
  task.revision = 4; task.partial = '断线后的真实快照'; await client.refresh();
  assert.ok(connections.at(-1).url.endsWith('after=4')); assert.equal(posts, 0);
  client.stop();
});

test('logout and instance replacement abort the old stream and reject late snapshots even with matching restored task IDs', async () => {
  const task = taskFor(input()), seen = [], connections = [];
  const events = (url, init, emit) => new Promise(resolve => {
    connections.push({ init, emit }); init.signal.addEventListener('abort', resolve, { once: true });
  });
  const callbacks = name => ({ task: value => seen.push([name, value.partial]), pending() {}, rejected() {}, missing() {}, error() {} });
  const first = new RagTaskClient(instance, storage(), callbacks('old'), async () => ({ tasks: [] }), events);
  first.track(task); first.viewSession(task.sessionId); first.stop();
  assert.equal(connections[0].init.signal.aborted, true);
  const secondId = randomUUID();
  const second = new RagTaskClient(secondId, storage(), callbacks('new'), async () => ({ tasks: [] }), events);
  second.track(task); second.viewSession(task.sessionId);
  assert.equal(connections[1].init.headers['X-Study-Log-Instance'], secondId);
  await connections[0].emit({ ...task, revision: 99, partial: '迟到的旧实例内容' });
  await connections[1].emit({ ...task, revision: 2, partial: '当前实例内容' });
  assert.deepEqual(seen, [['new', '当前实例内容']]);
  second.stop(); assert.equal(connections[1].init.signal.aborted, true);
});
