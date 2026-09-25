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
  onSessionsChange() {}, onSessionsError() {}, onActiveSessionChange() {}, onBusyChange() {},
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
