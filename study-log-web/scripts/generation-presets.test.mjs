import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as presets from '../lib/generation-presets-store.ts';
import { parseGenerationPresets, survivingPresetSelection } from '../lib/generation-presets-view.ts';
import { generateLogDraft, validateGenerationInput } from '../lib/ai-generation.ts';
const require = createRequire(import.meta.url), next = require('next/server');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-presets-'));
  const root = path.join(base, 'data'), backup = path.join(base, 'backups');
  await fs.mkdir(path.join(root, 'prompts'), { recursive: true });
  await fs.writeFile(path.join(root, 'prompts/generation.md'), '保留已有个人写作规范');
  const previous = Object.fromEntries(['LOG_ROOT', 'BACKUP_ROOT', 'CHAT_API_KEY', 'CHAT_API_URL', 'CHAT_MODEL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { LOG_ROOT: root, BACKUP_ROOT: backup });
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(base), path.resolve(os.tmpdir())); assert.ok(path.basename(base).startsWith('workbench-presets-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, root, backup, file: path.join(root, 'prompts/generation-presets.json') };
}

test('preset lifecycle preserves legacy, read-only built-ins, exact backups and an atomic default fallback', async t => {
  const { root, backup, file } = await fixture(t);
  let state = await presets.listGenerationPresets();
  assert.equal(state.defaultPresetId, 'legacy');
  assert.equal(state.presets.length, 4); assert.equal(state.presets.filter(item => item.id.startsWith('builtin:')).length, 3);
  assert.ok(state.presets.every(item => item.readOnly));
  assert.equal(state.presets[0].prompt, '保留已有个人写作规范');
  assert.deepEqual(await fs.readdir(path.join(root, 'prompts')), ['generation.md']);
  state = await presets.mutateGenerationPresets({ action: 'create', version: state.version, name: '合成技术方案', prompt: '合成自定义技术要求' });
  const personal = state.presets.find(item => !item.readOnly);
  assert.match(personal.id, /^user:/);
  const initialRaw = await fs.readFile(file, 'utf8');
  state = await presets.mutateGenerationPresets({ action: 'update', version: state.version, id: personal.id, name: '已重命名', prompt: '合成修订要求' });
  assert.equal(state.presets.find(item => item.id === personal.id).name, '已重命名');
  assert.equal(await fs.readFile(path.join(backup, (await fs.readdir(backup))[0]), 'utf8'), initialRaw);
  state = await presets.mutateGenerationPresets({ action: 'default', version: state.version, defaultPresetId: personal.id });
  assert.equal(state.defaultPresetId, personal.id);
  for (const id of ['legacy', 'builtin:daily']) {
    await assert.rejects(presets.mutateGenerationPresets({ action: 'delete', version: state.version, id }), error => error.status === 404);
    await assert.rejects(presets.mutateGenerationPresets({ action: 'update', version: state.version, id, name: 'overwrite', prompt: 'overwrite' }), error => error.status === 404);
  }
  state = await presets.mutateGenerationPresets({ action: 'delete', version: state.version, id: personal.id });
  assert.equal(state.defaultPresetId, 'legacy'); assert.equal(state.presets.length, 4);
  assert.equal(await fs.readFile(path.join(root, 'prompts/generation.md'), 'utf8'), '保留已有个人写作规范');
  assert.equal((await fs.readdir(backup)).length, 3);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).defaultPresetId, 'legacy');
});

