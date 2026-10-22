import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, session, task, qaView, plain } from './qa-task-fixture.mjs';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
async function editing(t) {
  const f = await fixture(), saved = session();
  saved.messages.push({ id: 'later:user', role: 'user', content: '后续问题' }, { id: 'later:assistant', role: 'assistant', content: '后续回答' });
  f.sessions.set(saved.id, saved); await f.client.connect(); f.client.questionEditing = true;
  const pending = [], writesPending = [], view = { ...qaView(), onPendingChange: value => writesPending.push(value),
    onQuestionEditsChange: value => pending.push(value) };
  const controller = new f.QaSessionController(f.transport, view, f.client);
  f.client.onChange = () => controller.applyTasks();
  t.after(() => controller.dispose()); await controller.openSession(saved.id); await settle();
  controller.question = '底部独立草稿'; controller.beginQuestionEdit(saved.messages[0].id);
  return { ...f, saved, controller, pending, writesPending, target: saved.messages[0].id };
}

test('explicit cancel discards only the inline draft; reopening starts from original question and no dirty flag', async t => {
  const f = await editing(t), before = plain(f.saved.messages);
  f.controller.changeQuestionEdit(f.target, '修改后的问题\n[S1]'); assert.equal(f.pending.at(-1), true);
  f.controller.cancelQuestionEdit(f.target);
  assert.equal(f.controller.questionEdit(), undefined); assert.equal(f.pending.at(-1), false);
  assert.equal(f.controller.question, '底部独立草稿'); assert.deepEqual(plain(f.controller.answerMessages()).map(m => m.content), before.map(m => m.content));
  f.controller.beginQuestionEdit(f.target); assert.equal(f.controller.questionEdit().content, before[0].content);
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
});

for (const outcome of ['failed', 'cancelled', 'interrupted']) test(`edited ${outcome} task restores canonical branch and retains its inline draft for retry`, async t => {
  const f = await editing(t), before = plain(f.saved.messages);
  f.controller.changeQuestionEdit(f.target, '修改问题'); await f.controller.submitQuestionEdit(f.target);
  const value = [...f.tasks.values()][0]; assert.equal(value.editMessageId, f.target);
  Object.assign(value, { state: outcome, revision: 2, error: outcome === 'failed' ? '合成失败' : '' });
  await f.client.refresh(); await settle();
  assert.equal(f.controller.questionEdit().content, '修改问题'); assert.ok(f.controller.questionEdit().error);
  assert.deepEqual(plain(f.controller.answerMessages()).map(m => m.content), before.map(m => m.content));
  assert.deepEqual(f.saved.messages, before); assert.equal(f.controller.question, '底部独立草稿');
  await f.controller.submitQuestionEdit(f.target);
  const retry = f.requests.filter(r => r.method === 'POST' && r.path === '/rag/tasks').at(-1);
  assert.equal(retry.body.retryTaskId, value.id); assert.equal(retry.body.editMessageId, f.target);
});

test('only confirmed saved edited branch clears draft and downstream messages; cached superseded tasks cannot reappear', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '新起点');
  await f.controller.submitQuestionEdit(f.target); const value = [...f.tasks.values()][0];
  assert.equal(f.saved.messages.length, 4, 'acceptance does not truncate authoritative data');
  f.saved.messages = [{ id: `${value.id}:user`, role: 'user', content: '新起点' }, { id: `${value.id}:assistant`, role: 'assistant', content: '新回答' }];
  f.saved.version = 'b'.repeat(64);
  Object.assign(value, { state: 'succeeded', saveState: 'saved', revision: 2, result: { answer: '新回答', citations: [] } });
  await f.client.refresh(); await settle();
  assert.equal(f.controller.questionEdit(), undefined);
  assert.deepEqual(plain(f.controller.answerMessages()).map(m => m.content), ['新起点', '新回答']);
  assert.equal(f.controller.question, '底部独立草稿'); assert.equal(f.pending.at(-1), false);
});

