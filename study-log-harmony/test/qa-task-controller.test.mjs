import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, task, session, qaView } from './qa-task-fixture.mjs';

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
test('background discovery writes through the activated observed controller', async t => {
  const f = await fixture(), writes = new Set();
  const raw = new f.QaSessionController(f.transport, qaView(), f.client);
  const observed = new Proxy(raw, { set(target, key, value) { writes.add(key); return Reflect.set(target, key, value); } });
  observed.activate(); t.after(() => observed.dispose()); await settle();
  const saved = session(), active = task(saved.id); f.sessions.set(saved.id, saved); f.tasks.set(active.id, active);
  await f.client.refresh(); await observed.openSession(saved.id); writes.clear();
  Object.assign(active, { revision: 2, state: 'cancelled' }); await f.client.refresh();
  assert.equal(observed.sending, false);
  assert.ok(writes.has('messages'), 'background messages must notify the UI owner');
  assert.ok(observed.answerMessages().some(value => value.taskId === active.id), 'background answer actions must use the updated task');
});
async function controller(t, values = {}) {
  const f = await fixture(); Object.assign(f, values); await f.client.connect();
  f.controller = new f.QaSessionController(f.transport, qaView(), f.client); f.controller.activate();
  t.after(() => f.controller.dispose()); await settle(); return f;
}
for (const [state, saveState] of [['running', 'pending'], ['succeeded', 'saved']]) test(`native single latest ${state} result does not add a redundant picker`, async t => {
  const f = await controller(t), saved = session(), current = task(saved.id, { state, saveState });
  f.sessions.set(saved.id, saved); f.tasks.set(current.id, current);
  await f.client.refresh(); await f.controller.openSession(saved.id);
  assert.equal(f.controller.answerMessages().filter(value => value.versions?.length > 1).length, 0);
  assert.equal(f.controller.sending, state === 'running');
  if (state === 'succeeded') assert.equal(f.controller.messages[1].content, '已保存答案');
});

for (const saveState of ['conflict', 'error']) test(`native old ${saveState} stays selectable beside a newer saved task and refresh`, async t => {
  const f = await controller(t), saved = session(), old = task(saved.id, { state: 'succeeded', saveState, result: { answer: '旧结果', citations: [] } }),
    newer = task(saved.id, { createdAt: '2026-10-18T02:00:00Z', state: 'succeeded', saveState: 'saved', result: { answer: '后来的结果', citations: [] } });
  f.sessions.set(saved.id, saved); f.tasks.set(old.id, old); f.tasks.set(newer.id, newer); await f.client.refresh(); await f.controller.openSession(saved.id);
  assert.equal(f.controller.answerMessages().find(value => value.taskId === old.id).content, '旧结果');
  assert.equal(f.controller.answerMessages().find(value => value.taskId === old.id).canDiscard, true);
  newer.revision++; await f.client.refresh(); assert.equal(f.controller.answerMessages().find(value => value.taskId === old.id).content, '旧结果');
  const second = new f.QaTaskClient(f.transport, f.local, f.instanceId), other = new f.QaSessionController(f.transport, qaView(), second); t.after(() => other.dispose());
  other.activate(); await second.connect(); await other.openSession(saved.id); assert.equal(other.answerMessages().find(value => value.taskId === old.id).content, '旧结果');
});

test('native active task does not block opening another saved session or sending a second task', async t => {
  const f = await controller(t), first = session(), second = session(); f.sessions.set(first.id, first); f.sessions.set(second.id, second);
  const active = task(first.id); f.tasks.set(active.id, active); await f.client.refresh(); await f.controller.openSession(first.id); assert.equal(f.controller.sending, true);
  await f.controller.openSession(second.id); assert.equal(f.controller.sessionId, second.id); assert.equal(f.controller.sending, false); assert.equal(f.controller.messages[1].content, '已保存答案');
  f.controller.question = '第二会话的问题'; await f.controller.send(); assert.equal(f.tasks.size, 2); assert.equal(f.tasks.get(active.id).state, 'running');
});

