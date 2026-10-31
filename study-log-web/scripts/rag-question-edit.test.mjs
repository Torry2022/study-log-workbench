import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as history from '../lib/rag-history.ts';
import * as taskHelpers from '../lib/rag-task-client.ts';
import * as versions from '../lib/rag-answer-versions.ts';
import * as taskTypes from '../lib/rag-task-types.ts';
import * as times from '../lib/rag-message-time.ts';

const source = await fs.readFile(new URL('../hooks/use-rag.ts', import.meta.url), 'utf8');

// Run the actual retained-view hook. Layout/focus remain browser acceptance gates.
function fixture({ newSession = false, taskSupported = true } = {}) {
  const id = randomUUID(), requests = [], removed = [], clients = [], routes = [], allocatedIds = [], legacyRequests = [], slots = [], effects = new Map();
  let instanceId = randomUUID();
  let cursor = 0, readError, readGate, capabilityGate, capabilityError;
  const saved = { id, title: '合成会话', messageCount: 2, version: 'a'.repeat(64), answerMode: 'logs_only',
    createdAt: '2026-10-22T01:00:00Z', updatedAt: '2026-10-22T01:00:00Z',
    messages: [{ id: 'question', role: 'user', content: '原问题\n[S1]' }, { id: 'answer', role: 'assistant', content: '原回答' }] };
  const clone = value => JSON.parse(JSON.stringify(value));
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
  const options = { active: true, visible: true, routeSessionId: newSession ? '' : id, routeToken: 1,
    onConfirm: async () => true, onRoute: value => { routes.push(value); options.routeSessionId = value; } };
  const memo = (run, deps, effect) => {
    const index = cursor++, old = slots[index];
    if (old && deps?.every((value, i) => Object.is(value, old.deps[i]))) return old.value;
    if (effect) effects.set(index, () => { old?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
    else return (slots[index] = { deps, value: run() }).value;
  };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useCallback: (fn, deps) => memo(() => fn, deps, false),
    useEffect: (fn, deps) => memo(fn, deps, true)
  };
  class ApiRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
  class Client {
    constructor(_instance, _storage, callbacks) { this.instanceId = _instance; this.callbacks = callbacks; clients.push(this); }
    start() { this.started = true; } stop() { this.stopped = true; } track() {} viewSession() {} async readSession() {} async refresh() {}
    async remove(id) { removed.push(id); }
    async submit(input) { requests.push(clone(input)); this.callbacks.pending(input); }
  }
  const requestJson = async path => {
    if (path === '/api/capabilities') {
      const gate = capabilityGate; capabilityGate = undefined;
      if (gate) { gate.start(); await gate.wait; }
      if (capabilityError) throw capabilityError;
      return { instanceId, features: { ragTasks: { supported: taskSupported, configured: true,
      questionEditing: taskSupported, protocolVersion: 1 }, rag: { supported: true, configured: true } } };
    }
    if (path.startsWith('/api/rag/sessions?q=')) return { sessions: [clone(saved)] };
    if (path === `/api/rag/tasks?sessionId=${id}`) return { tasks: [] };
    if (path.split('?')[0] === `/api/rag/sessions/${id}`) {
      if (readError) throw readError;
      const response = { session: clone(saved) }, gate = readGate; readGate = undefined;
      if (gate) { gate.start(); await gate.wait; }
      return response;
    }
    throw Error('Unexpected request: ' + path);
  };
  const dependencies = { react, '@/lib/rag-history': history, '@/lib/client-http': { ApiRequestError, requestJson },
    '@/lib/rag-client': { clientUuid: () => { const value = randomUUID(); allocatedIds.push(value); return value; }, async requestRagStream(input) { assert.equal(taskSupported, false, 'task-capable servers must not use legacy generation'); legacyRequests.push(clone(input)); } },
    '@/lib/rag-task-client': { ...taskHelpers, RagTaskClient: Client }, '@/lib/rag-answer-versions': versions,
    '@/lib/rag-task-types': taskTypes, '@/lib/rag-message-time': times };
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; },
      window: { localStorage: storage(), sessionStorage: storage(), addEventListener() {}, removeEventListener() {} },
      AbortController, setTimeout, clearTimeout, console });
  let ui;
  const flushEffects = () => { const pending = [...effects.values()]; effects.clear(); for (const effect of pending) effect(); };
  const render = (flush = true) => { cursor = 0; ui = module.exports.useRag(options); if (flush) flushEffects(); return ui; };
  const settle = async (flush = true) => { for (let i = 0; i < 7; i++) { render(flush); await new Promise(resolve => setTimeout(resolve, 1)); } return render(flush); };
  const task = values => ({ id: randomUUID(), submissionId: randomUUID(), sessionId: id,
    createdAt: '2026-10-22T02:00:00Z', updatedAt: '2026-10-22T02:00:00Z', revision: 1,
    question: '修改问题', editMessageId: 'question', questionMessageId: undefined, replaceLast: false,
    mode: 'logs_only', state: 'failed', saveState: 'pending', partial: '', stage: '', error: '合成失败', saveError: '', result: null, ...values });
  return { saved, requests, removed, options, clients, routes, allocatedIds, legacyRequests, setInstance(value) { instanceId = value; }, task, render, settle, flushEffects, ApiRequestError, failRead(error) { readError = error; }, get ui() { return ui; },
    failCapabilities(error) { capabilityError = error; },
    holdCapabilities() { let release, start; const started = new Promise(resolve => start = resolve), wait = new Promise(resolve => release = resolve);
      capabilityGate = { start, wait }; return { started, release }; },
    holdRead() { let release, start; const started = new Promise(resolve => start = resolve), wait = new Promise(resolve => release = resolve);
      readGate = { start, wait }; return { started, release }; },
    feed: value => clients.at(-1).callbacks.task(value), dispose() { for (const slot of slots) slot?.cleanup?.(); } };
}

