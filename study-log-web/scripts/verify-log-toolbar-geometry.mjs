import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';

const webRoot = path.resolve(import.meta.dirname, '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-geometry-'));
await fs.writeFile(path.join(root, '2026-10_学习日志.md'), `## 2026-10-09\n\n### 合成内容\n\n${'合成记录用于布局检查。\n\n'.repeat(120)}`);
const port = 34732;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: webRoot, windowsHide: true, stdio: 'ignore', env: { ...process.env, LOG_ROOT: root, APP_PASSWORD: 'synthetic-navigation-password', SESSION_SECRET: 'synthetic-navigation-session-secret', COOKIE_SECURE: 'false', CHAT_API_KEY: '', STUDY_LOG_MCP_URL: 'http://127.0.0.1:1/mcp' } });
try {
  for (let i = 0; i < 120; i++) { if (await fetch(`http://127.0.0.1:${port}/study-log/`).then(r => r.ok).catch(() => false)) break; if (i === 119) throw Error('Synthetic server failed to start'); await new Promise(resolve => setTimeout(resolve, 200)); }
  for (const [name, engine] of (process.env.GEOMETRY_WEBKIT_ONLY ? [['webkit', webkit]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`http://127.0.0.1:${port}/study-log/?date=2026-10-09`);
      await page.getByLabel('访问密码').fill('synthetic-navigation-password'); await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.locator('.markdown-preview').waitFor();
      for (const zoom of [1, 1.25, 1.5]) {
        await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
        for (const width of [1100, 1440, 1920]) {
          await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(450);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
          await page.locator('.compact-day-navigator.visible').waitFor({ state: 'visible', timeout: 5000 });
          const result = await page.evaluate(() => {
            const side = document.querySelector('.sidebar').getBoundingClientRect();
            const nav = document.querySelector('.compact-day-navigator.visible')?.getBoundingClientRect();
            const controls = document.querySelector('.reader-log-controls'); const rect = controls.getBoundingClientRect();
            const scale = controls.offsetWidth ? rect.width / controls.offsetWidth : 1;
            const measure = () => { const groups = [...controls.children].filter(item => item.getClientRects().length); const gap = (parseFloat(getComputedStyle(controls).columnGap) || 0) * scale; return groups.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) + gap * Math.max(0, groups.length - 1); };
            const layout = controls.dataset.toolbarLayout || '', required = measure();
            const steps = layout.split(' ').filter(Boolean); let previous = null;
            if (steps.length) { controls.dataset.toolbarLayout = steps.slice(0, -1).join(' '); previous = measure(); controls.dataset.toolbarLayout = layout; }
            return { scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight, marker: document.querySelector('.sidebar-days-end-marker')?.getBoundingClientRect().top, side: { left: side.left, right: side.right }, nav: nav && { left: nav.left, right: nav.right }, available: rect.width, required, previous, layout };
          });
          assert.ok(result.nav && result.nav.left >= result.side.left - 1 && result.nav.right <= result.side.right + 1, `${name} zoom=${zoom} width=${width}: ${JSON.stringify(result)}`);
          assert.ok(result.required <= result.available + 1, `${name} toolbar overflows: ${JSON.stringify(result)}`);
          if (result.previous !== null) assert.ok(result.previous > result.available, `${name} toolbar shrank too early: ${JSON.stringify(result)}`);
          if (width === 1920 && zoom === 1.25) assert.ok(!result.layout.includes('compact-mode'), `${name} unnecessarily hides all labels: ${JSON.stringify(result)}`);
        }
      }
      await page.evaluate(() => { document.documentElement.style.zoom = '1'; window.scrollTo(0, 0); });
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const label of ['折叠日志导航', '展开日志导航']) { await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(300); }
      await page.getByRole('button', { name: '展开右侧栏', exact: true }).click(); await page.waitForTimeout(300);
      for (const scroll of [0, 1000]) {
        await page.evaluate(value => window.scrollTo(0, value), scroll); await page.waitForTimeout(250);
        const lines = await page.evaluate(() => ({ toolbar: document.querySelector('.reader-toolbar-log').getBoundingClientRect().bottom, inspector: document.querySelector('.writing-inspector-heading').getBoundingClientRect().bottom }));
        assert.ok(Math.abs(lines.toolbar - lines.inspector) <= 2, `${name} right sidebar line mismatch: ${JSON.stringify(lines)}`);
      }
      await page.getByRole('button', { name: '折叠右侧栏', exact: true }).click(); await page.waitForTimeout(300);
      for (const label of ['源码', '分屏', '浏览']) { await page.getByRole('group', { name: '工作区模式' }).getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(300); }
      console.log(`${name} geometry passed`);
    } finally { await browser.close(); }
  }
} finally { child.kill(); }