test('canonical view updates when a background task is saved without switching away from that choice', async t => {
  const f = await controller(t), saved = session(), active = task(saved.id); f.sessions.set(saved.id, saved); f.tasks.set(active.id, active);
  await f.client.refresh(); await f.controller.openSession(saved.id);
  saved.messages = [...saved.messages, { id: randomUUID(), role: 'user', content: active.question }, { id: randomUUID(), role: 'assistant', content: '后台完成的答案' }];
  saved.version = 'b'.repeat(64); Object.assign(active, { state: 'succeeded', saveState: 'saved', revision: 2, result: { answer: '后台完成的答案', citations: [] } });
  await f.client.refresh(); await settle(); assert.equal(f.controller.answerMessages().at(-1).content, '后台完成的答案');
});

test('late canonical response cannot replace an explicit answer version', async t => {
  const f = await controller(t), saved = session(), old = task(saved.id, { questionMessageId: '', state: 'succeeded', saveState: 'conflict', result: { answer: '保留的旧答案', citations: [] } });
  old.questionMessageId = saved.messages[0].id;
  f.sessions.set(saved.id, saved); f.tasks.set(old.id, old); await f.client.refresh(); await f.controller.openSession(saved.id);
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve), get = f.transport.get;
  f.transport.get = async path => { const result = await get(path); if (path.endsWith(saved.id)) { started(); await gate; } return result; };
  const loading = f.controller.openSession(saved.id); await start;
  await f.controller.selectAnswerVersion(saved.messages[0].id, saved.messages[1].id);
  release(); await loading; await settle();
  assert.equal(f.controller.answerMessages()[1].id, saved.messages[1].id);
  assert.equal(f.controller.answerMessages()[1].content, '已保存答案');
});

test('retry save and discard act on the selected old task while newer answers remain intact', async t => {
  const f = await controller(t), saved = session(), old = task(saved.id, { state: 'succeeded', saveState: 'error', result: { answer: '旧答案', citations: [] } }),
    newer = task(saved.id, { createdAt: '2026-10-18T02:00:00Z', state: 'succeeded', saveState: 'error', result: { answer: '新答案', citations: [] } });
  f.sessions.set(saved.id, saved); f.tasks.set(old.id, old); f.tasks.set(newer.id, newer); await f.client.refresh(); await f.controller.openSession(saved.id);
  await f.controller.saveAnswer(old.id); assert.equal(f.tasks.get(old.id).saveState, 'saved'); assert.equal(f.tasks.get(newer.id).saveState, 'error');
  Object.assign(old, { saveState: 'conflict', revision: 3 }); await f.client.refresh(); await f.controller.discardTask(old.id);
  assert.equal(f.tasks.has(old.id), false); assert.equal(f.tasks.has(newer.id), true); assert.equal(f.sessions.get(saved.id).version, 'a'.repeat(64));
  assert.deepEqual(f.requests.filter(value => value.method !== 'GET').map(value => value.path), [`/rag/tasks/${old.id}/save`, `/rag/tasks/${old.id}`]);
});

test('stop targets the selected active task and failed generation is retried only by explicit action', async t => {
  const f = await controller(t), saved = session(), active = task(saved.id); f.sessions.set(saved.id, saved); f.tasks.set(active.id, active);
  await f.client.refresh(); await f.controller.openSession(saved.id); f.controller.stop(); await settle(); assert.equal(f.tasks.get(active.id).state, 'cancelled');
  await f.client.refresh(); assert.equal(f.tasks.size, 1); assert.equal(f.controller.taskCanRetry, true);
  await f.controller.retryTask(); assert.equal(f.tasks.size, 2); assert.equal(f.requests.filter(value => value.path === '/rag/tasks' && value.method === 'POST').length, 1);
});

for (const state of ['failed', 'interrupted', 'cancelled']) for (const replaceLast of [true, false]) {
  test(`native retry preserves ${replaceLast ? 'replace' : 'append'} semantics after ${state}`, async t => {
    const f = await controller(t), saved = session(), original = task(saved.id, { state, replaceLast, question: saved.messages[0].content });
    f.sessions.set(saved.id, saved); f.tasks.set(original.id, original); await f.client.refresh(); await f.controller.openSession(saved.id);
    assert.equal(f.controller.taskCanRetry, true); await f.controller.retryTask();
    const request = f.requests.find(value => value.method === 'POST' && value.path === '/rag/tasks'); assert.ok(request);
    assert.equal(request.body.replaceLast === true, replaceLast); assert.equal(request.body.question, original.question); assert.equal(request.body.mode, original.mode);
    assert.equal(request.body.retryTaskId, original.id);
    assert.equal(request.body.sessionId, saved.id); assert.equal(request.body.baseVersion, saved.version); assert.notEqual(request.body.submissionId, original.submissionId);
    assert.equal(f.tasks.get(original.id).state, state); assert.equal(f.requests.filter(value => value.method === 'POST').length, 1);
  });
}