test('the first history frame is loading rather than a confirmed empty history', async t => {
  const f = fixture(); t.after(() => f.dispose());
  assert.equal(f.render().loading, true);
  await f.settle(); assert.equal(f.ui.loading, false);
});

test('cancelled inline drafts cannot be resurrected by replaying the failed edit snapshot', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('改写草稿'); f.render();
  await f.ui.sendQuestionEdit(); f.render();
  const failed = f.task({ submissionId: f.requests.at(-1).submissionId, question: '改写草稿' }); await f.feed(failed); f.render();
  assert.equal(f.ui.questionEdit.body, '改写草稿');
  f.ui.cancelQuestionEdit(); f.render(); assert.equal(f.ui.questionEdit, null);
  f.options.routeSessionId = ''; await f.settle();
  f.options.routeSessionId = f.saved.id; await f.settle();
  await f.feed({ ...failed }); await f.settle();
  assert.equal(f.ui.questionEdit, null);
  f.ui.beginQuestionEdit('question'); f.render(); assert.equal(f.ui.questionEdit.body, '原问题\n[S1]');
});

test('background canonical reads retain the original edit base until an explicit edit reload', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('保留的草稿'); f.render();
  f.saved.version = 'b'.repeat(64); f.saved.messages[0].content = '其他客户端修改';
  await f.feed(f.task({ editMessageId: undefined, questionMessageId: 'question', state: 'succeeded', saveState: 'saved', result: { answer: '原回答', citations: [] } }));
  f.render(); await f.ui.sendQuestionEdit(); f.render();
  assert.equal(f.requests.at(-1).baseVersion, 'a'.repeat(64));
  assert.equal(f.requests.at(-1).question, '保留的草稿');
});

test('removed edit targets keep a recoverable draft rather than silently rebasing it', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('仍需保留'); f.render();
  f.saved.version = 'b'.repeat(64); f.saved.messages = [{ id: 'new-question', role: 'user', content: '新分支' }, { id: 'new-answer', role: 'assistant', content: '新回答' }];
  await f.ui.reloadQuestionEdit(); f.render();
  assert.equal(f.ui.questionEdit.body, '仍需保留'); assert.equal(f.ui.questionEdit.orphaned, true);
  await f.ui.sendQuestionEdit(); assert.equal(f.requests.length, 0);
  f.ui.cancelQuestionEdit(); f.render(); assert.equal(f.ui.questionEdit, null);
});

