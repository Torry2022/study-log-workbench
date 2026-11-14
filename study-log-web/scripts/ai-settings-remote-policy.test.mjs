import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeAiSettings, readAiSettings, saveAiSettings } from '../../ops/ai-settings.mjs';
import { configureRagThinking, getChatConfig, snapshotAiEnvironment } from '../lib/ai-config.ts';
import { remoteSafeFetch } from '../lib/ai-outbound.ts';

test('remote ownership survives disabling writes, changed allowlist and unchanged deployment target', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-policy-'));
  try {
    const root = path.join(base, 'config'), logs = path.join(base, 'data'), id = crypto.randomUUID(), endpoint = 'https://example.com/chat/completions';
    await fs.mkdir(root); await fs.mkdir(logs); await fs.writeFile(path.join(logs, '.instance.json'), JSON.stringify({ schemaVersion: 1, id }));
    const env = { LOG_ROOT: logs, AI_SETTINGS_ROOT: root, AI_SETTINGS_REMOTE_WRITE_ENABLED: 'true', AI_SETTINGS_ALLOWED_ENDPOINTS: JSON.stringify([endpoint]), CHAT_API_URL: endpoint, CHAT_API_KEY: 'synthetic-key', CHAT_MODEL: 'model' };
    const initial = await initializeAiSettings({ root, instanceId: id, env });
    await saveAiSettings({ root, instanceId: id, expectedRevision: initial.revision, operationId: crypto.randomUUID(), values: { ...initial.values, CHAT_MODEL: 'new-model' }, keyAction: 'keep', remoteManaged: true });
    const snapshot = snapshotAiEnvironment({ ...env, AI_SETTINGS_REMOTE_WRITE_ENABLED: 'false', AI_SETTINGS_ALLOWED_ENDPOINTS: '[]' });
    const config = getChatConfig(snapshot); assert.ok(config.outboundPolicy);
    await assert.rejects(remoteSafeFetch(config.baseUrl, {}, config.outboundPolicy));
    const current = await readAiSettings(root, id);
    await saveAiSettings({ root, instanceId: id, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_MODEL: 'local-model' }, keyAction: 'keep' });
    assert.equal((await readAiSettings(root, id)).remoteManaged, true);
    const next = await readAiSettings(root, id);
    await saveAiSettings({ root, instanceId: id, expectedRevision: next.revision, operationId: crypto.randomUUID(), values: { ...next.values, CHAT_API_URL: 'http://127.0.0.1:5000/chat', CHAT_API_KEY: 'local-key' }, keyAction: 'replace' });
    assert.equal((await readAiSettings(root, id)).remoteManaged, false);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('hidden stored thinking is preserved but applied only to a compatible target; key rotation retains capacity', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-options-'));
  try {
    const root = path.join(base, 'config'), logs = path.join(base, 'data'), id = crypto.randomUUID(); await fs.mkdir(root); await fs.mkdir(logs);
    await fs.writeFile(path.join(logs, '.instance.json'), JSON.stringify({ schemaVersion: 1, id }));
    const env = { LOG_ROOT: logs, AI_SETTINGS_ROOT: root, CHAT_API_URL: 'https://api.deepseek.com/chat/completions', CHAT_API_KEY: 'synthetic-key', CHAT_MODEL: 'deepseek-flash', RAG_DEEPSEEK_THINKING: 'low', RAG_CONTEXT_WINDOW_TOKENS: '120000', RAG_AGENT_TOOL_CALLING_VERIFIED: 'true' };
    let current = await initializeAiSettings({ root, instanceId: id, env });
    await saveAiSettings({ root, instanceId: id, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_API_KEY: 'new-key' }, keyAction: 'replace' });
    current = await readAiSettings(root, id); assert.equal(current.values.RAG_CONTEXT_WINDOW_TOKENS, '120000'); assert.equal(current.values.RAG_AGENT_TOOL_CALLING_VERIFIED, 'false');
    await saveAiSettings({ root, instanceId: id, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_API_URL: 'https://custom.invalid/chat', CHAT_API_KEY: 'custom-key', CHAT_MODEL: 'custom' }, keyAction: 'replace' });
    current = await readAiSettings(root, id); assert.equal(current.values.RAG_DEEPSEEK_THINKING, 'low'); assert.equal(current.values.RAG_CONTEXT_WINDOW_TOKENS, '');
    const snapshot = snapshotAiEnvironment(env); assert.equal(configureRagThinking(getChatConfig(snapshot), snapshot).thinkingMode, undefined);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('authorization expiring inside the configuration lock prevents the write', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-reauth-'));
  try {
    const root = path.join(base, 'config'), id = crypto.randomUUID(); await fs.mkdir(root);
    const current = await initializeAiSettings({ root, instanceId: id, env: { CHAT_API_URL: 'https://example.invalid/chat', CHAT_API_KEY: 'synthetic-key', CHAT_MODEL: 'before' } });
    let checks = 0;
    await assert.rejects(saveAiSettings({ root, instanceId: id, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_MODEL: 'after' }, keyAction: 'keep', remoteManaged: true, beforeCommit: async () => { if (++checks === 2) throw Error('authorization expired'); } }), /authorization expired/);
    const saved = await readAiSettings(root, id); assert.equal(checks, 2); assert.equal(saved.revision, current.revision); assert.equal(saved.values.CHAT_MODEL, 'before');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
