import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initialize } from './instance.mjs';
import { startHttpServer } from '../study-log-mcp/src/http-server.mjs';

const repo = path.resolve(import.meta.dirname, '..'), root = path.join(repo, '.local', `rag-stream-boundaries-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const { chromium, webkit, expect } = createRequire(new URL('../study-log-web/package.json', import.meta.url))('@playwright/test');
const report = { checks: [], requests: [], paidCalls: 0, root };
const mark = text => { report.checks.push(text); console.log('PASS ' + text); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept) { const start = Date.now(); for (;;) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > 30000) throw Error('Timed out: ' + JSON.stringify(value)); await pause(50); } }
const source = '## 2026-09-01\n\n### 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const safe = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(key)));
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const services = [], pending = new Map(), counts = { A: 0, B: 0 }; let browser;
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const b of req) raw += b;
    const input = JSON.parse(raw), name = req.url.split('/')[1];
    if (!input.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: input.messages?.[0]?.content?.includes('短语式标题') ? '合成边界' : JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }] })); return; }
    counts[name]++; pending.set(name, res); res.setHeader('content-type', 'text/event-stream');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: `实例${name}已接收的合成正文。`.repeat(60) }, finish_reason: null }] }) + '\n\n');
    res.once('close', () => pending.delete(name));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  try {
    for (const name of ['A', 'B']) {
      const instance = path.join(root, engine, name); await initialize(instance);
      const env = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
      const data = path.join(instance, 'data'); await fs.writeFile(path.join(data, '2026-09_学习日志.md'), source);
      const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-boundary-mcp', retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
      const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
      let log = '';
      const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
        cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...env, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
          CHAT_API_URL: `http://127.0.0.1:${model.address().port}/${name}/chat`, CHAT_API_KEY: 'synthetic-boundary-key', CHAT_MODEL: 'synthetic-boundary-model', CHAT_LIGHT_MODEL: 'synthetic-boundary-model',
          STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-boundary-mcp', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' }
      }); child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
      const service = { name, instance, child, mcp, base: `http://127.0.0.1:${port}/study-log`, password: env.APP_PASSWORD, log: () => log }; services.push(service);
      await until(() => fetch(service.base).then(r => r.ok).catch(() => false), Boolean);
    }
    browser = await launcher.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      window.boundaryFrames = []; const sample = () => {
        const qa = document.querySelector('.rag-workspace'), text = qa?.getClientRects().length ? qa.querySelector('.rag-answer .markdown-preview')?.textContent : '';
        if (text) window.boundaryFrames.push(text); if (window.boundaryFrames.length < 40) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    const page = await context.newPage(), watches = new Set(), errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { const url = new URL(req.url()); if (url.pathname.includes('/api/rag/')) report.requests.push({ engine, url: req.url(), method: req.method(), instance: req.headers()['x-study-log-instance'] }); if (url.pathname.endsWith('/events')) watches.add(req); });
    page.on('requestfinished', req => watches.delete(req)); page.on('requestfailed', req => watches.delete(req));
    for (const [index, service] of [services[0], services[1], services[0]].entries()) {
      await page.goto(service.base + (service.sessionId ? `?view=qa&session=${service.sessionId}` : '?view=qa'));
      await page.getByLabel('访问密码').fill(service.password); await page.getByRole('button', { name: '登录', exact: true }).click();
      const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true }); await expect(input).toBeEnabled();
      const capabilityResponse = await page.request.get(service.base + '/api/capabilities');
      assert.equal(capabilityResponse.status(), 200);
      const capability = await capabilityResponse.json();
      service.instanceId = capability.instanceId;
      assert.match(service.instanceId, /^[a-f0-9-]{36}$/);
      if (!service.sessionId) {
        await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).first().click();
        await input.fill('合成保存的实例边界'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
        await until(() => counts[service.name], n => n === 1); service.sessionId = new URL(page.url()).searchParams.get('session');
      }
      await expect(page.locator('.rag-workspace .rag-answer')).toContainText(`实例${service.name}已接收`);
      await until(() => watches.size, n => n === 1);
      if (index === 0) {
        const eventUrl = report.requests.filter(req => req.engine === engine && new URL(req.url).pathname.endsWith('/events')).at(-1).url;
        const cookie = (await context.cookies()).map(item => `${item.name}=${item.value}`).join('; '), before = { ...counts };
        const checkEvent = async (identity, headers = {}) => {
          const url = new URL(eventUrl); url.searchParams.delete('instance');
          if (identity !== null) url.searchParams.set('instance', identity);
          const response = await fetch(url, { headers });
          const status = response.status; await response.body?.cancel(); return status;
        };
        assert.equal(await checkEvent(service.instanceId), 401);
        assert.equal(await checkEvent(randomUUID(), { Cookie: cookie }), 409);
        assert.equal(await checkEvent('', { Cookie: cookie }), 409);
        assert.equal(await checkEvent('invalid-instance', { Cookie: cookie }), 409);
        assert.equal(await checkEvent(randomUUID(), { Cookie: cookie, 'X-Study-Log-Instance': service.instanceId }), 409);
        assert.equal(await checkEvent(null, { Cookie: cookie, 'X-Study-Log-Instance': service.instanceId }), 200);
        assert.deepEqual(counts, before);
        mark(`${engine}: event cookie auth, query instance mismatch, conflicting identities and legacy header binding`);
      }
      assert.ok(report.requests.filter(req => req.engine === engine && req.url.startsWith(service.base) && new URL(req.url).pathname.endsWith('/events'))
        .every(req => new URL(req.url).searchParams.get('instance') === service.instanceId));
      if (index > 0) assert.notEqual(services[0].instanceId, services[1].instanceId);
      assert.equal((await page.locator('.rag-answer').textContent()).includes(`实例${service.name === 'A' ? 'B' : 'A'}已接收`), false);
      if (index === 2) {
        await expect(page.locator('.rag-answer')).toContainText('注销后A新增内容');
        const frames = await page.evaluate(() => window.boundaryFrames); assert.ok(frames.filter(Boolean).every(text => text.includes('注销后A新增内容')));
        assert.deepEqual(counts, { A: 1, B: 1 });
      }
      mark(`${engine}: visit ${index + 1} uses only instance ${service.name}; recovery never resubmits or replays a display queue`);
      await page.getByRole('button', { name: '退出', exact: true }).click(); await expect(page.getByLabel('访问密码')).toBeVisible(); await expect(page.locator('.workspace')).toHaveCount(0);
      await until(() => watches.size, n => n === 0); assert.ok(pending.has(service.name));
      if (index === 0) pending.get('A').write('data: ' + JSON.stringify({ choices: [{ delta: { content: '注销后A新增内容' }, finish_reason: null }] }) + '\n\n');
      await pause(300); assert.equal((await page.locator('body').textContent()).includes('实例A已接收'), false);
      mark(`${engine}: logout aborts viewing, clears presentation and leaves the server task running`);
    }
    for (const service of services) {
      pending.get(service.name).end('data: ' + JSON.stringify({ choices: [{ delta: { content: '，保存完成。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } }) + '\n\ndata: [DONE]\n\n');
      await until(async () => JSON.parse(await fs.readFile(path.join(service.instance, 'data/state/rag-sessions.json'), 'utf8')).sessions, sessions => sessions.length === 1 && sessions[0].messages.length === 2);
      assert.equal(await fs.readFile(path.join(service.instance, 'data/2026-09_学习日志.md'), 'utf8'), source);
    }
    assert.equal(report.requests.some(req => req.engine === engine && req.url.endsWith('/cancel')), false);
    assert.deepEqual(errors, []); mark(`${engine}: both background answers save one pair without cancellation, duplicate generation or source changes`);
  } catch (error) { report.failure = error.stack; throw error; }
  finally { await browser?.close(); for (const res of pending.values()) res.destroy(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); for (const service of services) { service.child.kill(); if (service.child.exitCode === null) await new Promise(resolve => service.child.once('exit', resolve)); await service.mcp.close(); await fs.writeFile(path.join(root, engine + '-' + service.name + '.log'), service.log()); } await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(root); }
}
