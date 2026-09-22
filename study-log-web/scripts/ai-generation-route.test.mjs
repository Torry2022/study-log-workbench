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
import * as generation from '../lib/ai-generation.ts';
import * as chat from '../lib/ai-chat.ts';
import * as config from '../lib/ai-config.ts';
import * as prompts from '../lib/ai-prompts.ts';
const require = createRequire(import.meta.url), next = require('next/server');

test('actual generation route authenticates first, bounds JSON, propagates cancellation, sanitizes failures and never writes the source', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-ai-route-'));
  const previous = Object.fromEntries(['LOG_ROOT', 'CHAT_API_KEY', 'CHAT_API_URL', 'CHAT_MODEL'].map(key => [key, process.env[key]]));
  let calls = 0, mode = 'ok';
  const app = http.createServer(async (req, res) => {
    calls++; for await (const _ of req) { /* consume only synthetic input */ }
    res.setHeader('Content-Type', 'application/json');
    if (mode === '429') { res.statusCode = 429; return res.end('sensitive-provider-body'); }
    if (mode === '500') { res.statusCode = 500; return res.end('sensitive-provider-body'); }
    res.end(JSON.stringify({ choices: [{ message: { content: mode === 'invalid' ? '## 2020-01-01\n\n错误日期' : '### 合成内容\n\n仅供审阅。' } }] }));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { LOG_ROOT: root, CHAT_API_KEY: 'synthetic-route-sensitive-key', CHAT_API_URL: `http://127.0.0.1:${app.address().port}/chat`, CHAT_MODEL: 'fixture-route-model' });
  t.after(async () => {
    app.closeAllConnections(); await new Promise(resolve => app.close(resolve));
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('workbench-ai-route-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'prompts')); await fs.writeFile(path.join(root, 'prompts/generation.md'), '合成模板');
  const source = '## 2026-01-15\n\n### 原文\n\n合成已保存内容。\n';
  const sourcePath = path.join(root, '2026-01_学习日志.md'); await fs.writeFile(sourcePath, source);
  async function load(relative, dependencies) {
    const source = await fs.readFile(new URL(relative, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { exports: module.exports, Buffer, Response, TextDecoder, Uint8Array, Error, require(name) {
      if (name === 'next/server') return next;
      if (name === 'node:crypto') return crypto;
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    } });
    return module.exports;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  const auth = await load('../lib/auth.ts', { '@/lib/config': { getSessionSecret: () => secret, getAppPassword: () => assert.fail('password read'), getCookieSecure: () => false } });
  const route = await load('../app/api/ai/generate/route.ts', { '@/lib/auth': auth, '@/lib/ai-chat': chat, '@/lib/ai-config': config, '@/lib/ai-prompts': prompts, '@/lib/ai-generation': generation });
  assert.equal((await route.POST({ cookies: new Map(), headers: new Headers(), get body() { assert.fail('unauthenticated body read'); } })).status, 401);
  assert.equal(calls, 0);
  const valid = { date: '2026-01-15', material: '合成素材' };
  const request = (value = valid, options = {}) => new next.NextRequest('http://localhost/study-log/api/ai/generate', {
    method: 'POST', body: typeof value === 'string' ? value : JSON.stringify(value), ...options,
    headers: { cookie: `study_log_session=${auth.createSessionToken()}`, ...options.headers }
  });
  for (const headers of [{}, { authorization: `Bearer ${auth.createAppToken().token}`, cookie: '' }]) {
    const response = await route.POST(request(valid, { headers }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { result: { content: '### 合成内容\n\n仅供审阅。', model: 'fixture-route-model', warnings: [] } });
  }
  const beforeInvalid = calls;
  for (const input of ['{bad', null, [], {}, { ...valid, material: {} }, { ...valid, date: '2999-01-01' }, { ...valid, material: 'x'.repeat(120001) }]) {
    assert.equal((await route.POST(request(input))).status, 400);
  }
  assert.equal((await route.POST(request(' '.repeat(800001)))).status, 413);
  const abort = new AbortController(); abort.abort();
  const cancelled = await route.POST(request(valid, { signal: abort.signal }));
  assert.equal(cancelled.status, 499); assert.equal((await cancelled.json()).code, 'AI_CANCELLED');
  assert.equal(calls, beforeInvalid);
  for (const [behavior, status, code] of [['429', 429, 'AI_RATE_LIMITED'], ['500', 502, 'AI_PROVIDER_FAILED'], ['invalid', 502, 'AI_INVALID_DRAFT']]) {
    mode = behavior;
    const response = await route.POST(request()); assert.equal(response.status, status);
    const text = await response.text(); assert.equal(JSON.parse(text).code, code);
    assert.doesNotMatch(text, /sensitive-provider|synthetic-route|127\.0\.0\.1/);
  }
  delete process.env.CHAT_API_KEY;
  assert.equal((await route.POST(request())).status, 503);
  process.env.CHAT_API_KEY = 'synthetic-route-sensitive-key';
  await fs.unlink(path.join(root, 'prompts/generation.md'));
  assert.equal((await route.POST(request())).status, 503);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), source);
  assert.deepEqual((await fs.readdir(root)).sort(), ['2026-01_学习日志.md', 'prompts']);
});
