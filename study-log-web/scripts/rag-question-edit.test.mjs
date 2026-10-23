import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as taskHelpers from '../lib/rag-task-client.ts';
import * as versions from '../lib/rag-answer-versions.ts';
import * as taskTypes from '../lib/rag-task-types.ts';
import * as times from '../lib/rag-message-time.ts';

const source = await fs.readFile(new URL('../hooks/use-rag.ts', import.meta.url), 'utf8');

// Run the actual retained-view hook. Layout/focus remain browser acceptance gates.
function fixture() {
  const id = randomUUID(), instanceId = randomUUID(), requests = [], removed = [], clients = [], slots = [], effects = [];
  let cursor = 0, readError, readGate;
  const saved = { id, title: '合成会话', version: 'a'.repeat(64), answerMode: 'logs_only',
    createdAt: '2026-10-22T01:00:00Z', updatedAt: '2026-10-22T01:00:00Z',
    messages: [{ id: 'question', role: 'user', content: '原问题\n[S1]' }, { id: 'answer', role: 'assistant', content: '原回答' }] };
  const clone = value => JSON.parse(JSON.stringify(value));
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
  const options = { active: true, visible: true, routeSessionId: id, routeToken: 1,
    onConfirm: async () => true, onRoute: value => { options.routeSessionId = value; } };
  const memo = (run, deps, effect) => {
    const index = cursor++, old = slots[index];
    if (old && deps?.every((value, i) => Object.is(value, old.deps[i]))) return old.value;
    if (effect) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
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
    constructor(_instance, _storage, callbacks) { this.callbacks = callbacks; clients.push(this); }
    start() {} stop() {} track() {} viewSession() {} async readSession() {} async refresh() {}
    async remove(id) { removed.push(id); }
    async submit(input) { requests.push(clone(input)); this.callbacks.pending(input); }
  }
  const requestJson = async path => {
    if (path === '/api/capabilities') return { instanceId, features: { ragTasks: { supported: true, configured: true,
      questionEditing: true, protocolVersion: 1 }, rag: { supported: true, configured: true } } };
    if (path.startsWith('/api/rag/sessions?q=')) return { sessions: [clone(saved)] };
    if (path === `/api/rag/sessions/${id}`) {
      if (readError) throw readError;
      const response = { session: clone(saved) }, gate = readGate; readGate = undefined;
      if (gate) { gate.start(); await gate.wait; }
      return response;
    }
    throw Error('Unexpected request: ' + path);
  };
  const dependencies = { react, '@/lib/client-http': { ApiRequestError, requestJson },
    '@/lib/rag-client': { clientUuid: randomUUID, requestRagStream() { assert.fail('legacy generation'); } },
    '@/lib/rag-task-client': { ...taskHelpers, RagTaskClient: Client }, '@/lib/rag-answer-versions': versions,
    '@/lib/rag-task-types': taskTypes, '@/lib/rag-message-time': times };
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; },
      window: { localStorage: storage(), sessionStorage: storage(), addEventListener() {}, removeEventListener() {} },
      AbortController, setTimeout, clearTimeout, console });
  let ui;
  const render = () => { cursor = 0; ui = module.exports.useRag(options); for (const effect of effects.splice(0)) effect(); return ui; };
  const settle = async () => { for (let i = 0; i < 7; i++) { render(); await new Promise(resolve => setTimeout(resolve, 1)); } return render(); };
  const task = values => ({ id: randomUUID(), submissionId: randomUUID(), sessionId: id,
    createdAt: '2026-10-22T02:00:00Z', updatedAt: '2026-10-22T02:00:00Z', revision: 1,
    question: '修改问题', editMessageId: 'question', questionMessageId: undefined, replaceLast: false,
    mode: 'logs_only', state: 'failed', saveState: 'pending', partial: '', stage: '', error: '合成失败', saveError: '', result: null, ...values });
  return { saved, requests, removed, options, clients, task, render, settle, ApiRequestError, failRead(error) { readError = error; }, get ui() { return ui; },
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