test('an in-flight old canonical read cannot overwrite a newly committed edit, and recovery reads the new branch', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '新起点');
  await f.controller.submitQuestionEdit(f.target); const value = [...f.tasks.values()][0];
  const get = f.transport.get; let release, started;
  const gate = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { started = resolve; });
  let hold = true;
  f.transport.get = async path => {
    const result = plain(await get(path));
    if (path.endsWith(f.saved.id) && hold) { hold = false; started(); await gate; }
    return result;
  };
  const opening = f.controller.openSession(f.saved.id); await start;
  f.saved.messages = [{ id: `${value.id}:user`, role: 'user', content: '新起点' }, { id: `${value.id}:assistant`, role: 'assistant', content: '新回答' }];
  f.saved.version = 'b'.repeat(64);
  Object.assign(value, { state: 'succeeded', saveState: 'saved', revision: 2, result: { answer: '新回答', citations: [] } });
  await f.client.read(value.id); release(); await opening; await settle();
  assert.equal(f.controller.questionEdit(), undefined);
  assert.deepEqual(plain(f.controller.answerMessages()).map(m => m.content), ['新起点', '新回答']);
  assert.equal(f.controller.sessionVersion, 'b'.repeat(64));
});

test('failed edit persistence and permanent rejection retain edit draft without submitting a bottom-composer question', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '本次草稿');
  f.local.fail = true; await f.controller.submitQuestionEdit(f.target);
  await settle();
  assert.equal(f.tasks.size, 0); assert.match(f.controller.questionEdit().error, /storage unavailable/);
  f.local.fail = false;
  f.transport.postForInstance = async () => { throw new f.ApiError('版本冲突', 409); };
  await f.controller.submitQuestionEdit(f.target);
  assert.equal(f.controller.questionEdit().content, '本次草稿'); assert.match(f.controller.questionEdit().error, /版本冲突/);
  await f.controller.send(); assert.equal(f.tasks.size, 0); assert.equal(f.controller.question, '底部独立草稿');
});

test('switching to another question in the same session preserves both drafts and cancel clears only the active one', async t => {
  const f = await editing(t);
  f.controller.changeQuestionEdit(f.target, '第一题草稿');
  f.controller.beginQuestionEdit('later:user'); f.controller.changeQuestionEdit('later:user', '第二题草稿');
  f.controller.beginQuestionEdit(f.target); assert.equal(f.controller.questionEdit().content, '第一题草稿');
  f.controller.cancelQuestionEdit(f.target); assert.equal(f.pending.at(-1), true, 'the other question still has a draft');
  f.controller.beginQuestionEdit('later:user'); assert.equal(f.controller.questionEdit().content, '第二题草稿');
  f.controller.cancelQuestionEdit('later:user'); assert.equal(f.pending.at(-1), false);
  f.controller.beginQuestionEdit(f.target); assert.equal(f.controller.questionEdit().content, f.saved.messages[0].content);
});

test('duplicate edit send is excluded while acceptance is unknown and stop keeps the identical pending edit', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '待确认编辑');
  f.transport.postForInstance = async () => { throw Error('unknown acceptance'); };
  await f.controller.submitQuestionEdit(f.target); const first = JSON.parse(f.local.raw)[0];
  await f.controller.submitQuestionEdit(f.target); await f.controller.send();
  assert.equal(f.client.pending.length, 1); assert.equal(f.client.pending[0].submissionId, first.submissionId);
  f.controller.stop(); await settle();
  assert.equal(f.client.pending[0].editMessageId, f.target); assert.equal(f.client.pending[0].cancelRequested, true);
});