for (const replaceLast of [true, false]) test(`uncertain retry retains ${replaceLast ? 'replacement' : 'append'} identity and presentation through recovery`, async t => {
  const f = await controller(t), saved = session(), original = task(saved.id, { state: 'failed', replaceLast, question: saved.messages[0].content });
  f.sessions.set(saved.id, saved); f.tasks.set(original.id, original); await f.client.refresh(); await f.controller.openSession(saved.id);
  const post = f.transport.postForInstance; f.transport.postForInstance = async (...args) => { await post(...args); throw Error('lost acknowledgement'); };
  await f.controller.retryTask(); assert.equal(f.client.pending[0].replaceLast, replaceLast);
  assert.equal(f.client.pending[0].retryTaskId, original.id);
  assert.equal(f.controller.messages.length, saved.messages.length + (replaceLast ? 0 : 2));
  const submissionId = f.client.pending[0].submissionId; f.transport.postForInstance = post; await f.client.refresh();
  const recovered = [...f.tasks.values()].find(value => value.submissionId === submissionId); assert.ok(recovered); assert.equal(recovered.replaceLast, replaceLast);
  assert.equal(f.requests.filter(value => value.method === 'POST').length, 1); assert.equal(f.controller.messages.length, saved.messages.length + (replaceLast ? 0 : 2));
});

test('stop during an uncertain follow-up targets pending submission instead of the previously saved task', async t => {
  const f = await controller(t), saved = session(), previous = task(saved.id, { state: 'succeeded', saveState: 'saved', result: { answer: '旧已保存答案', citations: [] } });
  f.sessions.set(saved.id, saved); f.tasks.set(previous.id, previous); f.client.tasks = [previous]; await f.controller.openSession(saved.id);
  const post = f.transport.postForInstance; f.transport.postForInstance = async (...args) => { await post(...args); throw Error('lost acknowledgement'); };
  f.controller.question = '新的待确认问题'; await f.controller.send(); assert.equal(f.client.pending.length, 1); f.controller.stop(); await settle();
  assert.equal(JSON.parse(f.local.raw)[0].cancelRequested, true); assert.equal(f.tasks.get(previous.id).state, 'succeeded');
  f.transport.postForInstance = post; await f.client.refresh(); assert.equal(f.client.pending.length, 0);
  assert.equal([...f.tasks.values()].find(value => value.id !== previous.id).state, 'cancelled');
});

test('cross-client deletion clears the view before a captured successful old snapshot is released', async t => {
  const f = await controller(t), saved = session(), old = task(saved.id, { state: 'succeeded', saveState: 'conflict', result: { answer: '旧答案', citations: [] } });
  const newer = task(saved.id, { createdAt: '2026-10-18T02:00:00Z', state: 'succeeded', saveState: 'saved', result: { answer: '较新的已保存答案', citations: [] } });
  f.sessions.set(saved.id, saved); f.tasks.set(old.id, old); f.tasks.set(newer.id, newer); await f.controller.loadSessions(); await f.client.refresh(); await f.controller.openSession(saved.id);
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve), get = f.transport.getForInstance;
  let hold = true; f.transport.getForInstance = async (...args) => { const result = await get(...args); if (args[0].endsWith(old.id) && hold) { hold = false; started(); await gate; } return result; };
  const read = f.client.read(old.id); await start; f.tasks.clear(); f.sessions.delete(saved.id); await f.client.refresh(); await settle(); release(); await read; await settle();
  assert.equal(f.controller.sessionId, ''); assert.equal(f.controller.messages.length, 0); assert.equal(f.controller.sessions.some(value => value.id === saved.id), false);
});

