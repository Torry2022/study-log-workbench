import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { DesktopManager, probeAiDraft } from './manager.mjs';
import { readAiSettings, saveAiSettings } from '../ai-settings.mjs';

test('local explicit generation check sends only a fixed short message to a synthetic model', async () => {
  let body; const server = http.createServer(async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); body = JSON.parse(Buffer.concat(chunks)); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await probeAiDraft({ action: 'test', endpoint: `http://127.0.0.1:${server.address().port}/chat`, model: 'synthetic', key: 'synthetic-key' });
    assert.deepEqual(result, { ok: true }); assert.deepEqual(body.messages, [{ role: 'user', content: '请回复 OK。' }]); assert.equal(body.max_tokens, 8);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('locally probing a retained remote-managed target fails closed when it is removed from the allowlist', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'local-probe-'));
  try {
    const manager = new DesktopManager({ packageRoot: path.resolve(import.meta.dirname, '../..') });
    await manager.select({ root: path.join(base, 'instance'), create: true, password: crypto.randomUUID() });
    const context = await manager.aiSettingsContext(), current = await readAiSettings(context.root, context.instanceId);
    await saveAiSettings({ ...context, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_API_URL: 'https://example.invalid/chat', CHAT_API_KEY: 'synthetic-key', CHAT_MODEL: 'model' }, keyAction: 'replace', remoteManaged: true });
    const updated = await readAiSettings(context.root, context.instanceId); manager.aiOutboundPolicy = { AI_SETTINGS_ALLOWED_ENDPOINTS: '[]' };
    await assert.rejects(manager.probe({ action: 'test', model: 'model', expectedRevision: updated.revision, expectedInstanceId: context.instanceId }), /无法连接模型服务/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('a delayed check is discarded when the saved revision changes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'local-probe-revision-'));
  let received, release; const started = new Promise(resolve => { received = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const server = http.createServer(async (_request, response) => { received(); await gate; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const manager = new DesktopManager({ packageRoot: path.resolve(import.meta.dirname, '../..') });
    await manager.select({ root: path.join(base, 'instance'), create: true, password: crypto.randomUUID() });
    const context = await manager.aiSettingsContext(), current = await readAiSettings(context.root, context.instanceId);
    await saveAiSettings({ ...context, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_API_URL: `http://127.0.0.1:${server.address().port}/chat`, CHAT_API_KEY: 'synthetic-key', CHAT_MODEL: 'model' }, keyAction: 'replace' });
    const saved = await readAiSettings(context.root, context.instanceId);
    const probe = manager.probe({ action: 'test', model: 'model', expectedRevision: saved.revision, expectedInstanceId: context.instanceId });
    await started;
    await saveAiSettings({ ...context, expectedRevision: saved.revision, operationId: crypto.randomUUID(), values: { ...saved.values, CHAT_MODEL: 'changed' }, keyAction: 'keep' });
    release(); await assert.rejects(probe, /另一处更新/);
  } finally { release(); await new Promise(resolve => server.close(resolve)); await fs.rm(base, { recursive: true, force: true }); }
});
