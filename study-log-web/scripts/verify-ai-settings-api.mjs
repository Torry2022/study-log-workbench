import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { initializeAiSettings, readAiSettings, saveAiSettings } from '../../ops/ai-settings.mjs';

const webRoot = path.resolve(import.meta.dirname, '..'), base = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-api-'));
const data = path.join(base, 'data'), config = path.join(base, 'config'); await fs.mkdir(data); await fs.mkdir(config);
const id = crypto.randomUUID(), password = 'SyntheticOnlyPass42', target = 'https://example.invalid/chat/completions';
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id }));
await initializeAiSettings({ root: config, instanceId: id, env: { CHAT_API_URL: target, CHAT_API_KEY: 'original-synthetic-key', CHAT_MODEL: 'original' } });
async function launch(writable) {
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`, baseUrl = `${origin}/study-log`;
  const env = { ...process.env, LOG_ROOT: data, AI_SETTINGS_ROOT: config, APP_PASSWORD: password, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), COOKIE_SECURE: 'false', CHAT_API_URL: target, CHAT_API_KEY: 'deployment-synthetic-key', CHAT_MODEL: 'deployment-model', AI_SETTINGS_REMOTE_WRITE_ENABLED: String(writable), AI_SETTINGS_ALLOWED_ENDPOINTS: JSON.stringify([target]), AI_SETTINGS_PUBLIC_ORIGIN: origin, STUDY_LOG_MCP_TOKEN: '' };
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: webRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; server.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; ; i++) { try { if ((await fetch(baseUrl)).ok) break; } catch {} if (i > 100 || server.exitCode !== null) throw Error(output); await new Promise(resolve => setTimeout(resolve, 100)); }
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const app = await fetch(`${baseUrl}/api/auth/app-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }); const bearer = (await app.json()).token;
  return { server, origin, baseUrl, cookie, bearer };
}
const put = (s, body, headers = {}) => fetch(`${s.baseUrl}/api/settings/ai`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: s.cookie, origin: s.origin, ...headers }, body: JSON.stringify(body) });
const body = (revision, operationId) => ({ password, expectedInstanceId: id, expectedRevision: revision, operationId, provider: 'custom', endpointAction: 'keep', keyAction: 'keep', model: 'updated', lightModel: '' });
let s;
try {
  s = await launch(false); let response = await put(s, body(1, crypto.randomUUID())); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'AI_SETTINGS_READ_ONLY'); s.server.kill();
  s = await launch(true);
  let capabilities = await fetch(`${s.baseUrl}/api/capabilities`, { headers: { cookie: s.cookie } }); assert.equal((await capabilities.json()).settings.ai.writable, true);
  response = await put(s, body(1, crypto.randomUUID()), { origin: 'https://attacker.invalid' }); assert.equal(response.status, 403);
  response = await put(s, body(1, crypto.randomUUID()), { authorization: 'Bearer invalid' }); assert.equal(response.status, 401);
  response = await put(s, { ...body(1, crypto.randomUUID()), password: 'incorrect' }); assert.equal((await response.json()).code, 'AI_SETTINGS_REAUTH_FAILED');
  response = await put(s, { ...body(1, crypto.randomUUID()), expectedInstanceId: crypto.randomUUID() }); assert.equal((await response.json()).code, 'AI_SETTINGS_INSTANCE_CHANGED');
  response = await put(s, { ...body(1, crypto.randomUUID()), endpointAction: 'replace', endpoint: 'https://other.invalid/chat' }); assert.equal((await response.json()).code, 'AI_SETTINGS_ENDPOINT_NOT_ALLOWED');
  const operationId = crypto.randomUUID(), operation = body(1, operationId); response = await put(s, operation, { authorization: `Bearer ${s.bearer}` }); assert.equal(response.status, 200);
  let result = await response.json(); assert.equal(result.operationId, operationId); assert.equal(result.revision, 2); assert.ok(!JSON.stringify(result).includes('original-synthetic-key'));
  assert.equal((await readAiSettings(config, id)).remoteManaged, true);
  response = await put(s, { ...operation, model: 'changed-replay' }); result = await response.json(); assert.equal(result.model, 'updated'); assert.equal(result.operationId, operationId);
  response = await put(s, body(1, crypto.randomUUID())); assert.equal((await response.json()).code, 'AI_SETTINGS_CONFLICT');
  response = await fetch(`${s.baseUrl}/api/settings/ai/models`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: s.cookie, origin: s.origin }, body: JSON.stringify({ ...body(2, crypto.randomUUID()), keyAction: 'keep' }) }); assert.equal((await response.json()).code, 'AI_SETTINGS_MODELS_UNSUPPORTED');
  response = await fetch(`${s.baseUrl}/api/settings/ai/deployment-preview`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: s.cookie, origin: s.origin }, body: JSON.stringify({ password, expectedInstanceId: id }) }); const preview = await response.json(); assert.equal(preview.revision, 2); assert.equal(preview.model, 'deployment-model'); assert.ok(!JSON.stringify(preview).includes('deployment-synthetic-key'));
  response = await put(s, { password, expectedInstanceId: id, expectedRevision: preview.revision, operationId: crypto.randomUUID(), mode: 'restore_deployment', previewId: preview.previewId }); assert.equal(response.status, 200); assert.equal((await response.json()).model, 'deployment-model');
  const prior = await readAiSettings(config, id);
  await saveAiSettings({ root: config, instanceId: id, expectedRevision: prior.revision, operationId: crypto.randomUUID(), values: { ...prior.values, CHAT_API_URL: '', CHAT_API_KEY: '', CHAT_MODEL: '' }, keyAction: 'remove' });
  const empty = await readAiSettings(config, id);
  response = await put(s, { ...body(empty.revision, crypto.randomUUID()), provider: 'custom', model: 'incomplete-model' }); assert.equal(response.status, 200);
  result = await response.json(); assert.equal(result.hasEndpoint, false); assert.equal(result.model, 'incomplete-model');
  response = await put(s, { ...body(result.revision, crypto.randomUUID()), provider: 'custom', keyAction: 'replace', key: 'synthetic-key' }); assert.equal((await response.json()).code, 'AI_SETTINGS_INPUT');
  console.log(`AI settings API passed: ${base}`);
} finally { s?.server.kill(); }
