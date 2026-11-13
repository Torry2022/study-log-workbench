import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { fixture, task, session, qaView } from './qa-task-fixture.mjs';

async function setup(t) {
  const f = await fixture(), a = session(), b = session();
  f.sessions.set(a.id, a); f.sessions.set(b.id, b);
  const running = task(a.id); f.tasks.set(running.id, running);
  await f.client.connect();
  const busy = [];
  const controller = new f.QaSessionController(f.transport, qaView(), f.client);
  controller.view.onBusyChange = value => busy.push(value);
  controller.activate();
  t.after(() => controller.dispose());
  return { ...f, a, b, running, controller, busy };
}
test('approved switch from generating A to idle B discards input only after a successful read', async t => {
  const f = await setup(t), c = f.controller;
  await c.openSession(f.a.id); assert.equal(c.sending, true); assert.equal(f.busy.at(-1), false);
  c.question = 'A的未发送草稿'; await c.openSession(f.b.id, true);
  assert.equal(c.sending, false); assert.equal(c.question, '', 'discarded A input must not appear in B');
  c.question = 'B的未发送草稿'; await c.openSession(f.a.id, true);
  assert.equal(c.question, ''); assert.equal(c.sending, true);
  await c.openSession(f.b.id, true); assert.equal(c.question, '');
  assert.equal(f.requests.filter(request => request.method !== 'GET').length, 0);
});
test('background completion belongs to A and cannot consume the visible B input', async t => {
  const f = await setup(t), c = f.controller;
  await c.openSession(f.a.id); c.question = 'A草稿'; await c.openSession(f.b.id, true); c.question = 'B草稿';
  f.running.state = 'cancelled'; f.running.revision++; await f.client.refresh();
  assert.equal(c.sessionId, f.b.id); assert.equal(c.question, 'B草稿'); assert.equal(c.sending, false);
  await c.openSession(f.a.id, true); assert.equal(c.question, ''); assert.equal(c.sending, false);
});
test('approved new-conversation navigation does not keep a discarded input', async t => {
  const f = await setup(t), c = f.controller;
  c.question = '尚未创建会话的草稿'; await c.openSession(f.b.id, true);
  assert.equal(c.question, '');
  await c.newSession(); assert.equal(c.sessionId, ''); assert.equal(c.question, '');
});

