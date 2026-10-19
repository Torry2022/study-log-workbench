import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { fixture } from './qa-task-fixture.mjs';

test('actual native connection factory keeps old services on legacy and scopes pending records by namespace', async t => {
  const f = await fixture(), activeInstance = { namespace: 'namespace-A', capabilities: { instanceId: f.instanceId, features: {} } }, calls = [];
  const source = await readFile(new URL('../entry/src/main/ets/features/qa/QaTaskConnection.ets', import.meta.url), 'utf8'), module = { exports: {} };
  const dependencies = { '../../common/network/ApiClient': { apiClient: f.transport }, '../../common/network/InstanceConfig': { activeInstance },
    '../../common/storage/InstanceStore': { instanceStore: { readQaPending: async namespace => { calls.push(namespace); return '[]'; }, writeQaPending: async (namespace, raw) => calls.push([namespace, raw]) } }, './QaTaskClient': { QaTaskClient: f.QaTaskClient } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => dependencies[name] });
  const create = module.exports.createQaTaskConnection;
  assert.equal(create(), undefined); activeInstance.capabilities.features.ragTasks = { supported: false, configured: false, protocolVersion: 1 }; assert.equal(create(), undefined);
  activeInstance.capabilities.features.ragTasks = { supported: true, configured: false, protocolVersion: 9 };
  const client = create(); t.after(() => client.stop()); assert.ok(client); activeInstance.namespace = 'namespace-B';
  await client.storage.read(); await client.storage.write('[]'); assert.deepEqual(calls, ['namespace-A', ['namespace-A', '[]']]);
});

test('native answer handler uses message and version identities after updates', async () => {
  const source = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
  const start = source.indexOf('  private async answerAction('), end = source.indexOf('  private composerHorizontalInset()', start);
  assert.ok(start > 0 && end > start); const method = source.slice(start, end), module = { exports: {} };
  runInNewContext(ts.transpileModule(`export class Page { ${method} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports });
  const page = new module.exports.Page(), selected = [];
  page.data = { answerMessages: () => [{ id: 'answer-A', role: 'assistant', questionId: 'question-A' }, { id: 'answer-B', role: 'assistant', questionId: 'question-B' }],
    selectAnswerVersion: (questionId, answerId) => selected.push([questionId, answerId]) };
  await page.answerAction('answer-A', 'version', 'older-A');
  await page.answerAction('unknown', 'version', 'older-B');
  assert.deepEqual(selected, [['question-A', 'older-A']]);
});
