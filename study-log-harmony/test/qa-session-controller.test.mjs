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
      chunk('event: done\ndata: {"answer":"complete","citations":[]}\n\n');
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