test('a saved edit snapshot cannot discard its draft after receiving a stale old canonical branch', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('修改草稿'); f.render();
  await f.feed(f.task({ state: 'succeeded', saveState: 'saved', result: { answer: '新回答', citations: [] } }));
  f.render(); assert.equal(f.ui.questionEdit.body, '修改草稿');
  assert.equal(f.ui.submissionBlocked, true); assert.match(f.ui.error, /读取会话失败|旧版本/);
});

test('restoring a failed edit without its original pending base requires explicit rereading before send', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  await f.feed(f.task({})); f.render();
  assert.equal(f.ui.questionEdit.baseVersion, '');
  await f.ui.sendQuestionEdit(); f.render(); assert.equal(f.requests.length, 0);
  assert.match(f.ui.questionEdit.error, /重新读取/);
  f.failRead(Error('synthetic offline')); await f.ui.reloadQuestionEdit(); f.render();
  assert.equal(f.ui.questionEdit.baseVersion, '', 'a failed read cannot rebase to a cached session');
  f.failRead(undefined); f.saved.version = 'b'.repeat(64); await f.ui.reloadQuestionEdit(); f.render();
  assert.equal(f.ui.questionEdit.body, '修改问题');
  assert.equal(f.ui.questionEdit.baseVersion, 'b'.repeat(64));
  await f.ui.sendQuestionEdit(); assert.equal(f.requests.at(-1).baseVersion, 'b'.repeat(64));
});

test('confirmed session deletion retains a visible draft until explicit cancellation', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('会话删除后仍保留'); f.render();
  f.ui.setQuestion('独立底部草稿'); f.render();
  f.failRead(new f.ApiRequestError('会话已删除', 404)); await f.ui.reloadQuestionEdit(); f.render();
  assert.equal(f.ui.questionEdit.body, '会话删除后仍保留');
  assert.equal(f.ui.questionEdit.orphaned, true);
  await f.ui.sendQuestionEdit(); assert.equal(f.requests.length, 0);
  f.ui.cancelQuestionEdit(); f.render(); assert.equal(f.ui.questionEdit, null);
  assert.equal(f.options.routeSessionId, '');
  assert.equal(f.ui.question, '独立底部草稿');
});

for (const target of ['question', 'other-question']) test(`a failed external edit on ${target} cannot steal or overwrite a local editor`, async t => {
  const f = fixture(); t.after(() => f.dispose());
  f.saved.messages.push({ id: 'other-question', role: 'user', content: '另一个问题' }, { id: 'other-answer', role: 'assistant', content: '另一个回答' });
  await f.settle(); f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('尚未发送的本地稿'); f.render();
  const before = JSON.parse(JSON.stringify(f.ui.questionEdit));
  await f.feed(f.task({ editMessageId: target, question: '外部问题' })); f.render();
  assert.deepEqual(JSON.parse(JSON.stringify(f.ui.questionEdit)), before);
});

for (const editMessageId of [undefined, 'old-question']) test(`an already canonical ${editMessageId ? 'edited' : 'appended'} task is not duplicated while its session GET is held`, async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  const value = f.task({ editMessageId, state: 'succeeded', saveState: 'saved', result: { answer: '已保存回答', citations: [] } });
  f.saved.messages = [{ id: `${value.id}:user`, role: 'user', content: value.question },
    { id: `${value.id}:assistant`, role: 'assistant', content: '已保存回答' }]; f.saved.version = 'b'.repeat(64);
  await f.ui.reloadSession(); f.render();
  const gate = f.holdRead(), delivery = f.feed(value); await gate.started;
  f.render(); assert.equal(f.ui.messages.length, 2);
  assert.equal(f.ui.messages.filter(message => message.role === 'user').length, 1);
  gate.release(); await delivery; f.render(); assert.equal(f.ui.messages.length, 2);
});

