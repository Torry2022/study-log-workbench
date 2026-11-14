import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

test('probe rechecks authorization after the provider response', async () => {
  const source = await fs.readFile(new URL('../lib/ai-settings-probe.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const instanceId = '11111111-1111-4111-8111-111111111111'; let allowed = true, checks = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  class Failure extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  const current = { revision: 1, values: { CHAT_API_URL: 'https://synthetic.invalid/chat', CHAT_API_KEY: 'synthetic' } };
  const dependencies = {
    './ai-settings-operation.ts': { authorizeSettingsMutation() { checks++; if (!allowed) throw new Failure('UNAUTHORIZED', 'denied', 401); }, readSettingsOperation: async () => ({ body: { expectedRevision: 1, endpointAction: 'keep', keyAction: 'keep', model: 'model' }, root: 'synthetic', current, instanceId }), SettingsOperationError: Failure },
    './ai-outbound.ts': { remoteEndpointAllowed: () => true, remoteSafeFetch: async () => { await gate; return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); } },
    'node:fs/promises': { readFile: async () => JSON.stringify({ schemaVersion: 1, id: instanceId }) }, 'node:path': path,
    './config.ts': { getLogRoot: () => '/synthetic' }, './ai-settings-reader.ts': { readAiSettingsRecord: () => current },
  };
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; }, Response, AbortSignal, TextDecoder, Buffer, Error, JSON, Array, Number, String });
  const pending = module.exports.probeSettings({ signal: new AbortController().signal }, 'test'); await new Promise(resolve => setImmediate(resolve)); allowed = false; release();
  await assert.rejects(pending, { code: 'UNAUTHORIZED' }); assert.equal(checks, 2);
});
