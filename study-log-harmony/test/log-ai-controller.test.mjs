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

test('presets use server default and generation preserves legacy omission', async () => {
  const calls = [];
  const c = await controller({ get: async () => ({ version: 'v1', defaultPresetId: 'builtin:practice',
    presets: [{ id: 'legacy', name: '现有默认方案' }, { id: 'builtin:practice', name: '实践与排错' }] }),
    post: async (_path, body) => { calls.push(body); return { result: { content: 'synthetic', warnings: [] } }; } });
  await c.loadPresets();
  assert.equal(c.presetId, 'builtin:practice');
  c.material = 'synthetic';
  await c.generate('2026-02-05');
  assert.equal(calls[0].presetId, 'builtin:practice');
  c.presetId = 'legacy';
  await c.loadPresets();
  assert.equal(c.presetId, 'legacy');
  await c.generate('2026-02-05');
  assert.equal(Object.hasOwn(calls[1], 'presetId'), false);
});

test('late preset responses cannot leak across disposed instances', async () => {
  const pending = deferred();
  const c = await controller({ get: () => pending.promise });
  const task = c.loadPresets();
  c.dispose();
  pending.resolve({ version: 'old', defaultPresetId: 'user:old', presets: [{ id: 'user:old', name: 'old private scheme' }] });
  await task;
  assert.equal(c.presets.length, 0);
  assert.equal(c.presetId, 'legacy');
  assert.equal(c.presetsLoaded, false);
  assert.equal(c.presetsLoading, false);
});

test('preset failure blocks generation but a legacy server 404 keeps the old API usable', async () => {
  let status = 500, calls = 0;
  const c = await controller({ get: async () => { const error = new Error('failed'); error.statusCode = status; throw error; },
    post: async () => { calls++; return { result: { content: 'synthetic', warnings: [] } }; } });
  c.material = 'synthetic';
  await c.loadPresets();
  await c.generate('2026-02-05');
  assert.equal(calls, 0);
  status = 404;
  await c.loadPresets();
  assert.equal(c.presetError, '');
  await c.generate('2026-02-05');
  assert.equal(calls, 1);
});

test('generation readiness uses provider configuration only for explicit presets, with legacy compatibility', async () => {
  const c = await controller({});
  const capabilities = { features: { aiWriting: { supported: true, configured: false } },
    aiConfiguration: { provider: { configured: true } } };
  assert.equal(c.generationConfigured(capabilities), false);
  for (const id of ['builtin:practice', 'user:synthetic']) {
    c.presetId = id;
    assert.equal(c.generationConfigured(capabilities), true);
    assert.equal(c.generationConfigured({ ...capabilities, aiConfiguration: { provider: { configured: false } } }), false);
    assert.equal(c.generationConfigured({ ...capabilities, features: { aiWriting: { supported: false, configured: true } } }), false);
  }
  for (const id of ['legacy', 'builtin:daily']) {
    c.presetId = id;
    assert.equal(c.generationConfigured({ features: { aiWriting: { supported: true, configured: true } } }), true);
    assert.equal(c.generationConfigured({ features: { aiWriting: { supported: true, configured: false } } }), false);
    assert.equal(c.generationConfigured(undefined), false);
  }
});