test('deleting a session with multiple inline drafts keeps each orphan reachable until individually cancelled', async t => {
  const f = fixture(); t.after(() => f.dispose());
  f.saved.messages.push({ id: 'other-question', role: 'user', content: '第二题' }, { id: 'other-answer', role: 'assistant', content: '第二回答' });
  await f.settle(); f.ui.setQuestion('独立底稿');
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('第一题草稿'); f.render();
  f.ui.beginQuestionEdit('other-question'); f.render(); f.ui.changeQuestionEdit('第二题草稿'); f.render();
  f.failRead(new f.ApiRequestError('会话已删除', 404)); await f.ui.reloadQuestionEdit(); f.render();
  assert.equal(f.ui.questionEdit.body, '第二题草稿');
  f.ui.cancelQuestionEdit(); f.render(); assert.equal(f.ui.questionEdit.body, '第一题草稿');
  assert.equal(f.ui.questionEdit.orphaned, true); assert.equal(f.ui.dirty, true);
  f.ui.cancelQuestionEdit(); f.render(); assert.equal(f.ui.questionEdit, null); assert.equal(f.ui.question, '独立底稿');
});

test('normal editing needs no reread; a changed canonical version still needs review after typing', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render();
  assert.equal(f.ui.error, '');
  f.saved.version = 'b'.repeat(64);
  await f.feed(f.task({ editMessageId: undefined, questionMessageId: 'question', state: 'succeeded', saveState: 'saved', result: { answer: '原回答', citations: [] } }));
  f.render(); assert.ok(f.ui.error);
  f.ui.changeQuestionEdit('继续修改'); f.render(); assert.ok(f.ui.error);
  await f.ui.reloadSession(); f.render();
  assert.equal(f.ui.error, ''); assert.equal(f.ui.questionEdit.body, '继续修改');
});

test('typing does not hide recovery for an edit restored without its original version', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  await f.feed(f.task()); f.render();
  assert.equal(f.ui.questionEdit.baseVersion, ''); assert.ok(f.ui.error);
  f.ui.changeQuestionEdit('继续保留修改稿'); f.render();
  assert.ok(f.ui.questionEdit.error); assert.ok(f.ui.error);
  await f.ui.reloadSession(); f.render();
  assert.equal(f.ui.questionEdit.baseVersion, f.saved.version); assert.equal(f.ui.questionEdit.body, '继续保留修改稿');
  assert.equal(f.ui.error, '');
});

test('error retry can read a recovered edit whose canonical session has not loaded yet', async t => {
  const f = fixture(); t.after(() => f.dispose()); f.failRead(new Error('首次读取失败')); await f.settle();
  await f.feed(f.task()); f.render();
  assert.ok(f.ui.questionEdit); assert.equal(f.ui.questionEdit.baseVersion, '');
  assert.equal(f.ui.questionEdit.orphaned, false);
  f.ui.changeQuestionEdit('恢复的草稿'); f.render(); f.failRead(undefined);
  await f.ui.reloadSession(); f.render();
  assert.equal(f.ui.questionEdit.body, '恢复的草稿'); assert.equal(f.ui.questionEdit.baseVersion, f.saved.version);
  assert.equal(f.ui.error, '');
});

test('edit conflict keeps its retry prompt while typing and successful retry preserves both drafts', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.setQuestion('底部草稿'); f.ui.beginQuestionEdit('question'); f.render();
  await f.ui.sendQuestionEdit(); f.render();
  f.clients.at(-1).callbacks.rejected(f.requests.at(-1), new f.ApiRequestError('版本冲突', 409)); f.render();
  f.ui.changeQuestionEdit('继续改写'); f.render(); assert.match(f.ui.error, /版本冲突/);
  f.saved.version = 'b'.repeat(64); await f.ui.reloadSession(); f.render();
  assert.equal(f.ui.questionEdit.body, '继续改写'); assert.equal(f.ui.questionEdit.baseVersion, f.saved.version);
  assert.equal(f.ui.question, '底部草稿'); assert.equal(f.ui.error, '');
});

