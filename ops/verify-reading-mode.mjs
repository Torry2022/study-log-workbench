// Run after the Web production build. Uses a fresh synthetic instance, no model requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, '.local', `reading-mode-${Date.now()}`);
const data = path.join(root, 'data');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(path.join(root, 'backups'));
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
await fs.writeFile(path.join(data, '2026-10_学习日志.md'), ['## 2026-10-22', '### 开头', ...Array(20).fill('合成阅读材料。'), '### 位置检查', ...Array(40).fill('继续阅读同一段材料，检查模式往返的位置。')].join('\n\n'));
const { chromium, webkit, expect } = createRequire(new URL('../study-log-web/package.json', import.meta.url))('@playwright/test');
const port = await new Promise(resolve => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const password = crypto.randomUUID();
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...safe, LOG_ROOT: data, BACKUP_ROOT: path.join(root, 'backups'), APP_PASSWORD: password, SESSION_SECRET: crypto.randomUUID(), COOKIE_SECURE: 'false', CHAT_API_KEY: '' }
});
let serverLog = '';
server.stdout.on('data', chunk => serverLog += chunk);
server.stderr.on('data', chunk => serverLog += chunk);
const base = `http://127.0.0.1:${port}/study-log`;
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) break;
    ready = await fetch(base).then(response => response.ok).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, serverLog);
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await launcher.launch();
    try {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: theme });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(theme => localStorage.setItem('study-log-theme', theme), theme);
        await page.goto(base);
        await page.getByLabel('访问密码').fill(password);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.getByRole('button', { name: '进入阅读模式', exact: true }).waitFor();
        await expect.poll(() => page.locator('html').getAttribute('data-workspace-transition')).toBeNull();
        await page.locator('.outline-item').filter({ hasText: '位置检查' }).click();
        const offset = () => page.evaluate(() => document.querySelector('#位置检查').getBoundingClientRect().top - document.querySelector('.reader-toolbar').getBoundingClientRect().bottom);
        await page.waitForTimeout(300);
        const before = await offset();
        await page.evaluate(() => {
          window.readingFrames = [];
          const start = document.startViewTransition?.bind(document);
          if (start) document.startViewTransition = update => {
            const reading = document.documentElement.classList.contains('reading-mode-transition');
            const transition = start(update);
            if (reading) void transition.ready.then(() => {
              const old = getComputedStyle(document.documentElement, '::view-transition-old(root)');
              const fresh = getComputedStyle(document.documentElement, '::view-transition-new(root)');
              window.readingFrames.push({ display: old.display, old: old.animationName, fresh: fresh.animationName });
            });
            return transition;
          };
        });
        for (let round = 0; round < 2; round++) {
          for (const label of ['进入阅读模式', '退出阅读']) {
            await page.getByRole('button', { name: label, exact: true }).click();
            await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('reading-mode-transition'))).toBe(false);
            assert.ok(Math.abs(await offset() - before) <= 4, `${engine}/${theme}/${label}: reading position moved`);
          }
        }
        const frames = await page.evaluate(() => window.readingFrames);
        if (engine === 'chromium') {
          assert.equal(frames.length, 4);
          for (const frame of frames) { assert.notEqual(frame.display, 'none'); assert.equal(frame.old, 'reading-mode-view-out'); assert.equal(frame.fresh, 'reading-mode-view-in'); }
        }
        assert.deepEqual(errors, []);
        results.push({ engine, theme, switches: 4, nativeCrossfade: engine === 'chromium', readingPositionPreserved: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ root, results, passed: true }));
} finally {
  server.kill();
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  await fs.writeFile(path.join(root, 'server.log'), serverLog);
}
