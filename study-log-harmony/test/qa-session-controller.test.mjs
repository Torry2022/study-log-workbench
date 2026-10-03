import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

async function loadController() {
  const directory = new URL('../entry/src/main/ets/features/qa/', import.meta.url);
  const load = async (name, dependencies) => {
    const source = await readFile(new URL(name, directory), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true
    } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, Error, JSON, Date, Observed: value => value,
      require(name) { if (!(name in dependencies)) throw new Error(`Missing dependency: ${name}`); return dependencies[name]; }
    });
    return module.exports;
  };
  const { QaStreamParser } = await load('QaStreamParser.ets', {});
  let sequence = 0;
  const { QaSessionController } = await load('QaSessionController.ets', {
    '../../common/network/ApiClient': { ApiError: class extends Error {}, ApiStreamCancelledError: class extends Error {} },
    './QaStreamParser': { QaStreamParser },
    '@kit.ArkTS': { util: { generateRandomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` } }
  });
  return QaSessionController;
}

function view() { return {
  onSessionsChange() {}, onSessionsError() {}, onActiveSessionChange() {}, onBusyChange() {}, onPendingChange() {},
  onSessionReady() {}, onBeforeSessionChange: async () => {}, resetComposerScroll() {},
  beforeSend() {}, showComposer() {}, afterFrame(action) { action(); }
}; }

test('history loading preserves a new question and cannot send it with the previous session context', async () => {
  const Controller = await loadController();
  let finishOpen, streams = 0;
  const sent = [];
  const controller = new Controller({
    get: path => path === '/rag/sessions/target' ? new Promise(resolve => { finishOpen = resolve; }) :
      Promise.resolve({ sessions: [] }),
    postStream: async (_path, request, chunk) => {
      streams++; sent.push(structuredClone(request));
      chunk('event: done\ndata: {"answer":"new answer","citations":[]}\n\n');
    },
    put: async () => ({ session: { id: 'target', version: 'v2' } }),
    post: async () => assert.fail('must not create a competing session')
  }, view());
  controller.sessionId = 'previous'; controller.sessionVersion = 'old';
  controller.messages = [{ id: 'old-u', role: 'user', content: 'old question' },
    { id: 'old-a', role: 'assistant', content: 'old answer' }];
  const opening = controller.openSession('target');
  controller.question = 'question typed while loading';
  await controller.send();
  assert.equal(streams, 0, 'do not answer using the previous session while the selected one loads');
  assert.equal(controller.question, 'question typed while loading');
  assert.equal(controller.messages.length, 2);
  assert.equal(controller.sessionLoading, true);
  finishOpen({ session: { id: 'target', version: 'v1', answerMode: 'logs_only', messages: [
    { id: 'new-u', role: 'user', content: 'target question' },
    { id: 'new-a', role: 'assistant', content: 'target answer' }
  ] } });
  await opening;
  assert.equal(controller.sessionLoading, false);
  assert.equal(controller.question, 'question typed while loading');
  await controller.send();
  assert.equal(streams, 1);
  assert.deepEqual(sent[0].history, [{ role: 'user', content: 'target question' },
    { role: 'assistant', content: 'target answer' }]);
  assert.equal(controller.sessionId, 'target');
});

test('partial SSE answer is never saved without done', async () => {
  const QaSessionController = await loadController();
  const writes = [];
  const controller = new QaSessionController({
    postStream: async (_path, _request, chunk) => chunk('event: delta\ndata: {"text":"partial"}\n\n'),
    post: async (...args) => writes.push(args)
  }, view());
  controller.question = 'test';
  await controller.send();
  assert.equal(controller.errorMessage, '问答未完整结束');
  assert.equal(controller.failedAttempt.saveOnly, false);
  assert.equal(writes.length, 0);
});

test('completed answers use versioned writes and retry an uncertain save without rerunning model', async () => {
  const QaSessionController = await loadController();
  const writes = []; let streams = 0; let failOnce = true;
  const transport = {
    postStream: async (_path, _request, chunk) => { streams++;
      chunk('event: delta\ndata: {"text":"partial"}\n\n');
      chunk('event: done\ndata: {"answer":"complete","citations":[],"groundingWarning":"合成引用日期需核对"}\n\n');
    },
    post: async (path, body) => { writes.push({ path, body: structuredClone(body) });
      if (failOnce) { failOnce = false; throw new Error('unknown result'); }
      return { session: { id: body.id, version: 'v1' } };
    },
    put: async (path, body) => { writes.push({ path, body: structuredClone(body) });
      return { session: { id: path.split('/').at(-1), version: 'v2' } };
    },
    get: async () => ({ sessions: [] })
  };
  const controller = new QaSessionController(transport, view());
  controller.question = 'first';
  await controller.send();
  assert.equal(streams, 1);
  assert.equal(controller.failedAttempt.saveOnly, true);
  assert.equal(writes[0].body.baseVersion, null);
  assert.equal(writes[0].body.messages[1].content, 'complete');
  assert.equal(writes[0].body.messages[1].groundingWarning, '合成引用日期需核对');
  await controller.runAttempt(controller.failedAttempt);
  assert.equal(streams, 1);
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(controller.sessionVersion, 'v1');
  controller.question = 'second';
  await controller.send();
  assert.equal(streams, 2);
  assert.equal(writes[2].path, `/rag/sessions/${controller.sessionId}`);
  assert.equal(writes[2].body.baseVersion, 'v1');
  assert.equal(controller.sessionVersion, 'v2');
});

test('late stopped-answer save cannot reactivate a session after starting a new one', async () => {
  const QaSessionController = await loadController();
  let finishSave;
  const pending = [];
  const controller = new QaSessionController({
    cancelStream() {},
    post: () => new Promise(resolve => { finishSave = resolve; }),
    get: async () => ({ sessions: [] })
  }, { ...view(), onPendingChange: value => pending.push(value) });
  controller.messages = [
    { id: 'user-1', role: 'user', content: 'question' },
    { id: 'assistant-1', role: 'assistant', content: 'partial' }
  ];
  controller.sending = true;
  controller.stop();
  await controller.newSession();
  assert.equal(pending.at(-1), false);
  const reportsBeforeLateSave = pending.length;
  finishSave({ session: { id: 'old-session', version: 'v1' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.sessionId, '');
  assert.equal(controller.messages.length, 0);
  assert.equal(pending.length, reportsBeforeLateSave);
});

test('stopped-answer persistence owns the leave guard until the save settles', async () => {
  const Controller = await loadController();
  for (const succeeds of [true, false]) {
    let resolveSave, rejectSave;
    const pending = [];
    const controller = new Controller({ cancelStream() {},
      post: () => new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }),
      get: async () => ({ sessions: [] })
    }, { ...view(), onPendingChange: value => pending.push(value) });
    controller.messages = [{ id: 'u', role: 'user', content: 'question' },
      { id: 'a', role: 'assistant', content: 'partial' }];
    controller.sending = true;
    controller.stop();
    assert.equal(pending.at(-1), true);
    if (succeeds) resolveSave({ session: { id: 'saved', version: 'v1' } });
    else rejectSave(new Error('offline'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.at(-1), !succeeds);
    assert.equal(controller.messages.at(-1).status, 'stopped');
  }
});

test('failed stopped-answer save can retry the same write without rerunning the model', async () => {
  const Controller = await loadController();
  const writes = []; let streams = 0;
  const controller = new Controller({ cancelStream() {},
    postStream: async () => { streams++; },
    post: async (_path, body) => {
      writes.push(structuredClone(body));
      if (writes.length === 1) throw new Error('offline');
      return { session: { id: body.id, version: 'v1' } };
    },
    get: async () => ({ sessions: [] })
  }, view());
  controller.messages = [{ id: 'u', role: 'user', content: 'question' },
    { id: 'a', role: 'assistant', content: 'partial' }];
  controller.sending = true;
  controller.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.failedAttempt?.saveOnly, true);
  assert.equal(controller.messages.at(-1).status, 'stopped');
  await controller.runAttempt(controller.failedAttempt);
  assert.equal(streams, 0);
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(controller.sessionVersion, 'v1');
  assert.equal(controller.failedAttempt, undefined);
});

test('stop during completed-answer persistence does not start a competing write', async () => {
  const Controller = await loadController();
  let finishSave;
  const writes = [];
  const controller = new Controller({
    postStream: async (_path, _request, chunk) =>
      chunk('event: done\ndata: {"answer":"complete","citations":[]}\n\n'),
    post: (path, body) => { writes.push({ path, body });
      return new Promise(resolve => { finishSave = resolve; }); },
    get: async () => ({ sessions: [] }), cancelStream() {}
  }, view());
  controller.question = 'question';
  const sending = controller.send();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  controller.stop();
  assert.equal(writes.length, 1);
  assert.equal(controller.messages.at(-1).status, undefined);
  finishSave({ session: { id: writes[0].body.id, version: 'v1' } });
  await sending;
  assert.equal(controller.sessionVersion, 'v1');
});

test('stop during a save-only retry keeps the pending write intact', async () => {
  const Controller = await loadController();
  let finishSave; let writes = 0;
  const controller = new Controller({ cancelStream() {},
    post: (_path, body) => { writes++;
      return new Promise(resolve => { finishSave = () => resolve({ session: { id: body.id, version: 'v1' } }); }); },
    get: async () => ({ sessions: [] })
  }, view());
  controller.messages = [{ id: 'u', role: 'user', content: 'question' },
    { id: 'a', role: 'assistant', content: 'partial', status: 'stopped' }];
  controller.failedAttempt = { request: { question: 'question', history: [], mode: 'logs_only' },
    userId: 'u', answerId: 'a', saveOnly: true };
  const retry = controller.runAttempt(controller.failedAttempt);
  await new Promise(resolve => setImmediate(resolve));
  controller.stop();
  assert.equal(writes, 1);
  assert.equal(controller.messages.at(-1).status, 'stopped');
  finishSave();
  await retry;
  assert.equal(controller.sessionVersion, 'v1');
});

test('late stopped-answer save cannot replace a newly opened session', async () => {
  const QaSessionController = await loadController();
  let finishSave;
  const controller = new QaSessionController({
    cancelStream() {},
    post: () => new Promise(resolve => { finishSave = resolve; }),
    get: async path => path === '/rag/sessions/new-session' ? {
      session: { id: 'new-session', version: 'v2', messages: [], answerMode: 'logs_only' }
    } : { sessions: [] }
  }, view());
  controller.messages = [
    { id: 'user-1', role: 'user', content: 'question' },
    { id: 'assistant-1', role: 'assistant', content: 'partial' }
  ];
  controller.sending = true;
  controller.stop();
  await controller.openSession('new-session');
  finishSave({ session: { id: 'old-session', version: 'v1' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.sessionId, 'new-session');
  assert.equal(controller.sessionVersion, 'v2');
});


test('accepted session navigation discards the composer before loading while retries keep their draft', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
  const start = source.indexOf('  private navigationRequestChanged(): void {');
  const end = source.indexOf('  private discardRequested()', start);
  const module = { exports: {} };
  const code = ts.transpileModule(`export class Page { ${source.slice(start, end)} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  runInNewContext(code, { module, exports: module.exports });
  const page = new module.exports.Page();
  const calls = [];
  page.data = { question: 'unsent', openSession: id => calls.push([id, page.data.question]), newSession: () => calls.push(['new', page.data.question]) };
  page.onPendingChange = () => {};
  page.onDraftChange = dirty => calls.push(['dirty', dirty]);
  page.navigationRequestRevision = 0;
  page.navigationRequestChanged();
  assert.equal(page.data.question, 'unsent');
  page.navigationRequestRevision = 1;
  page.navigationSessionId = 'history';
  page.navigationRequestChanged();
  assert.equal(page.data.question, '');
  assert.deepEqual(calls, [['dirty', false], ['history', '']]);
  page.data.question = 'draft during failed load';
  page.data.openSession('history');
  assert.equal(page.data.question, 'draft during failed load');
});