for (const accept of [false, true]) test(`edit retry ${accept ? 'accepts' : 'declines'} the existing unsaved-answer discard confirmation`, async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  let confirmations = 0; f.options.onConfirm = async () => { confirmations++; return accept; };
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('保留编辑稿'); f.render();
  await f.ui.sendQuestionEdit(); f.render();
  const task = f.task({ submissionId: f.requests.at(-1).submissionId, state: 'succeeded', saveState: 'conflict',
    saveError: '会话版本冲突', result: { answer: '未保存的完整结果', citations: [] } });
  await f.feed(task); f.render();
  f.saved.version = 'b'.repeat(64); await f.ui.reloadSession(); f.render();
  assert.equal(confirmations, 1); assert.equal(f.ui.questionEdit.body, '保留编辑稿');
  assert.deepEqual(f.removed, accept ? [task.id] : []);
  assert.equal(f.ui.questionEdit.baseVersion, accept ? f.saved.version : 'a'.repeat(64));
  if (!accept) { assert.equal(f.ui.serverTask, true); assert.ok(f.ui.messages.some(message => message.content === '未保存的完整结果')); }
});

test('a delayed retry cannot recreate a cancelled edit', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.saved.version = 'b'.repeat(64);
  const gate = f.holdRead(), reading = f.ui.reloadSession(); await gate.started;
  f.ui.cancelQuestionEdit(); f.render(); gate.release(); await reading; f.render();
  assert.equal(f.ui.questionEdit, null);
});

test('switching sessions during retry never rebases the hidden editing draft', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('保留原基线'); f.render();
  f.saved.version = 'b'.repeat(64);
  const gate = f.holdRead(), reading = f.ui.reloadSession(); await gate.started;
  f.options.routeSessionId = ''; await f.settle(); gate.release(); await reading; f.render();
  f.options.routeSessionId = f.saved.id; await f.settle();
  assert.equal(f.ui.questionEdit.body, '保留原基线'); assert.equal(f.ui.questionEdit.baseVersion, 'a'.repeat(64));
});

test('ordinary error retry keeps the existing non-edit session reload path', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.saved.version = 'b'.repeat(64); await f.ui.reloadSession(); f.render();
  assert.equal(f.ui.session.version, f.saved.version); assert.equal(f.ui.questionEdit, null);
  assert.equal(f.requests.length, 0); assert.equal(f.removed.length, 0);
});

test('a successful external branch replacement never clears an unsent local edit', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('本地还没发送'); f.render();
  const value = f.task({ state: 'succeeded', saveState: 'saved', result: { answer: '外部新回答', citations: [] } });
  f.saved.messages = [{ id: `${value.id}:user`, role: 'user', content: value.question }, { id: `${value.id}:assistant`, role: 'assistant', content: '外部新回答' }];
  f.saved.version = 'b'.repeat(64); await f.feed(value); f.render();
  assert.equal(f.ui.questionEdit.body, '本地还没发送'); assert.equal(f.ui.questionEdit.baseVersion, 'a'.repeat(64));
  assert.equal(f.ui.questionEdit.orphaned, true);
});

for (const own of [true, false]) test(`explicit authoritative reread clears ${own ? 'its own saved edit' : 'no unsent draft for an external edit'}`, async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('当前编辑稿'); f.render();
  if (own) { await f.ui.sendQuestionEdit(); f.render(); }
  const value = f.task({ ...(own ? { submissionId: f.requests.at(-1).submissionId } : {}), state: 'succeeded', saveState: 'saved', result: { answer: '已提交的新回答', citations: [] } });
  await f.feed(value); f.render(); assert.equal(f.ui.questionEdit.body, '当前编辑稿');
  assert.ok(f.ui.error);
  f.saved.messages = [{ id: `${value.id}:user`, role: 'user', content: value.question }, { id: `${value.id}:assistant`, role: 'assistant', content: '已提交的新回答' }];
  f.saved.version = 'b'.repeat(64); await f.ui.reloadQuestionEdit(); f.render();
  if (own) { assert.equal(f.ui.questionEdit, null); assert.equal(f.ui.error, ''); }
  else { assert.equal(f.ui.questionEdit.body, '当前编辑稿'); assert.equal(f.ui.questionEdit.orphaned, true); }
});


