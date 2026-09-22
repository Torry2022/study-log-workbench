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
import * as highlighting from '../lib/ai-highlighting.ts';
import * as chat from '../lib/ai-chat.ts';
import * as config from '../lib/ai-config.ts';
import * as prompts from '../lib/ai-prompts.ts';
const require = createRequire(import.meta.url), next = require('next/server');

test('actual highlight route authenticates before reading, returns review-only changes, bounds input and sanitizes failures', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-highlight-route-'));
  const previous = Object.fromEntries(['LOG_ROOT', 'CHAT_API_KEY', 'CHAT_API_URL', 'CHAT_MODEL'].map(key => [key, process.env[key]]));
  let calls = 0, mode = 'ok', started;
  const app = http.createServer(async (req, res) => {
    calls++; for await (const _ of req) { /* synthetic request only */ }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'stall') { res.write('{'); started(); return; }
    if (mode === '429') { res.statusCode = 429; return res.end('sensitive-provider-body'); }
    if (mode === '500') { res.statusCode = 500; return res.end('sensitive-provider-body'); }
    const content = mode === 'invalid' ? 'sensitive-provider-body' : JSON.stringify({ highlights: mode === 'none' ? [] : [{ startTokenId: 'S1T1', endTokenId: 'S1T1' }] });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { LOG_ROOT: root, CHAT_API_KEY: 'synthetic-highlight-sensitive-key', CHAT_API_URL: `http://127.0.0.1:${app.address().port}/chat`, CHAT_MODEL: 'fixture-highlight-model' });
  t.after(async () => {
    app.closeAllConnections(); await new Promise(resolve => app.close(resolve));
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('workbench-highlight-route-')); await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'prompts')); await fs.writeFile(path.join(root, 'prompts/highlighting.md'), '合成标注偏好');
  const stored = '## 2026-01-15\n\n原文只读。\n';
  const sourcePath = path.join(root, '2026-01_学习日志.md'); await fs.writeFile(sourcePath, stored);
  const before = (await fs.stat(sourcePath)).mtimeMs;
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
  const route = await load('../app/api/ai/bold-highlights/route.ts', { '@/lib/auth': auth, '@/lib/ai-chat': chat, '@/lib/ai-config': config, '@/lib/ai-prompts': prompts, '@/lib/ai-highlighting': highlighting });
  assert.equal((await route.POST({ cookies: new Map(), headers: new Headers(), get body() { assert.fail('unauthenticated body read'); } })).status, 401);
  assert.equal(calls, 0);
  const valid = { date: '2026-01-15', content: '### Header\n\nAlpha content. **Existing**' };
  const request = (value = valid, options = {}) => new next.NextRequest('http://localhost/study-log/api/ai/bold-highlights', {
    method: 'POST', body: typeof value === 'string' ? value : JSON.stringify(value), ...options,
    headers: { cookie: `study_log_session=${auth.createSessionToken()}`, ...options.headers }
  });
  for (const headers of [{}, { authorization: `Bearer ${auth.createAppToken().token}`, cookie: '' }]) {
    const response = await route.POST(request(valid, { headers }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { result: { content: valid.content.replace('Alpha', '**Alpha**'), model: 'fixture-highlight-model', boldCount: 1, warnings: [] } });
  }
  const beforeInvalid = calls;
  for (const input of ['{bad', null, [], {}, { ...valid, content: 42 }, { ...valid, date: '2026-02-30' }, { ...valid, content: 'x'.repeat(60001) }]) assert.equal((await route.POST(request(input))).status, 400);
  assert.equal((await route.POST(request(' '.repeat(400001)))).status, 413);
  const abort = new AbortController(); abort.abort();
  assert.equal((await route.POST(request(valid, { signal: abort.signal }))).status, 499);
  assert.equal(calls, beforeInvalid);
  mode = 'stall'; const underway = new Promise(resolve => { started = resolve; }); const during = new AbortController();
  const pending = route.POST(request(valid, { signal: during.signal })); await underway; during.abort();
  const cancelled = await pending; assert.equal(cancelled.status, 499); assert.equal((await cancelled.json()).error, '已取消标注');
  for (const [behavior, status, code] of [['429', 429, 'AI_RATE_LIMITED'], ['500', 502, 'AI_PROVIDER_FAILED'], ['invalid', 502, 'AI_INVALID_HIGHLIGHTS']]) {
    mode = behavior; const response = await route.POST(request()); assert.equal(response.status, status);
    const text = await response.text(); assert.equal(JSON.parse(text).code, code); assert.doesNotMatch(text, /sensitive-provider|synthetic-highlight|127\.0\.0\.1/);
  }
  mode = 'none'; const unchanged = (await (await route.POST(request())).json()).result;
  assert.equal(unchanged.content, valid.content); assert.equal(unchanged.boldCount, 0); assert.ok(unchanged.warnings.length);
  delete process.env.CHAT_API_KEY; assert.equal((await route.POST(request())).status, 503);
  process.env.CHAT_API_KEY = 'synthetic-highlight-sensitive-key';
  await fs.unlink(path.join(root, 'prompts/highlighting.md')); assert.equal((await route.POST(request())).status, 503);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), stored); assert.equal((await fs.stat(sourcePath)).mtimeMs, before);
  assert.deepEqual((await fs.readdir(root)).sort(), ['2026-01_学习日志.md', 'prompts']);
});
