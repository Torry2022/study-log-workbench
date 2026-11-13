import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, expect } from '@playwright/test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(web, '..', '.local', `split-layout-${Date.now()}`);
const data = path.join(evidence, 'data');
await fs.mkdir(data, { recursive: true });
const day = (date, label) => `## ${date}\n\n### ${label}\n\n` + Array.from({ length: 140 }, (_, i) => `${label}第${i}段：${'用于验证分屏滚动和布局。'.repeat(5)}\n`).join('\n');
await fs.writeFile(path.join(data, '2026-07_学习日志.md'), `${day('2026-07-07', '第一天')}\n\n---\n\n${day('2026-07-08', '第二天')}`);
const socket = http.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const password = randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(key)));
Object.assign(env, { LOG_ROOT: data, BACKUP_ROOT: path.join(evidence, 'backup'), APP_PASSWORD: password, SESSION_SECRET: randomUUID(), COOKIE_SECURE: 'false', NODE_ENV: 'production', CHAT_API_KEY: '', STUDY_LOG_MCP_URL: 'http://127.0.0.1:1/mcp' });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: web, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', chunk => log += chunk); server.stderr.on('data', chunk => log += chunk);
const url = `http://127.0.0.1:${port}/study-log/`, checks = [];
try {
  for (let i = 0; ; i++) { try { if ((await fetch(url)).ok) break; } catch {} if (i > 150 || server.exitCode !== null) throw Error(log); await new Promise(resolve => setTimeout(resolve, 100)); }
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(url); await page.getByLabel('访问密码').fill(password); await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.locator('.reader .markdown-preview')).toBeVisible();
      await page.getByRole('button', { name: '分屏', exact: true }).click();
      const preview = page.locator('.mode-split > .reader-preview-pane'), editor = page.locator('.mode-split > .source-workspace'), scroller = editor.locator('.cm-scroller');
      await expect(preview).toBeVisible(); await expect(scroller).toBeVisible();
      const p = await preview.boundingBox(), e = await editor.boundingBox();
      assert.ok(p.x + p.width <= e.x + 1, `${name}: preview should be left of source`);
      assert.ok(Math.abs(p.x + p.width - e.x) <= 2, `${name}: split boundary must remain adjacent`);
      for (const [from, to] of [[preview, scroller], [scroller, preview]]) {
        await from.evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(100);
        await from.evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.65; });
        await expect.poll(() => to.evaluate(el => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeGreaterThan(0.55);
      }
      await page.screenshot({ path: path.join(evidence, `${name}-wide.png`) });
      await page.getByRole('button', { name: '浏览', exact: true }).click(); await expect(page.locator('.reader .markdown-preview')).toBeVisible();
      await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(page.locator('.source-workspace .cm-content')).toBeVisible();
      await page.getByRole('button', { name: '分屏', exact: true }).click(); await expect(preview).toBeVisible();
      const current = await page.locator('.reader-toolbar-log').innerText();
      const switcher = page.locator('.reader-navigator-desktop .day-nav-button:not([disabled])').first();
      await switcher.click(); await expect.poll(() => page.locator('.reader-toolbar-log').innerText()).not.toBe(current);
      assert.ok((await preview.boundingBox()).x < (await editor.boundingBox()).x);
      await page.setViewportSize({ width: 1100, height: 900 });
      await expect.poll(() => preview.evaluate(el => getComputedStyle(el).order)).toBe('2');
      assert.equal(await editor.evaluate(el => getComputedStyle(el).order), '1');
      await page.screenshot({ path: path.join(evidence, `${name}-narrow.png`) });
      checks.push(`${name}: wide layout, boundary, bidirectional scroll, mode/day change, narrow order`);
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ evidence, checks, passed: true }));
} finally { server.kill(); await fs.writeFile(path.join(evidence, 'server.log'), log); }
