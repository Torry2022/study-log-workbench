// Personal ab3e7b0 layout regressions, adapted to the public app and real session storage.
// Uses a fresh synthetic instance and no model requests. Run after the production build.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, '.local', `rag-layout-${Date.now()}`);
const data = path.join(root, 'data');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(path.join(root, 'backups'));
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
await fs.writeFile(path.join(data, '2026-09_学习日志.md'), '## 2026-09-01\n\n### 合成布局材料\n\n仅用于界面回归。');
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...safe, LOG_ROOT: data, BACKUP_ROOT: path.join(root, 'backups'), APP_PASSWORD: 'synthetic-layout-password',
    SESSION_SECRET: 'synthetic-layout-session-secret-20261015', COOKIE_SECURE: 'false', CHAT_API_KEY: '', CHAT_LIGHT_API_KEY: '' }
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
      for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 }, colorScheme: theme });
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(theme => localStorage.setItem('study-log-theme', theme), theme);
        page.on('request', request => {
          if (request.url().endsWith('/api/rag/query')) errors.push('Layout checks must not generate answers');
        });
        await page.goto(base);
        await page.getByLabel('访问密码').fill('synthetic-layout-password');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.locator('.workspace')).toBeVisible();
        // Let the log workspace finish its initial reads before a full-page history navigation.
        await page.waitForLoadState('networkidle');
        const id = crypto.randomUUID();
        const response = await page.request.post(`${base}/api/rag/sessions`, { data: {
          id, mutationId: crypto.randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [
            { id: crypto.randomUUID(), role: 'user', content: '合成长回答布局', status: 'complete' },
            { id: crypto.randomUUID(), role: 'assistant', status: 'complete',
              content: ['# 一级标题', '## 二级标题', '### 三级标题',
                ...Array.from({ length: 60 }, (_, index) => `段落${index + 1}：用于检查长正文、滚动位置及悬浮输入框。`), '正文末尾标记'].join('\n\n'),
              citations: [{ sourceId: 'S1', date: '2026-09-01', month: '2026-09', fileName: '2026-09_学习日志.md',
                heading: '合成布局材料', headingIndex: 0, chunkId: '2026-09-01:0:0', contentHash: 'synthetic-layout-content',
                excerpt: '来源展开时输入框应保持位置。'.repeat(25) }] }
          ]
        } });
        assert.equal(response.status(), 200, await response.text());
        await page.goto(`${base}?view=qa&session=${id}`);
        await expect(page.locator('.rag-answer h1')).toHaveText('一级标题');
        await page.evaluate(() => document.fonts.ready);
        const hierarchy = await page.locator('.rag-answer .markdown-preview').evaluate(element => ['h1', 'h2', 'h3'].map(tag => {
          const style = getComputedStyle(element.querySelector(tag));
          return { family: style.fontFamily, size: parseFloat(style.fontSize), weight: style.fontWeight };
        }));
        await page.screenshot({ path: path.join(root, `${engine}-${theme}-${width}-headings.png`) });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        const bottom = await page.evaluate(() => ({ scroll: scrollY, max: document.documentElement.scrollHeight - innerHeight,
          end: document.querySelector('.rag-answer .markdown-preview').lastElementChild.getBoundingClientRect().bottom,
          height: innerHeight, containment: getComputedStyle(document.querySelector('.view-qa .reader')).containerType }));
        const composer = page.locator('.rag-composer');
        const coordinate = () => composer.evaluate(element => element.getBoundingClientRect().top);
        const before = await coordinate();
        await page.locator('.rag-citation').click();
        await expect(page.locator('.rag-citation-detail')).toBeVisible();
        await page.waitForTimeout(300);
        const expanded = await coordinate();
        await page.screenshot({ path: path.join(root, `${engine}-${theme}-${width}-expanded.png`) });
        await page.locator('.rag-citation').click();
        await page.waitForTimeout(300);
        const sourceCollapsed = await page.locator('.rag-citation-detail').count() === 0;
        const collapsed = await coordinate();
        await page.screenshot({ path: path.join(root, `${engine}-${theme}-${width}-collapsed.png`) });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        const finalBottom = await page.evaluate(() => ({ scroll: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
        const checks = {
          headings: hierarchy.every((h, index) => h.family.includes('Cormorant Garamond') && h.weight === '500' && h.size === [32, 26, 21][index]),
          bottomReachable: Math.abs(bottom.scroll - bottom.max) <= 1 && bottom.end < bottom.height && bottom.scroll > 1000,
          noContainment: bottom.containment === 'normal',
          composerStable: Math.abs(expanded - before) <= 1 && Math.abs(collapsed - before) <= 1,
          sourceCollapsed,
          bottomAfterToggle: Math.abs(finalBottom.scroll - finalBottom.max) <= 1,
          noPageErrors: errors.length === 0
        };
        results.push({ engine, theme, width, checks, hierarchy, bottom, finalBottom, composer: { before, expanded, collapsed }, errors });
        console.log(JSON.stringify(results.at(-1)));
        await page.close();
      }
    } finally { await browser.close(); }
  }
  assert.ok(results.every(result => Object.values(result.checks).every(Boolean)), 'Layout regression failed; see results.json');
} finally {
  server.kill();
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  await fs.writeFile(path.join(root, 'server.log'), serverLog);
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Layout evidence: ${root}`);
}