test('switching conversations retains each inline draft; explicit cancel after stopped generation stays cancelled when reopened', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '会话一草稿');
  const other = session(); f.sessions.set(other.id, other); await f.controller.openSession(other.id); await settle();
  assert.equal(f.controller.questionEdit(), undefined);
  assert.equal(f.pending.at(-1), true, 'another session still owns an inline draft');
  assert.equal(f.writesPending.at(-1), false, 'an inline draft is not a legacy pending write that blocks navigation');
  await f.controller.openSession(f.saved.id); await settle(); assert.equal(f.controller.questionEdit().content, '会话一草稿');
  await f.controller.submitQuestionEdit(f.target); const value = [...f.tasks.values()][0];
  Object.assign(value, { state: 'cancelled', revision: 2 }); await f.client.refresh();
  f.controller.cancelQuestionEdit(f.target);
  await f.controller.openSession(other.id); await f.controller.openSession(f.saved.id); await settle();
  assert.equal(f.controller.questionEdit(), undefined); f.controller.beginQuestionEdit(f.target);
  assert.equal(f.controller.questionEdit().content, f.saved.messages[0].content);
});

test('original question timestamp is not replaced by regeneration time and legacy unknown times remain absent', async t => {
  const f = await editing(t), original = task(f.saved.id, { state: 'succeeded', saveState: 'saved', result: { answer: '原回答', citations: [] } });
  f.saved.messages[0].id = `${original.id}:user`;
  f.saved.messages[1].id = `${original.id}:assistant`;
  const regenerated = task(f.saved.id, { replaceLast: true, questionMessageId: f.saved.messages[0].id,
    createdAt: '2026-10-22T12:00:00Z', state: 'succeeded', saveState: 'saved', result: { answer: '新版本', citations: [] } });
  f.tasks.set(original.id, original); f.tasks.set(regenerated.id, regenerated);
  await f.client.readSessionTasks(f.saved.id); await f.controller.openSession(f.saved.id); await settle();
  const messages = f.controller.answerMessages();
  assert.equal(messages[0].questionCreatedAt, original.createdAt); assert.equal(messages[2].questionCreatedAt, undefined);
});

test('background session rereads cannot replace the edit baseline; explicit reload preserves the draft and rebases', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '保留的编辑稿');
  f.saved.version = 'b'.repeat(64); f.saved.messages[0].content = '其他客户端修改';
  await f.controller.openSession(f.saved.id); await settle();
  assert.equal(f.controller.questionEdit().baseVersion, 'a'.repeat(64));
  await f.controller.submitQuestionEdit(f.target);
  assert.equal(f.requests.find(r => r.method === 'POST').body.baseVersion, 'a'.repeat(64));
  const value = [...f.tasks.values()][0]; Object.assign(value, { state: 'failed', revision: 2 });
  await f.client.refresh(); await settle();
  await f.controller.reloadQuestionEdit(f.target);
  assert.equal(f.controller.questionEdit().baseVersion, 'b'.repeat(64));
  assert.equal(f.controller.questionEdit().content, '保留的编辑稿');
});

test('a recovered failed edit with no original pending baseline requires explicit rereading before resubmission', async t => {
  const f = await fixture(), saved = session(); f.sessions.set(saved.id, saved);
  const failed = task(saved.id, { editMessageId: saved.messages[0].id, state: 'failed', error: '合成失败' });
  f.tasks.set(failed.id, failed); await f.client.connect(); f.client.questionEditing = true;
  const controller = new f.QaSessionController(f.transport, qaView(), f.client);
  f.client.onChange = () => controller.applyTasks(); t.after(() => controller.dispose());
  await controller.openSession(saved.id); await settle();
  assert.equal(controller.questionEdit().baseVersion, '');
  await controller.submitQuestionEdit(saved.messages[0].id);
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  const get = f.transport.get; f.transport.get = async () => { throw Error('synthetic offline'); };
  await controller.reloadQuestionEdit(saved.messages[0].id);
  assert.equal(controller.questionEdit().baseVersion, '');
  f.transport.get = get; await controller.reloadQuestionEdit(saved.messages[0].id);
  assert.equal(controller.questionEdit().baseVersion, saved.version);
  await controller.submitQuestionEdit(saved.messages[0].id);
  assert.equal(f.requests.find(r => r.method === 'POST').body.editMessageId, saved.messages[0].id);
});