test('concurrent versioned writes conflict, invalid changes do not write, instance roots stay independent', async t => {
  const { base, root, file } = await fixture(t);
  const initial = await presets.listGenerationPresets();
  const results = await Promise.allSettled(['一', '二'].map(name => presets.mutateGenerationPresets({ action: 'create', version: initial.version, name, prompt: '合成内容' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  const state = await presets.listGenerationPresets(), raw = await fs.readFile(file, 'utf8');
  for (const input of [{ action: 'default', defaultPresetId: '../../other' }, { action: 'create', name: '', prompt: 'x' },
    { action: 'create', name: 'same', prompt: 'x'.repeat(65537) }, { action: 'create', name: 'a\nb', prompt: 'x' },
    { action: 'create', name: state.presets.at(-1).name, prompt: 'duplicate' }]) {
    await assert.rejects(presets.mutateGenerationPresets({ ...input, version: state.version }));
  }
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  const other = path.join(base, 'other'); await fs.mkdir(path.join(other, 'prompts'), { recursive: true });
  await fs.writeFile(path.join(other, 'prompts/generation.md'), '另一实例'); process.env.LOG_ROOT = other;
  const different = await presets.listGenerationPresets(); assert.equal(different.presets.length, 4); assert.equal(different.presets[0].prompt, '另一实例');
  process.env.LOG_ROOT = root;
  assert.equal((await presets.listGenerationPresets()).version, state.version);
});

test('corrupt storage and unsafe prompt directory fail closed without replacing source data', async t => {
  const { base, root, file } = await fixture(t);
  await fs.writeFile(file, '{malformed');
  await assert.rejects(presets.listGenerationPresets());
  await assert.rejects(presets.mutateGenerationPresets({ action: 'create', version: 'bad', name: 'x', prompt: 'x' }));
  assert.equal(await fs.readFile(file, 'utf8'), '{malformed');
  await fs.rename(path.join(root, 'prompts'), path.join(base, 'outside-prompts'));
  await fs.symlink(path.join(base, 'outside-prompts'), path.join(root, 'prompts'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(presets.listGenerationPresets());
  await assert.rejects(presets.readGenerationPreset('builtin:daily'));
  await fs.unlink(path.join(root, 'prompts'));
});

test('a failed write-before-backup preserves the preset file and its version', async t => {
  const { backup, file } = await fixture(t);
  let state = await presets.listGenerationPresets();
  state = await presets.mutateGenerationPresets({ action: 'create', version: state.version, name: '合成原方案', prompt: '不可丢失' });
  const raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(backup, 'synthetic obstacle');
  await assert.rejects(presets.mutateGenerationPresets({ action: 'update', version: state.version, id: state.presets.at(-1).id, name: '不能保存', prompt: '新内容' }));
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  assert.equal((await presets.listGenerationPresets()).version, state.version);
});

test('selected templates reach the real generation request; omission remains legacy despite the new default', async t => {
  const { root } = await fixture(t);
  let captured = '', calls = 0;
  const app = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    captured = JSON.parse(Buffer.concat(chunks).toString()).messages[0].content; calls++;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '### 合成结果\n\n仅供审阅。' } }] }));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  Object.assign(process.env, { CHAT_API_KEY: 'synthetic-key', CHAT_API_URL: `http://127.0.0.1:${app.address().port}/chat`, CHAT_MODEL: 'synthetic-model' });
  let state = await presets.listGenerationPresets();
  state = await presets.mutateGenerationPresets({ action: 'default', version: state.version, defaultPresetId: 'builtin:practice' });
  const input = { date: '2026-01-15', material: '合成技术素材' };
  await generateLogDraft(input); assert.match(captured, /保留已有个人写作规范/);
  await generateLogDraft({ ...input, presetId: 'builtin:practice' }); assert.match(captured, /整理项目实践或排错过程/); assert.doesNotMatch(captured, /保留已有个人写作规范/);
  state = await presets.mutateGenerationPresets({ action: 'create', version: state.version, name: '明确方案', prompt: '合成独立方案正文' });
  await generateLogDraft({ ...input, presetId: state.presets.at(-1).id }); assert.match(captured, /合成独立方案正文/);
  for (const presetId of [null, {}, '', '../../generation.md', 'builtin:other']) assert.throws(() => validateGenerationInput({ ...input, presetId }));
  const before = calls;
  await assert.rejects(generateLogDraft({ ...input, presetId: `user:${crypto.randomUUID()}` }), error => error.status === 404);
  assert.equal(calls, before);
  assert.equal(await fs.readFile(path.join(root, 'prompts/generation.md'), 'utf8'), '保留已有个人写作规范');
  await fs.unlink(path.join(root, 'prompts/generation.md'));
  await generateLogDraft({ ...input, presetId: 'builtin:daily' }); assert.match(captured, /将当天的零散笔记/);
  assert.match((await presets.listGenerationPresets()).presets.find(item => item.id === 'legacy').issue, /文件不存在/);
  await assert.rejects(generateLogDraft(input), error => error.code === 'AI_TEMPLATE_INVALID');
});

