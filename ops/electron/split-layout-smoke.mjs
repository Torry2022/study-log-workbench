import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initialize } from '../instance.mjs';
import { workspacePage } from './workspace-test.mjs';

assert.ok(process.argv[2] && process.argv[3], 'Pass isolated unpacked EXE and new evidence directory');
const exe = path.resolve(process.argv[2]), root = path.resolve(process.argv[3]);
const instance = path.join(root, 'instance'), profile = path.join(root, 'profile');
await fs.mkdir(root); await initialize(instance); await fs.mkdir(profile);
await fs.writeFile(path.join(profile, 'desktop.json'), JSON.stringify({ mode: 'local', usageConfirmed: true, root: instance }));
const day = (date, label) => `## ${date}\n\n### ${label}\n\n` + Array.from({ length: 140 }, (_, i) => `${label}第${i}段：${'用于验证分屏滚动。'.repeat(5)}\n`).join('\n');
await fs.writeFile(path.join(instance, 'data', '2026-07_学习日志.md'), `${day('2026-07-07', '第一天')}\n\n---\n\n${day('2026-07-08', '第二天')}`);
const { _electron: electron, expect } = createRequire(new URL('../../study-log-web/package.json', import.meta.url))('@playwright/test');
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
let app, page; const report = { checks: [], errors: [], installed: false, paidCalls: 0 };
try {
  app = await electron.launch({ executablePath: exe, args: [], env, timeout: 60000 });
  page = await workspacePage(app); page.on('pageerror', error => report.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 900));
  await expect(page.locator('.reader .markdown-preview')).toBeVisible();
  await page.getByRole('button', { name: '分屏', exact: true }).click();
  const preview = page.locator('.mode-split > .reader-preview-pane'), editor = page.locator('.mode-split > .source-workspace'), scroll = editor.locator('.cm-scroller');
  await expect(preview).toBeVisible(); await expect(scroll).toBeVisible();
  const p = await preview.boundingBox(), e = await editor.boundingBox();
  assert.ok(Math.abs(p.x + p.width - e.x) <= 2, 'preview left, source right, boundary adjacent');
  for (const [from, to] of [[preview, scroll], [scroll, preview]]) {
    await from.evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(100);
    await from.evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.65; });
    await expect.poll(() => to.evaluate(el => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeGreaterThan(0.55);
  }
  await page.screenshot({ path: path.join(root, 'wide.png') });
  await page.getByRole('button', { name: '浏览', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.getByRole('button', { name: '分屏', exact: true }).click();
  const current = await page.locator('.reader-toolbar-log').innerText();
  await page.locator('.reader-navigator-desktop .day-nav-button:not([disabled])').first().click();
  await expect.poll(() => page.locator('.reader-toolbar-log').innerText()).not.toBe(current);
  assert.ok((await preview.boundingBox()).x < (await editor.boundingBox()).x);
  report.checks.push('wide: split order, boundary, bidirectional scroll, mode and document switching');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 900));
  await expect.poll(() => preview.evaluate(el => getComputedStyle(el).order)).toBe('2');
  assert.equal(await editor.evaluate(el => getComputedStyle(el).order), '1');
  await page.screenshot({ path: path.join(root, 'narrow.png') });
  report.checks.push('narrow: original stacked order retained');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack; report.pages = await Promise.all((app?.context().pages() || []).map(async item => ({ url: item.url(), text: await item.locator('body').innerText().catch(() => '') }))); await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); process.exitCode = 1; }
finally {
  if (app) { const closed = app.waitForEvent('close', { timeout: 60000 }); await app.evaluate(({ app }) => app.quit()).catch(() => {}); await closed.catch(() => {}); }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