test('pending saves and failed authoritative reads cannot submit a follow-up using an older session version', async t => {
  const f = await controller(t), saved = session(), active = task(saved.id); f.sessions.set(saved.id, saved); f.tasks.set(active.id, active);
  await f.client.refresh(); await f.controller.openSession(saved.id);
  Object.assign(active, { state: 'succeeded', saveState: 'pending', revision: 2, result: { answer: '完整结果', citations: [] } }); await f.client.refresh();
  assert.equal(f.controller.taskBlocked, true); f.controller.question = '下一问'; await f.controller.send(); assert.equal(f.tasks.size, 1);
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve), get = f.transport.get;
  f.transport.get = async path => { const result = await get(path); if (path.endsWith(saved.id)) { started(); await gate; throw Error('read unavailable'); } return result; };
  saved.version = 'b'.repeat(64); Object.assign(active, { saveState: 'saved', revision: 3 }); await f.client.refresh(); await start;
  assert.equal(f.controller.sessionLoading, true); await f.controller.send(); assert.equal(f.tasks.size, 1); release(); await settle();
  assert.equal(f.controller.taskBlocked, true); await f.controller.send(); assert.equal(f.tasks.size, 1);
  f.transport.get = get; await f.controller.openSession(saved.id); assert.equal(f.controller.sessionVersion, saved.version); await f.controller.send();
  assert.equal(f.requests.filter(value => value.method === 'POST' && value.path === '/rag/tasks').at(-1).body.baseVersion, saved.version);
});

test('declared but unavailable tasks block send rather than falling back, while failures preserve the question', async t => {
  const f = await controller(t); f.client.ready = false; f.controller.question = '尚未发送的问题'; await f.controller.send(); assert.equal(f.tasks.size, 0); assert.equal(f.controller.question, '尚未发送的问题');
  f.client.ready = true; f.local.fail = true; await f.controller.send(); assert.equal(f.tasks.size, 0); assert.equal(f.controller.question, '尚未发送的问题');
});

test('task navigation remains merged across hidden modules and authoritative history reloads', async t => {
  const f = await controller(t), saved = session(); let active = false;
  const navigation = new f.QaNavigationController(f.transport, { active: () => active, connected: () => true });
  navigation.acceptQaTaskNavigation([{ ...saved, taskState: 'running' }]); assert.equal(navigation.qaSessions[0].taskState, 'running');
  active = true; f.sessions.set(saved.id, { ...saved, title: '最新服务端标题' }); await navigation.loadQaNavigation();
  assert.equal(navigation.qaSessions[0].taskState, 'running'); assert.equal(navigation.qaSessions[0].title, '最新服务端标题');
  navigation.acceptQaTaskNavigation([]); assert.equal(navigation.qaSessions[0].taskState, undefined);
});

test('confirmed local session deletion fences an unknown late task from that session', async t => {
  const f = await controller(t), saved = session(), late = task(saved.id); f.sessions.set(saved.id, saved); await f.controller.openSession(saved.id);
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve), get = f.transport.getForInstance;
  f.tasks.set(late.id, late); f.transport.getForInstance = async (...args) => { const value = await get(...args); if (args[0].endsWith(late.id)) { started(); await gate; } return value; };
  const read = f.client.read(late.id); await start; f.controller.forgetTaskSession(saved.id); await settle(); release(); await read;
  assert.equal(f.client.tasks.length, 0); assert.equal(f.controller.sessionId, ''); assert.equal(f.controller.sessions.some(value => value.id === saved.id), false);
});

test('restoring a question after storage failure also restores the workspace draft guard', async t => {
  const f = await fixture(); t.after(() => f.client.stop()); await f.client.connect(); let draft = '';
  const view = qaView(); view.onQuestionChange = question => draft = question;
  const current = new f.QaSessionController(f.transport, view, f.client); f.local.fail = true; current.question = '保留的草稿'; await current.send();
  assert.equal(draft, '保留的草稿'); assert.equal(current.question, draft); assert.equal(f.tasks.size, 0);
});