test('actual presets API authenticates before body reads and returns bounded, versioned mutations for web and app tokens', async t => {
  const { root } = await fixture(t);
  async function load(relative, dependencies) {
    const source = await fs.readFile(new URL(relative, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { exports: module.exports, Buffer, Response, TextDecoder, Uint8Array, Error, require(name) {
      if (name === 'next/server') return next;
      if (name === 'node:crypto') return crypto;
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    } }); return module.exports;
  }
  const auth = await load('../lib/auth.ts', { '@/lib/config': { getSessionSecret: () => 'synthetic-secret-'.repeat(4), getAppPassword: () => assert.fail('password read'), getCookieSecure: () => false } });
  const route = await load('../app/api/ai/generation-presets/route.ts', { '@/lib/auth': auth, '@/lib/generation-presets-store': presets });
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal((await route[method]({ cookies: new Map(), headers: new Headers(), get body() { assert.fail('unauthenticated body read'); } })).status, 401);
  const request = (method, body, bearer = false) => new next.NextRequest('http://localhost/study-log/api/ai/generation-presets', {
    method, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    headers: bearer ? { authorization: `Bearer ${auth.createAppToken().token}` } : { cookie: `study_log_session=${auth.createSessionToken()}` }
  });
  for (const bearer of [false, true]) {
    const response = await route.GET(request('GET', undefined, bearer)); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const initial = await (await route.GET(request('GET'))).json();
  let response = await route.POST(request('POST', { version: initial.version, name: '合成API方案', prompt: '合成要求' }, true));
  assert.equal(response.status, 200); let state = await response.json(); const id = state.presets.at(-1).id;
  assert.equal((await route.POST(request('POST', { version: initial.version, name: '过期', prompt: '过期' }))).status, 409);
  assert.equal((await route.PATCH(request('PATCH', { version: state.version, id: 'legacy', name: 'overwrite', prompt: 'overwrite' }))).status, 404);
  response = await route.PATCH(request('PATCH', { version: state.version, id, name: '重命名', prompt: '更新要求' })); assert.equal(response.status, 200); state = await response.json();
  response = await route.PATCH(request('PATCH', { version: state.version, defaultPresetId: id })); assert.equal(response.status, 200); state = await response.json();
  response = await route.DELETE(request('DELETE', { version: state.version, id })); assert.equal(response.status, 200); assert.equal((await response.json()).defaultPresetId, 'legacy');
  assert.equal((await route.POST(request('POST', '{bad'))).status, 400);
  assert.equal((await route.POST(request('POST', ' '.repeat(400001)))).status, 413);
  await fs.writeFile(path.join(root, 'prompts/generation-presets.json'), 'private-corrupt-content');
  response = await route.GET(request('GET')); assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private-corrupt|workbench-presets/);
});

test('client rejects malformed successful responses and recovers removed selection using explicit default', () => {
  const snapshot = { version: 'a'.repeat(64), defaultPresetId: 'legacy', presets: [{ id: 'legacy', name: '现有默认方案', prompt: 'legacy', readOnly: true }] };
  assert.equal(parseGenerationPresets(snapshot), snapshot);
  assert.equal(survivingPresetSelection(snapshot, 'user:removed'), 'legacy');
  for (const input of [{}, { ...snapshot, version: '' }, { ...snapshot, presets: [] }, { ...snapshot, defaultPresetId: 'missing' }, { ...snapshot, presets: [snapshot.presets[0], snapshot.presets[0]] }]) assert.throws(() => parseGenerationPresets(input));
});
