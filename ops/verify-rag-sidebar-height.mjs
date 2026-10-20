import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { initialize } from './instance.mjs';
import { createRagSession } from '../study-log-web/lib/rag-sessions-store.ts';

const repo = path.resolve(import.meta.dirname, '..'), root = path.join(repo, '.local', `rag-sidebar-height-${Date.now()}`), instance = path.join(root, 'instance');
await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.LOG_ROOT = path.join(instance, 'data'); process.env.BACKUP_ROOT = path.join(instance, 'backups');
const sessions = {};
for (const [name, count] of [['short', 1], ['long', 80]]) {
  const session = await createRagSession({ id: randomUUID(), mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only',
    messages: [{ id: randomUUID(), role: 'user', content: '合成布局问题', status: 'complete' },
      { id: randomUUID(), role: 'assistant', content: Array.from({ length: count }, (_, i) => `合成第${i}段：${'用于检查阅读布局。'.repeat(8)}`).join('\n\n'), status: 'complete', citations: [] }] });
  sessions[name] = session.id;
}
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const safe = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(name)));
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...environment, LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT, CHAT_API_KEY: '', CHAT_LIGHT_API_KEY: '' } });
let log = '', browser, page; web.stdout.on('data', value => log += value); web.stderr.on('data', value => log += value);
const { chromium, webkit, expect } = createRequire(new URL('../study-log-web/package.json', import.meta.url))('@playwright/test');
const base = `http://127.0.0.1:${port}/study-log`, report = { root, checks: [], samples: [], errors: [], paidCalls: 0 };
try {
  await expect.poll(() => fetch(base).then(response => response.ok).catch(() => false), { timeout: 30000 }).toBe(true);
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    browser = await launcher.launch();
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme }); page = await context.newPage();
      await page.addInitScript(theme => localStorage.setItem('study-log-theme', theme), theme);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.locator('.workspace')).toBeVisible();
      // This fixture has no active streams; finish initial reads before replacing the document.
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const name of ['empty', 'short', 'long']) {
        await page.goto(`${base}?view=qa${sessions[name] ? `&session=${sessions[name]}` : ''}`);
        const sidebar = page.locator('.qa-sidebar'); await expect(sidebar).toBeVisible();
        if (sessions[name]) await expect(page.locator('.rag-answer')).toContainText('合成第0段');
        for (const collapsed of [false, true]) {
          const isCollapsed = await sidebar.evaluate(element => element.classList.contains('collapsed'));
          if (collapsed !== isCollapsed) await sidebar.getByRole('button', { name: collapsed ? '折叠左侧栏' : '展开左侧栏', exact: true }).click();
          for (const [width, height] of [[1280, 800], [1100, 720], [1600, 980]]) {
            await page.setViewportSize({ width, height });
            for (const position of ['top', 'middle', 'bottom', 'top']) {
              await page.evaluate(position => window.scrollTo(0, position === 'top' ? 0 : position === 'bottom' ? document.documentElement.scrollHeight : document.documentElement.scrollHeight / 2), position);
              await page.waitForTimeout(220);
              const sample = await sidebar.evaluate(element => {
                const rect = element.getBoundingClientRect(), topbar = document.querySelector('.topbar').getBoundingClientRect();
                const bottomOwner = document.elementFromPoint(rect.left + rect.width / 2, innerHeight - 2);
                return { y: scrollY, top: rect.top, bottom: rect.bottom, viewport: innerHeight, topbarBottom: topbar.bottom, bottomOwned: Boolean(bottomOwner?.closest('.qa-sidebar')) };
              });
              report.samples.push({ engine, theme, name, collapsed, width, height, position, ...sample });
              assert.ok(sample.bottom >= height - 1 && sample.bottomOwned, JSON.stringify(report.samples.at(-1)));
              if (name === 'long' && !collapsed && width === 1280 && position === 'middle') await page.screenshot({ path: path.join(root, `${engine}-${theme}-long-middle.png`) });
            }
          }
          report.checks.push({ engine, theme, name, collapsed });
        }
      }
      await page.screenshot({ path: path.join(root, `${engine}-${theme}.png`) }); await context.close();
    }
    await browser.close(); browser = null;
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack; await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error; }
finally { await browser?.close(); web.kill(); if (web.exitCode === null) await new Promise(resolve => web.once('exit', resolve)); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), log); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length })); }