test('a removed original target keeps its draft and cannot be rebound to a question with identical text', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '仍需保留');
  f.saved.version = 'b'.repeat(64); f.saved.messages[0].id = 'replacement-question';
  await f.controller.reloadQuestionEdit(f.target);
  assert.equal(f.controller.questionEdit().content, '仍需保留');
  assert.equal(f.controller.questionEdit().baseVersion, '');
  assert.match(f.controller.questionEdit().error, /已不在/);
  await f.controller.submitQuestionEdit(f.target);
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  f.controller.cancelQuestionEdit(f.target); assert.equal(f.controller.questionEdit(), undefined);
});

test('confirmed remote deletion keeps a visible orphan draft and the independent composer text', async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '会话删除后仍保留');
  f.sessions.delete(f.saved.id); await f.controller.reloadQuestionEdit(f.target);
  assert.equal(f.controller.orphanQuestionEdits()[0].content, '会话删除后仍保留');
  assert.equal(f.controller.questionEdit().baseVersion, '');
  assert.equal(f.controller.question, '底部独立草稿');
  await f.controller.submitQuestionEdit(f.target);
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  f.controller.cancelQuestionEdit(f.target);
  assert.equal(f.controller.orphanQuestionEdits().length, 0);
  assert.equal(f.controller.question, '底部独立草稿');
});

for (const target of ['same', 'other']) test(`a failed external edit on ${target} question cannot replace or steal an unsent local editor`, async t => {
  const f = await editing(t); f.controller.changeQuestionEdit(f.target, '尚未发送的本地稿');
  const before = plain(f.controller.questionEdit());
  const external = task(f.saved.id, { editMessageId: target === 'same' ? f.target : 'later:user',
    state: 'failed', error: '另一客户端失败', question: '尚未发送的本地稿', createdAt: '2026-10-22T03:00:00Z' });
  f.tasks.set(external.id, external); await f.client.readSessionTasks(f.saved.id); await settle();
  assert.deepEqual(plain(f.controller.questionEdit()), before);
  assert.equal(f.controller.questionEdit().messageId, f.target);
  await f.controller.submitQuestionEdit(f.target);
  assert.equal(f.requests.find(r => r.method === 'POST').body.retryTaskId, undefined, 'identical text does not associate a foreign retry');
});

for (const editMessageId of [undefined, 'old-question']) test(`native already canonical ${editMessageId ? 'edited' : 'appended'} task does not duplicate while the refresh GET is held`, async t => {
  const f = await fixture(), saved = session();
  const value = task(saved.id, { editMessageId, state: 'succeeded', saveState: 'saved', result: { answer: '已保存回答', citations: [] } });
  saved.messages = [{ id: `${value.id}:user`, role: 'user', content: value.question }, { id: `${value.id}:assistant`, role: 'assistant', content: '已保存回答' }];
  f.sessions.set(saved.id, saved); await f.client.connect();
  const controller = new f.QaSessionController(f.transport, qaView(), f.client);
  f.client.onChange = () => controller.applyTasks(); t.after(() => controller.dispose());
  await controller.openSession(saved.id); await settle();
  let start, release; const started = new Promise(resolve => start = resolve), gate = new Promise(resolve => release = resolve);
  const get = f.transport.get; f.transport.get = async route => { const result = plain(await get(route)); start(); await gate; return result; };
  f.tasks.set(value.id, value); await f.client.read(value.id); await started;
  try { assert.equal(controller.answerMessages().length, 2); assert.equal(controller.messages.length, 2); }
  finally { release(); }
  await settle(); assert.equal(controller.answerMessages().length, 2);
});
