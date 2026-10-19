import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { initialize } from './instance.mjs';
import { RagTaskStore } from '../study-log-web/lib/rag-task-store.ts';
import { createRagSession, getRagSession } from '../study-log-web/lib/rag-sessions-store.ts';

// Layout and pointer-hit testing against the production entry point. A fixture
// owner holds execution; this script never configures or calls a real model.
const repo = path.resolve(import.meta.dirname, '..'), root = path.join(repo, '.local', `rag-composer-clearance-${Date.now()}`), instance = path.join(root, 'instance');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const env = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.LOG_ROOT = path.join(instance, 'data'); process.env.BACKUP_ROOT = path.join(instance, 'backups');
const store = new RagTaskStore(process.env.LOG_ROOT), owner = `${process.pid}:layout-fixture`;
store.leader(owner); const heartbeat = setInterval(() => store.leader(owner), 500);
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, report = { root, checks: [], screenshots: [], paidModelCalls: 0 };
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...env, LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT, NODE_ENV: 'production', CHAT_API_URL: 'http://127.0.0.1:1/chat', CHAT_API_KEY: 'synthetic-layout-key', CHAT_MODEL: 'synthetic-layout-model', RAG_AGENT_ENABLED: 'false' } });
web.stdout.on('data', bytes => { void fs.appendFile(path.join(root, 'web.log'), bytes); }); web.stderr.on('data', bytes => { void fs.appendFile(path.join(root, 'web.log'), bytes); });
const { chromium, webkit, expect } = createRequire(path.join(repo, 'study-log-web/package.json'))('@playwright/test');
let browser;
try {
  let ready = false; for (let i = 0; i < 200; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) { ready = true; break; } await new Promise(resolve => setTimeout(resolve, 100)); } assert.ok(ready);
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    browser = await launcher.launch();
    for (const mobile of [false, true]) for (const theme of ['light', 'dark']) {
      const id = randomUUID(), name = `${engine}-${mobile ? 'mobile' : 'desktop'}-${theme}`;
      const saved = await createRagSession({ id, mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [
        { id: randomUUID(), role: 'user', content: '合成历史问题', status: 'complete' },
        { id: randomUUID(), role: 'assistant', content: Array.from({ length: 30 }, (_, n) => `合成历史段落 ${n + 1}：保留已保存的内容。`).join('\n\n'), status: 'complete' } ] });
      const task = store.create({ submissionId: randomUUID(), sessionId: id, baseVersion: saved.version, question: '合成后续问题', mode: 'logs_only', history: [] });
      const claimed = store.claim(owner); assert.equal(claimed.id, task.id); store.progress(claimed, '合成生成片段', '正在生成合成回答');
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, colorScheme: theme });
      await context.addInitScript(value => localStorage.setItem('study-log-theme', value), theme);
      const page = await context.newPage(); await page.goto(base); await page.getByLabel('访问密码').fill(env.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.locator('.workspace')).toBeVisible(); await page.goto(`${base}?view=qa&session=${id}`);
      const stop = page.getByRole('button', { name: '停止生成', exact: true }); await expect(stop).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const back = page.locator('.back-to-top-control.is-visible'); await expect(back).toBeVisible(); await back.hover();
      await expect.poll(async () => { const floating = await back.boundingBox(), composer = await page.locator('.rag-composer').boundingBox(); return !!floating && !!composer && floating.y + floating.height <= composer.y + 1; }).toBe(true);
      assert.equal(await stop.evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === node; }), true);
      const screenshot = path.join(root, name + '.png'); await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot);
      await stop.click(); await expect.poll(() => store.get(task.id).state).toBe('cancelled');
      assert.equal((await getRagSession(id)).messages.length, 2); store.release(task.id);
      report.checks.push(name); console.log('PASS ' + name); await context.close();
    }
    await browser.close(); browser = undefined;
  }
  report.passed = true;
} finally {
  await browser?.close(); clearInterval(heartbeat); store.close();
  if (web.exitCode === null && web.signalCode === null) { const ended = once(web, 'close'); web.kill(); await ended; }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(root);
}