test('answer versions use question identity, never repeated question text or whole-session selection', async t => {
  const f = await controller(t), saved = session(); f.sessions.set(saved.id, saved);
  const firstQuestion = saved.messages[0].id, secondQuestion = randomUUID();
  saved.messages.push({ id: secondQuestion, role: 'user', content: saved.messages[0].content }, { id: randomUUID(), role: 'assistant', content: '第二次同名提问' });
  const version = task(saved.id, { questionMessageId: firstQuestion, replaceLast: true, state: 'succeeded', saveState: 'error', question: saved.messages[0].content, result: { answer: '第一题新版本', citations: [] }, previousAnswer: saved.messages[1] });
  f.tasks.set(version.id, version); await f.client.refresh(); await f.controller.openSession(saved.id);
  const views = f.controller.answerMessages();
  assert.equal(views[1].content, '第一题新版本');
  assert.equal(views[3].content, '第二次同名提问');
  await f.controller.selectAnswerVersion(firstQuestion, saved.messages[1].id);
  assert.equal(f.controller.answerMessages()[1].content, '已保存答案');
  assert.equal(f.controller.answerMessages()[3].content, '第二次同名提问');
  await f.controller.selectAnswerVersion(firstQuestion, 'not-in-this-question');
  assert.equal(f.controller.answerMessages()[1].content, '已保存答案');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

test('answer regeneration sends replaceLast for the canonical last answer and preserves a typed draft', async t => {
  const f = await controller(t), saved = session(); f.sessions.set(saved.id, saved); await f.controller.openSession(saved.id);
  const answerId = saved.messages[1].id;
  f.controller.question = '未发送的草稿'; await f.controller.regenerateAnswer(answerId);
  assert.equal(f.controller.question, '未发送的草稿'); assert.equal(f.requests.some(r => r.method === 'POST'), false);
  f.controller.question = ''; await f.controller.regenerateAnswer(answerId);
  const request = f.requests.find(r => r.method === 'POST' && r.path === '/rag/tasks');
  assert.equal(request.body.replaceLast, true); assert.equal(request.body.question, saved.messages[0].content);
  assert.equal(request.body.baseVersion, saved.version);
});

test('reopening loads saved answer versions for only the chosen session', async t => {
  const f = await controller(t), saved = session(), other = session();
  const previous = { ...saved.messages[1] };
  const old = task(saved.id, { questionMessageId: saved.messages[0].id, state: 'succeeded', saveState: 'saved', previousAnswer: previous, result: { answer: '新回答', citations: [] } });
  saved.messages[1] = { id: old.id + ':assistant', role: 'assistant', content: '新回答' };
  f.sessions.set(saved.id, saved); f.tasks.set(old.id, old); f.tasks.set('unrelated', task(other.id));
  await f.controller.openSession(saved.id);
  assert.deepEqual(Array.from(f.controller.answerMessages()[1].versions), [previous.id, old.id + ':assistant']);
  assert.ok(f.requests.some(r => r.path === '/rag/tasks?sessionId=' + saved.id));
  await f.controller.selectAnswerVersion(saved.messages[0].id, previous.id);
  assert.equal(f.controller.answerMessages()[1].content, '已保存答案');
});

test('sending from an earlier answer commits its full content before task acceptance', async t => {
  const f = await controller(t), saved = session(), oldAnswer = { ...saved.messages[1], citations: [{ sourceId: 'S1', date: '2026-10-01' }] };
  const regenerated = task(saved.id, { questionMessageId: saved.messages[0].id, previousAnswer: oldAnswer, state: 'succeeded', saveState: 'saved', result: { answer: '当前回答', citations: [] } });
  saved.messages[1] = { id: regenerated.id + ':assistant', role: 'assistant', content: '当前回答' };
  f.sessions.set(saved.id, saved); f.tasks.set(regenerated.id, regenerated); await f.controller.openSession(saved.id);
  await f.controller.selectAnswerVersion(saved.messages[0].id, oldAnswer.id);
  assert.equal(f.controller.viewingPreviousAnswer(), true); assert.equal(f.controller.taskBlocked, false);
  assert.equal(f.requests.some(r => r.method === 'PUT'), false, 'preview must not save');
  f.controller.question = '追问'; await f.controller.send();
  const writes = f.requests.filter(r => r.method === 'PUT' || r.method === 'POST');
  assert.deepEqual(writes.map(r => r.method), ['PUT', 'POST']);
  assert.equal(writes[0].body.messages[1].content, oldAnswer.content);
  assert.deepEqual(writes[0].body.messages[1].citations, oldAnswer.citations);
  assert.equal(writes[1].body.baseVersion, 'b'.repeat(64));
  assert.equal(f.sessions.get(saved.id).messages[1].id, oldAnswer.id);
  assert.ok(f.tasks.has(regenerated.id), 'alternate result is retained, not deleted');
});

for (const failure of ['offline', 'conflict', 'lost-response']) test(`selected answer ${failure} never sends a mismatched task and preserves the draft`, async t => {
  const f = await controller(t), saved = session(), previous = { ...saved.messages[1] };
  const regenerated = task(saved.id, { questionMessageId: saved.messages[0].id, previousAnswer: previous, state: 'succeeded', saveState: 'saved', result: { answer: '最新答案', citations: [] } });
  saved.messages[1] = { id: regenerated.id + ':assistant', role: 'assistant', content: '最新答案' };
  f.sessions.set(saved.id, saved); f.tasks.set(regenerated.id, regenerated); await f.controller.openSession(saved.id);
  await f.controller.selectAnswerVersion(saved.messages[0].id, previous.id);
  let firstMutation; const put = f.transport.put;
  f.transport.put = async (path, body) => { firstMutation = body.mutationId;
    if (failure === 'lost-response') await put(path, body);
    throw new f.ApiError(failure, failure === 'conflict' ? 409 : 503);
  };
  f.controller.question = '草稿追问'; await f.controller.send();
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  assert.equal(f.controller.question, '草稿追问'); assert.equal(f.controller.sending, false); assert.equal(f.controller.taskSaving, false);
  f.transport.put = async (path, body) => {
    assert.equal(body.mutationId, firstMutation, 'ambiguous response must reuse mutation identity');
    if (failure === 'lost-response') return { session: JSON.parse(JSON.stringify(saved)) };
    return put(path, body);
  };
  await f.controller.send(); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});


test('continuing fixes the selected previous turn while retaining alternate stored results across reopening', async t => {
  const f = await controller(t), saved = session(), previous = { ...saved.messages[1] };
  const alternate = task(saved.id, { questionMessageId: saved.messages[0].id, previousAnswer: previous,
    state: 'succeeded', saveState: 'saved', result: { answer: '另一版本', citations: [] } });
  saved.messages[1] = { id: alternate.id + ':assistant', role: 'assistant', content: '另一版本' };
  f.sessions.set(saved.id, saved); f.tasks.set(alternate.id, alternate); await f.controller.openSession(saved.id);
  await f.controller.selectAnswerVersion(saved.messages[0].id, previous.id);
  f.controller.question = '下一轮'; await f.controller.send();
  assert.equal(f.controller.answerMessages()[1].versions.length, 1, 'the accepted follow-up fixes its parent before completion');
  const next = [...f.tasks.values()].find(item => item.id !== alternate.id);
  Object.assign(next, { state: 'succeeded', saveState: 'saved', revision: 2, result: { answer: '后续回答', citations: [] } });
  saved.messages.push({ id: next.id + ':user', role: 'user', content: '下一轮' }, { id: next.id + ':assistant', role: 'assistant', content: '后续回答' });
  saved.version = 'c'.repeat(64);
  await f.client.refresh(); await f.controller.openSession(saved.id);
  const rendered = f.controller.answerMessages();
  assert.equal(rendered[1].content, previous.content); assert.equal(rendered[1].versions.length, 1);
  assert.equal(rendered.at(-1).content, '后续回答'); assert.ok(f.tasks.has(alternate.id));
});


test('leaving during selection save never submits into the newly opened conversation', async t => {
  const f = await controller(t), saved = session(), other = session(), previous = { ...saved.messages[1] };
  const regenerated = task(saved.id, { questionMessageId: saved.messages[0].id, previousAnswer: previous,
    state: 'succeeded', saveState: 'saved', result: { answer: '当前版本', citations: [] } });
  saved.messages[1] = { id: regenerated.id + ':assistant', role: 'assistant', content: '当前版本' };
  f.sessions.set(saved.id, saved); f.sessions.set(other.id, other); f.tasks.set(regenerated.id, regenerated);
  const otherActive = task(other.id); f.tasks.set(otherActive.id, otherActive);
  await f.client.refresh(); await f.controller.openSession(saved.id);
  await f.controller.selectAnswerVersion(saved.messages[0].id, previous.id);
  let release, started; const gate = new Promise(resolve => release = resolve), start = new Promise(resolve => started = resolve), put = f.transport.put;
  f.transport.put = async (path, body) => { started(); await gate; return put(path, body); };
  f.controller.question = '原会话追问'; const sending = f.controller.send(); await start;
  await f.controller.openSession(other.id); release(); await sending;
  assert.equal(f.controller.sessionId, other.id); assert.equal(f.controller.sending, true);
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
});
