// Client lifecycle checks against a production app and real session storage.
// Every run owns a new synthetic root; query streams use only a loopback fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, '.local', `rag-lifecycle-${Date.now()}`);
const data = path.join(root, 'data'); await fs.mkdir(data, { recursive: true });
await fs.mkdir(path.join(root, 'backups'));
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
await fs.writeFile(path.join(data, '2026-09_学习日志.md'), '## 2026-09-01\n\n### 合成材料\n\n用于客户端生命周期检查。');
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(3397, '127.0.0.1', () => probe.close(resolve));
});
const packet = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const pending = new Map(); let mode = 'hold';
const fixture = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3397');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const { question } = JSON.parse(raw); assert.ok(question.startsWith('生命周期合成'));
  res.setHeader('content-type', 'text/event-stream');
  res.write(packet('delta', { text: `片段：${question}` }));
  const finish = () => { if (!res.destroyed) res.end(packet('done', { answer: `完成：${question}`, citations: [] })); };
  if (mode === 'eof') res.end();
  else if (mode === 'done') finish();
  else pending.set(question, { finish, closed: false });
  res.once('close', () => { const item = pending.get(question); if (item) item.closed = true; });
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const safe = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3397'], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...safe, LOG_ROOT: data, BACKUP_ROOT: path.join(root, 'backups'), APP_PASSWORD: 'synthetic-lifecycle-password', SESSION_SECRET: 'synthetic-lifecycle-session-secret-20261015', COOKIE_SECURE: 'false', CHAT_API_KEY: '', CHAT_LIGHT_API_KEY: '' } });
let serverLog = ''; server.stdout.on('data', x => serverLog += x); server.stderr.on('data', x => serverLog += x);
const base = 'http://127.0.0.1:3397/study-log', results = [];
const retryOnly = process.argv.includes('--retry-only');
try {
  let ready = false;
  for (let i = 0; i < 120; i++) { if (server.exitCode !== null) break; ready = await fetch(base).then(r => r.ok).catch(() => false); if (ready) break; await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.ok(ready, serverLog);
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await launcher.launch();
    let page;
    try {
      page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(10000); page.on('dialog', dialog => dialog.accept());
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const main = page.locator('.rag-workspace').filter({ visible: true });
      const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
      const login = async () => { await page.getByLabel('访问密码').fill('synthetic-lifecycle-password'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.locator('.workspace')).toBeVisible(); };
      const seed = async label => {
        const id = crypto.randomUUID();
        const response = await page.request.post(`${base}/api/rag/sessions`, { data: { id, mutationId: crypto.randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [{ id: crypto.randomUUID(), role: 'user', content: `${engine}已存${label}`, status: 'complete' }, { id: crypto.randomUUID(), role: 'assistant', content: `既有答${label}`, status: 'complete', citations: [] }] } });
        assert.equal(response.status(), 200); return (await response.json()).session;
      };
      const open = async session => { await page.locator('.rag-session-main').filter({ hasText: session.title }).click(); await expect(page).toHaveURL(new RegExp(`session=${session.id}`)); };
      const fresh = async () => { await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).click(); await expect(main.locator('.rag-message')).toHaveCount(0); };
      const send = async suffix => { const question = `生命周期合成${engine}${suffix}`; await input.fill(question); await page.getByRole('button', { name: '发送问题', exact: true }).click(); await expect(main).toContainText(`片段：${question}`); return { question, id: new URL(page.url()).searchParams.get('session') }; };
      const stored = async id => { const response = await page.request.get(`${base}/api/rag/sessions/${id}`); return response.ok() ? (await response.json()).session : null; };
      await page.route('**/api/capabilities', async route => { const response = await route.fetch(), body = await response.json(); if (response.ok()) body.features.rag = { supported: true, configured: true }; await route.fulfill({ response, json: body }); });
      await page.route('**/api/rag/query', route => route.continue({ url: `http://127.0.0.1:${fixture.address().port}/query` }));
      await page.route('**/api/rag/sessions/*/title', async route => { const response = await page.request.get(route.request().url().replace(/\/title$/, '')); await route.fulfill({ response }); });
      await page.goto(base); await login();
      const a = await seed('A'), b = await seed('B');
      await page.getByRole('button', { name: '问答', exact: true }).filter({ visible: true }).click();
      await open(b); await expect(main).toContainText('既有答B');
      let fail = true;
      const reads = [];
      await page.route(/\/api\/rag\/sessions\/[a-f0-9-]+$/, async route => {
        if (route.request().method() === 'GET') {
          reads.push(route.request().url().split('/').at(-1));
          if (route.request().url().endsWith(a.id) && fail) { await route.fulfill({ status: 503, json: { error: '合成目标会话加载失败' } }); return; }
        }
        await route.continue();
      });
      await input.fill('生命周期合成保留B草稿');
      await open(a); await expect(main.getByRole('alert')).toContainText('合成目标会话加载失败');
      fail = false; reads.length = 0;
      await main.getByRole('button', { name: '重新读取', exact: true }).click();
      const confirmation = page.getByRole('alertdialog');
      await expect(confirmation).toHaveCount(0);
      await expect(main).toContainText('既有答A'); assert.deepEqual(reads, [a.id]);
      await open(b); await expect(input).toHaveValue('生命周期合成保留B草稿');
      await expect(main.getByRole('alert')).toHaveCount(0); await input.fill('');
      results.push({ engine, retryTargetAndPreviousDraft: true });
      if (!retryOnly) {
        mode = 'hold'; const runningPrevious = await send('重试期间后台B');
        fail = true; await open(a); await expect(main.getByRole('alert')).toContainText('合成目标会话加载失败');
        fail = false;
        await main.getByRole('button', { name: '重新读取', exact: true }).click();
        await expect(main).toContainText('既有答A');
        await expect(page.getByRole('status', { name: '正在生成', exact: true })).toHaveCount(1);
        pending.get(runningPrevious.question).finish();
        await expect.poll(async () => (await stored(b.id))?.messages.at(-1)?.content).toBe(`完成：${runningPrevious.question}`);
        await open(b); await expect(main).toContainText(`完成：${runningPrevious.question}`);
        results.push({ engine, retryWhilePreviousRuns: true });
        const completedPrevious = await send('后台完成不改失败目标');
        fail = true; await open(a); await expect(main.getByRole('alert')).toContainText('合成目标会话加载失败');
        pending.get(completedPrevious.question).finish();
        await expect.poll(async () => (await stored(b.id))?.messages.at(-1)?.content).toBe(`完成：${completedPrevious.question}`);
        await expect(main.getByRole('button', { name: '重新生成', exact: true }).last()).toBeEnabled();
        await expect(page).toHaveURL(new RegExp(`session=${a.id}`));
        await expect(main.getByRole('alert')).toContainText('合成目标会话加载失败');
        fail = false; await main.getByRole('button', { name: '重新读取', exact: true }).click();
        await expect(main).toContainText('既有答A');
        results.push({ engine, completionPreservesRequestedRoute: true });
        await fresh(); mode = 'hold'; const first = await send('后台A');
        await fresh(); const second = await send('停止B');
        await expect(page.getByRole('status', { name: '正在生成', exact: true })).toHaveCount(2);
        await page.getByRole('button', { name: '停止生成', exact: true }).click();
        await expect(main).toContainText('生成已停止');
        await expect(page.getByRole('status', { name: '正在生成', exact: true })).toHaveCount(1);
        await expect.poll(() => pending.get(second.question)?.closed).toBe(true);
        assert.equal(pending.get(first.question).closed, false);
        assert.equal(await stored(second.id), null);
        pending.get(first.question).finish();
        await expect.poll(async () => (await stored(first.id))?.messages.at(-1)?.status).toBe('complete');
        await expect(main).toContainText(`片段：${second.question}`); await expect(main).not.toContainText(`完成：${first.question}`);
        await expect(page.getByRole('status', { name: '新回答', exact: true })).toHaveCount(1);
        await expect(page.getByRole('status', { name: '正在生成', exact: true })).toHaveCount(0);
        results.push({ engine, backgroundOwner: true, stopOwnsRequest: true, partialNotSaved: true });
        await fresh(); mode = 'hold'; const third = await send('跨模块C');
        await page.getByRole('button', { name: '日志', exact: true }).filter({ visible: true }).first().click();
        pending.get(third.question).finish();
        await expect.poll(async () => (await stored(third.id))?.messages.at(-1)?.status).toBe('complete');
        await page.getByRole('button', { name: '问答', exact: true }).filter({ visible: true }).click();
        await expect(main).toContainText(`完成：${third.question}`);
        await fresh(); mode = 'eof'; const broken = await send('断流D');
        await expect(main).toContainText('回答连接提前结束'); assert.equal(await stored(broken.id), null);
        mode = 'done'; await main.getByRole('button', { name: '重试', exact: true }).click();
        await expect.poll(async () => (await stored(broken.id))?.messages.at(-1)?.status).toBe('complete');
        await page.reload(); await expect(main).toContainText(`完成：${broken.question}`);
        results.push({ engine, moduleCompletion: true, eofRetained: true, regenerateSaved: true, refreshSavedSession: true });
        await fresh(); mode = 'hold'; const auth = await send('认证中断E');
        await fresh();
        await input.fill('生命周期合成未发送草稿');
        await page.evaluate(() => window.dispatchEvent(new Event('study-log:auth-expired')));
        await login();
        await expect(input).toHaveValue('生命周期合成未发送草稿');
        await page.locator('.rag-session-main').filter({ hasText: auth.question }).click();
        await expect(main).toContainText('生成已停止');
        await expect(main).toContainText(`片段：${auth.question}`);
        await expect.poll(() => pending.get(auth.question)?.closed).toBe(true);
        assert.equal(await stored(auth.id), null);
        results.push({ engine, authCancelsStream: true, authRetainsDraftAndPartial: true });
      }
      await page.screenshot({ path: path.join(root, `${engine}-end.png`) }); assert.deepEqual(errors, []);
    } catch (error) { await page?.screenshot({ path: path.join(root, `${engine}-failure.png`) }).catch(() => {}); throw error; }
    finally { await page?.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close(); }
  }
  if (process.argv.includes('--legacy')) {
    await fs.writeFile(path.join(root, '.env'), 'APP_PASSWORD=synthetic-lifecycle-password\n');
    for (const engine of ['chromium', 'webkit']) {
      const result = await promisify(execFile)(process.execPath, [path.join(repo, 'ops/browser-rag.mjs'), root, base, engine], { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      await fs.writeFile(path.join(root, `legacy-${engine}.log`), result.stdout + result.stderr);
      console.log(`Legacy browser RAG passed: ${engine}`);
    }
  }
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ root, results }));
} finally {
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  await fs.writeFile(path.join(root, 'server.log'), serverLog);
}