test('queued task means awaiting execution without inventing an older blocked answer', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  await f.feed(f.task({ editMessageId: undefined, state: 'queued', error: '', partial: '', stage: '' })); f.render();
  assert.equal(f.ui.generating, true); assert.doesNotMatch(f.ui.stage, /前一|上一/);
});


for (const newSession of [false, true]) test(`client initialization blocks ${newSession ? 'a new session' : 'canonical recovery'} before IDs or routing change`, async t => {
  const f = fixture({ newSession }); t.after(() => f.dispose());
  const capabilities = f.holdCapabilities(); f.render(); await capabilities.started; await f.settle();
  // Existing history waits for its time metadata; a new empty session has none to hydrate.
  assert.equal(f.ui.initializing, !newSession); assert.equal(f.ui.configured, false); assert.equal(f.clients.length, 0);
  capabilities.release(); await f.settle(false);
  f.ui.setQuestion('合成恢复后的下一问'); f.render(false);
  assert.equal(f.ui.configured, true, 'server configuration remains independent of client readiness');
  assert.equal(f.ui.submissionBlocked, true); assert.equal(f.clients.length, 0);
  const id = f.ui.activeSessionId, route = f.options.routeSessionId;
  await f.ui.submit();
  assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0); assert.equal(f.routes.length, 0);
  assert.equal(f.ui.activeSessionId, id); assert.equal(f.options.routeSessionId, route);
  assert.equal(f.ui.question, '合成恢复后的下一问');
  f.flushEffects(); f.render(); assert.equal(f.clients.length, 1); assert.equal(f.ui.submissionBlocked, false);
  await f.ui.submit();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].question, '合成恢复后的下一问');
  assert.equal(f.routes.length, newSession ? 1 : 0);
});

test('capability read failure still permits historical reading and keeps submission blocked', async t => {
  const f = fixture(); t.after(() => f.dispose());
  f.failCapabilities(new Error('合成配置读取失败')); await f.settle();
  assert.equal(f.ui.initializing, false);
  assert.equal(f.ui.session.id, f.saved.id);
  assert.equal(f.ui.configured, false);
  assert.ok(f.ui.configurationError, 'the configuration failure remains visible while history is readable');
  f.ui.setQuestion('配置恢复前不可提交'); f.render(); await f.ui.submit();
  assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0);
});

test('capabilities and task client arriving before canonical recovery submit once after recovery', async t => {
  const f = fixture(); t.after(() => f.dispose());
  const canonical = f.holdRead(); f.render(); await canonical.started; await f.settle();
  assert.equal(f.ui.configured, true); assert.equal(f.ui.initializing, true); assert.equal(f.clients.length, 1);
  assert.equal(f.ui.submissionBlocked, true);
  f.ui.setQuestion('正文恢复前不可提交'); f.render(); await f.ui.submit();
  assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0); assert.equal(f.routes.length, 0);
  assert.equal(f.ui.question, '正文恢复前不可提交');
  canonical.release(); await f.settle();
  assert.equal(f.ui.initializing, false); assert.equal(f.ui.session.id, f.saved.id);
  assert.equal(f.ui.submissionBlocked, false);
  f.ui.setQuestion('合成先恢复客户端的下一问'); f.render();
  await f.ui.submit(); assert.equal(f.requests.length, 1);
});

