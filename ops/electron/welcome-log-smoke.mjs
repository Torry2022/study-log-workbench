import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `welcome-log-${Date.now()}`); await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'welcome-log-')) }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: er('electron'), args: [path.resolve('ops/electron')], env });
const rows = [], errors = [];
async function check(page, name) {
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.markdown-preview h3').first()).toHaveText('1. 欢迎使用学习日志工作台');
  await expect(page.locator('.reader-toolbar-log h2').filter({ visible: true })).toHaveText(/\d{4}-\d{2}-\d{2}/);
  await expect(page.locator('.markdown-preview h3')).toHaveCount(5);
  await expect(page.locator('.markdown-preview h4')).toHaveText('标题与正文怎么安排');
  await expect(page.locator('.markdown-preview pre code')).toContainText('### 1. 今天理解的一个概念');
  for (const width of [1440, 420]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(evidence, `${name}-${width}-${theme}.png`) });
    rows.push({ name, width, theme });
  }
}
try {
  const page = await workspacePage(app); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '学习日志工作台').setContentSize(1440, 900));
  await check(page, 'electron');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cookies = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(c => /^http/.test(c.getURL())).session.cookies.get({ name: 'study_log_session' }));
    await context.addCookies(cookies.map(c => ({ name: c.name, value: c.value, url: new URL(page.url()).origin, httpOnly: true, sameSite: 'Lax' })));
    const web = await context.newPage(); await web.goto(new URL('/study-log', page.url()).href); await check(web, 'browser');
    await web.setViewportSize({ width: 1440, height: 900 });
    const date = await web.locator('.reader-toolbar-log h2').filter({ visible: true }).innerText();
    const initial = await web.evaluate(async date => (await (await fetch(`/study-log/api/logs/day?date=${date}`)).json()).day, date);
    await web.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
    await expect(web.locator('.cm-content')).toContainText('### 1. 欢迎使用学习日志工作台');
    await web.locator('.cm-content').press('Control+End'); await web.keyboard.insertText('\n\n我写下的第一条记录。');
    const saved = web.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/api/logs/day')); await web.keyboard.press('Control+s'); assert.equal((await saved).status(), 200);
    await web.reload(); await expect(web.locator('.markdown-preview')).toContainText('我写下的第一条记录。');
    const changed = await web.evaluate(async date => (await (await fetch(`/study-log/api/logs/day?date=${date}`)).json()).day, date);
    assert.notEqual(changed.version, initial.version);
    const removed = await web.evaluate(async day => (await fetch('/study-log/api/logs/day', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: day.date, baseVersion: day.version }) })).status, changed); assert.equal(removed, 200);
    await web.goto(new URL('/study-log', web.url()).href); await expect(web.locator('.reader .workspace-state-title').filter({ visible: true })).toHaveText('暂无学习日志');
    rows.push({ editedSavedReadBack: true, deletedEmptyState: true });
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, rows }, null, 2)); console.log(evidence);
} catch (error) { console.error(error); throw error; }
finally {
  const ended = app.waitForEvent('close', { timeout: 60000 }); await app.evaluate(({ BrowserWindow, dialog }) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.getAllWindows().reverse().forEach(w => w.close()); }); await ended;
}
