import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function controller(transport) {
  const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogAiController.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
  } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Observed: value => value,
    require: () => ({ ApiError: Error }) });
  return new module.exports.LogAiController(transport);
}

test('pending generation rejects duplicate operations and preserves its requested date', async () => {
  const response = deferred(), calls = [];
  const c = await controller({ post: (path, body) => {
    calls.push({ path, body });
    return response.promise;
  } });
  c.material = 'synthetic FIFO';
  const pending = c.generate('2026-02-05');
  assert.equal(c.busy, true);
  await c.generate('2026-01-17');
  await c.highlight('2026-01-17', 'other body');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.date, '2026-02-05');
  response.resolve({ result: { content: 'generated FIFO', warnings: [] } });
  await pending;
  assert.equal(c.outputDate, '2026-02-05');
  assert.equal(c.output, 'generated FIFO');
  assert.equal(c.busy, false);
});

test('disposed generation cannot overwrite a replacement request or clear its busy state', async () => {
  for (const fails of [false, true]) {
    const old = deferred(), current = deferred();
    let calls = 0;
    const c = await controller({ post: () => ++calls === 1 ? old.promise : current.promise });
    c.material = 'old synthetic material';
    const first = c.generate('2026-02-05');
    c.dispose();
    c.material = 'new synthetic material';
    const second = c.generate('2026-01-17');
    if (fails) old.reject(new Error('old failure'));
    else old.resolve({ result: { content: 'old output', warnings: ['old warning'] } });
    await first;
    assert.equal(c.busy, true);
    assert.equal(c.output, '');
    assert.equal(c.message, '');
    current.resolve({ result: { content: 'new output', warnings: [] } });
    await second;
    assert.equal(c.outputDate, '2026-01-17');
    assert.equal(c.output, 'new output');
    assert.equal(c.busy, false);
  }
});