test('closing the workspace retires the client and blocks stale submit handlers', async t => {
  const f = fixture({ newSession: true }); t.after(() => f.dispose()); await f.settle();
  f.ui.setQuestion('关闭时保留的草稿'); f.render(); const submit = f.ui.submit, client = f.clients[0];
  f.options.active = false; f.render(); f.render();
  assert.equal(client.stopped, true); assert.equal(f.ui.configured, true); assert.equal(f.ui.submissionBlocked, true);
  await submit(); assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0); assert.equal(f.routes.length, 0);
  assert.equal(f.ui.question, '关闭时保留的草稿');
  f.options.active = true; await f.settle(); assert.equal(f.ui.submissionBlocked, false);
  assert.equal(f.clients.length, 2); assert.equal(f.ui.question, '关闭时保留的草稿');
  await f.ui.submit(); assert.equal(f.requests.length, 1);
});

test('an instance change blocks the old client before its cleanup and waits for the new client', async t => {
  const f = fixture({ newSession: true }); t.after(() => f.dispose()); await f.settle();
  const previous = f.clients[0], nextInstance = randomUUID();
  f.setInstance(nextInstance); await f.ui.refreshConfiguration(); f.render(false);
  assert.equal(f.ui.configured, true); assert.equal(f.ui.submissionBlocked, true);
  f.ui.setQuestion('切换期间不可提交'); f.render(false); await f.ui.submit();
  assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0); assert.equal(f.routes.length, 0);
  f.flushEffects(); await f.settle();
  assert.equal(previous.stopped, true); assert.equal(f.clients.length, 2);
  assert.equal(f.clients[1].instanceId, nextInstance); assert.equal(f.ui.submissionBlocked, false);
  assert.equal(f.ui.question, '', 'an instance change keeps the existing isolation and reset behavior');
  f.ui.setQuestion('新实例的下一问'); f.render(); await f.ui.submit(); assert.equal(f.requests.length, 1);
});


test('legacy servers remain available without a task client', async t => {
  const f = fixture({ newSession: true, taskSupported: false }); t.after(() => f.dispose()); await f.settle();
  assert.equal(f.ui.configured, true); assert.equal(f.ui.submissionBlocked, false); assert.equal(f.clients.length, 0);
  f.ui.setQuestion('旧服务的合成问题'); f.render(); await f.ui.submit();
  assert.equal(f.requests.length, 0); assert.equal(f.legacyRequests.length, 1);
  assert.equal(f.legacyRequests[0].question, '旧服务的合成问题'); assert.equal(f.routes.length, 1);
});

test('hiding a module keeps its background client and continues receiving its task', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle(); const client = f.clients[0];
  const running = f.task({ editMessageId: undefined, state: 'running', partial: '后台首段' });
  await f.feed(running); f.render();
  f.options.visible = false; f.render(); f.render();
  assert.equal(f.clients.length, 1); assert.notEqual(client.stopped, true); assert.equal(f.ui.generating, true);
  await f.feed({ ...running, revision: 2, partial: '后台继续接收的正文' }); f.render();
  assert.ok(f.ui.messages.some(message => message.content.includes('后台继续接收的正文')));
  f.options.visible = true; await f.settle();
  assert.equal(f.clients.length, 1); assert.equal(f.clients[0], client); assert.notEqual(client.stopped, true);
});


test('question editing shares the readiness gate and rejects a handler captured for the previous instance', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('旧实例修改稿'); f.render();
  const staleEditSubmit = f.ui.sendQuestionEdit, previous = f.clients[0];
  f.setInstance(randomUUID()); await f.ui.refreshConfiguration(); f.render(false);
  assert.equal(f.ui.submissionBlocked, true); await f.ui.sendQuestionEdit();
  assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0);
  assert.equal(f.ui.questionEdit.body, '旧实例修改稿');
  f.flushEffects(); await f.settle(); assert.equal(previous.stopped, true);
  f.options.routeSessionId = f.saved.id; await f.settle();
  f.ui.beginQuestionEdit('question'); f.render(); f.ui.changeQuestionEdit('新实例修改稿'); f.render();
  await staleEditSubmit(); assert.equal(f.requests.length, 0); assert.equal(f.allocatedIds.length, 0);
  await f.ui.sendQuestionEdit(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].question, '新实例修改稿');
});