async function method(file, name, next, globals = {}) {
  const source = (await readFile(new URL(`../entry/src/main/ets/${file}.ets`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf(`  private ${name}(`), end = source.indexOf(`  private ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} source boundaries`);
  const module = { exports: {} };
  const code = ts.transpileModule(`class Host { ${source.slice(start, end)} } exports.invoke = Host.prototype.${name};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { module, exports: module.exports, setTimeout, $r: value => value, ...globals });
  return module.exports.invoke;
}

test('normal shell and page entry preserve cancelled or failed navigation input and consume confirmed success', async t => {
  const f = await setup(t), c = f.controller;
  await c.openSession(f.a.id);
  const modules = { qaBusy: false, qaDirty: true, qaPending: false, qaRequestRevision: 0 };
  c.view.onQuestionChange = value => modules.qaDirty = !!value.trim();
  let dialog, pending;
  const watch = await method('features/qa/QaPage', 'navigationRequestChanged', 'retrySession');
  const navigation = { closeNavigation() {} }, host = { modules, workspaceNavigationView: navigation };
  const switchSession = await method('pages/Index', 'switchQaSession', 'confirmQaDelete', {
    AlertDialog: { show: value => { dialog = value; } }, appFeedback: { show() { throw Error('unexpected busy guard'); } }
  });
  const page = { data: { openSession: (id, discard) => { pending = c.openSession(id, discard); }, newSession: () => { pending = c.newSession(); } } };
  const dispatch = async () => {
    page.navigationRequestRevision = modules.qaRequestRevision; page.navigationSessionId = modules.qaSessionId;
    watch.call(page); await pending;
  };
  c.question = '  原始草稿  '; switchSession.call(host, f.b.id);
  assert.ok(dialog); dialog.primaryButton.action();
  assert.equal(modules.qaRequestRevision, 0); assert.equal(c.question, '  原始草稿  ');
  const get = f.transport.get;
  f.transport.get = async path => { if (path.includes(f.b.id)) throw Error('isolated read failure'); return get(path); };
  dialog.secondaryButton.action(); await dispatch();
  assert.equal(c.question, '  原始草稿  '); assert.equal(modules.qaDirty, true);
  assert.match(c.errorMessage, /isolated read failure/);
  assert.equal(c.taskBlocked, true);
  const writes = f.requests.filter(request => request.method !== 'GET').length;
  await c.send(); assert.equal(f.requests.filter(request => request.method !== 'GET').length, writes, 'failed target cannot receive the retained source input');
  const retry = await method('features/qa/QaPage', 'retrySession', 'discardRequested', { AlertDialog: { show: value => { dialog = value; } } });
  c.question = '失败后修改的新稿'; retry.call({ data: c }); dialog.primaryButton.action();
  assert.equal(c.question, '失败后修改的新稿');
  f.transport.get = get; retry.call({ data: c }); await dialog.secondaryButton.action();
  assert.equal(c.sessionId, f.b.id); assert.equal(c.question, ''); assert.equal(modules.qaDirty, false);
  assert.equal(c.sending, false); assert.equal(f.running.state, 'running');
  switchSession.call(host, f.a.id); await dispatch(); assert.equal(c.sending, true);
  c.question = '新建前草稿'; modules.qaDirty = true;
  switchSession.call(host, ''); dialog.primaryButton.action(); assert.equal(c.question, '新建前草稿');
  dialog.secondaryButton.action(); await dispatch(); assert.equal(c.sessionId, ''); assert.equal(c.question, '');
  c.question = '保留的新稿'; modules.qaDirty = true; switchSession.call(host, f.b.id);
  host.workspaceNavigationView = undefined; dialog.secondaryButton.action(); assert.equal(c.question, '保留的新稿');
});

test('late reads cannot discard a newer session input', async t => {
  const f = await setup(t), c = f.controller, get = f.transport.get;
  let release; f.transport.get = async path => { if (path.includes(f.b.id)) await new Promise(resolve => { release = resolve; }); return get(path); };
  await c.openSession(f.a.id); c.question = 'A草稿'; const old = c.openSession(f.b.id);
  await new Promise(resolve => setImmediate(resolve));
  await c.openSession(f.a.id); c.question = 'A当前草稿'; release(); await old;
  assert.equal(c.sessionId, f.a.id); assert.equal(c.question, 'A当前草稿');
});

test('idle B can be renamed and deleted while A keeps generating', async t => {
  const f = await setup(t), c = f.controller;
  await c.openSession(f.a.id); await c.openSession(f.b.id);
  f.transport.patch = async (path, body) => { assert.equal(path, `/rag/sessions/${f.b.id}`); assert.equal(body.baseVersion, f.b.version); f.b.title = body.title; return { session: f.b }; };
  f.transport.delete = async path => { assert.equal(path, `/rag/sessions/${f.b.id}`); f.sessions.delete(f.b.id); return { ok: true }; };
  let busy = f.busy.at(-1);
  const nav = new f.QaNavigationController(f.transport, { active: () => true, busy: () => busy,
    setBusy: value => { busy = value; }, activeSession: () => c.sessionId, clearSession: () => c.newSession(),
    onDeletedSession: id => c.forgetTaskSession(id) });
  nav.qaSessions = [f.a, f.b]; nav.qaRenameId = f.b.id; nav.qaRenameTitle = 'B改名';
  await nav.commitQaRename(); assert.equal(nav.qaNavigationError, ''); assert.equal(f.b.title, 'B改名');
  await nav.deleteQaSession(f.b.id); assert.equal(nav.qaNavigationError, '');
  await c.openSession(f.a.id); assert.equal(c.sending, true); assert.equal(f.running.state, 'running');
});
