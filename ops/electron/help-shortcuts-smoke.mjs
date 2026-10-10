import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `help-shortcuts-${Date.now()}`); await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'help-shortcuts-')) }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.argv[2] || er('electron'), args: process.argv[2] ? [] : [path.resolve('ops/electron')], env });
const rows = [], errors = [];
const blur = page => page.evaluate(() => document.activeElement?.blur());
async function exercise(page, name) {
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL('/study-log', page.url()).href;
  for (const date of ['2026-06-01', '2026-06-02']) {
    const status = await page.evaluate(async date => {
      const { day } = await (await fetch(`/study-log/api/logs/day?date=${date}`)).json();
      return (await fetch('/study-log/api/logs/day', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, content: `### 合成学习记录 ${date}\n\n用于快捷键验证的原文。`, baseVersion: day.version }) })).status;
    }, date);
    assert.equal(status, 200);
  }
  await page.goto(base + '?date=2026-06-01'); await expect(page.locator('.markdown-preview h3')).toHaveText('合成学习记录 2026-06-01');
  console.log(name, await page.evaluate(() => ({ width: innerWidth, height: innerHeight, help: document.querySelectorAll('[aria-label=使用帮助]').length })));
  const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const trigger = page.getByRole('button', { name: '使用帮助', exact: true });
    await trigger.click(); await expect(help).toBeVisible();
    for (const [level, label] of [[3, '三级标题'], [4, '四级标题'], [5, '五级标题'], [6, '六级标题']]) {
      const row = help.locator('dl > div').filter({ hasText: `Ctrl + Alt + ${level}` });
      await expect(row).toContainText(label);
    }
    await expect(help.getByRole('button', { name: '关闭帮助' })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(help.getByRole('button', { name: '关闭帮助' })).toBeFocused();
    await page.keyboard.press('Control+Alt+q'); await page.keyboard.press('Control+Shift+F');
    await expect(page.locator('.view-log')).toBeVisible(); await expect(help.getByRole('button', { name: '关闭帮助' })).toBeFocused();
    assert.ok(await help.evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth + 1; }));
    await page.screenshot({ path: path.join(evidence, `${name}-${theme}-help.png`) });
    await page.keyboard.press('Escape'); await expect(help).toHaveCount(0); await expect(trigger).toBeFocused();
  }
  await blur(page); await page.keyboard.press('ArrowLeft'); await expect(page.locator('.reader-toolbar-log .reader-heading-row h2')).toContainText('2026-06-02'); await expect(page.locator('.markdown-preview h3')).toHaveText('合成学习记录 2026-06-02');
  await blur(page); await page.keyboard.press('ArrowRight'); await expect(page.locator('.reader-toolbar-log .reader-heading-row h2')).toContainText('2026-06-01'); await expect(page.locator('.markdown-preview h3')).toHaveText('合成学习记录 2026-06-01');
  await page.keyboard.press('Control+g'); await expect(page.getByRole('dialog', { name: '跳转到指定日期' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+F'); const search = page.getByRole('combobox', { name: '搜索全部日志' }); await expect(search).toBeFocused();
  await search.fill('没有匹配的合成词'); await page.keyboard.press('ArrowRight'); assert.ok(page.url().includes('2026-06-01')); await search.fill('');
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  const editor = page.locator('.cm-content'); await editor.click();
  const original = await editor.innerText();
  await page.keyboard.press('Control+Home');
  for (const level of [4, 5, 6, 3]) {
    await page.keyboard.press(`Control+Alt+${level}`);
    await expect(editor.locator('.cm-line').first()).toHaveText(`${'#'.repeat(level)} 合成学习记录 2026-06-01`);
  }
  await page.getByRole('button', { name: '编辑 Markdown', exact: true }).click();
  await page.getByRole('button', { name: '四级标题', exact: true }).click();
  await expect(editor.locator('.cm-line').first()).toHaveText('#### 合成学习记录 2026-06-01');
  await page.keyboard.press('Control+Alt+3');
  await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n');
  await page.keyboard.press('Control+Alt+6'); await page.keyboard.insertText('空行标题');
  await expect(editor.locator('.cm-line').last()).toHaveText('###### 空行标题');
  await page.keyboard.press('Control+A'); await page.keyboard.insertText(original);
  await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n\n未保存快捷键草稿');
  rows.push({ name, headingShortcuts: [3, 4, 5, 6], blankHeading: true });
  await page.keyboard.press('Control+Shift+K'); await expect(page.getByRole('dialog', { name: '插入内部链接' })).toBeVisible();
  await page.keyboard.press('Control+Alt+q'); await expect(page.locator('.view-log')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '插入内部链接' })).toHaveCount(0);
  await editor.click(); await page.keyboard.press('Control+Alt+q'); const confirm = page.getByRole('alertdialog'); await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '取消', exact: true }).click(); await expect(confirm).toHaveCount(0); await expect(editor).toContainText('未保存快捷键草稿');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/logs/day') && r.request().method() === 'PUT');
  await editor.click(); await page.keyboard.press('Control+s'); assert.equal((await saved).status(), 200);
  await page.getByRole('button', { name: '折叠左侧栏', exact: true }).filter({ visible: true }).click();
  await page.keyboard.press('Control+Alt+q'); await expect(page.locator('.view-qa')).toBeVisible();
  await blur(page); await page.keyboard.press('Control+Alt+n'); await expect(page.locator('.view-log')).toBeVisible(); await expect(page.getByLabel('新建指定日期')).toBeFocused();
  await blur(page); await page.evaluate(() => { const probe = document.createElement('div'); probe.id = 'shortcut-scroll'; probe.style.height = '3000px'; document.body.append(probe); window.scrollTo(0, 500); });
  await page.keyboard.press('Alt+ArrowUp'); await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => document.querySelector('#shortcut-scroll').remove());
  // Composition/repeat events must not redirect focus away from an input.
  const date = page.getByLabel('新建指定日期'); await date.focus();
  await date.evaluate(e => { e.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, isComposing: true, bubbles: true })); e.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, repeat: true, bubbles: true })); });
  await expect(date).toBeFocused(); rows.push({ name, help: true, navigation: true, draftProtected: true, internalLink: true, save: true, newQuestion: true, newDateFocus: true, backToTop: true, composition: true });
}
try {
  const page = await workspacePage(app); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '学习日志工作台').setContentSize(1440, 900)); await exercise(page, 'electron');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === '帮助').submenu.items.find(i => i.label === '使用帮助').click());
  await expect(page.getByRole('dialog', { name: '使用帮助' })).toBeVisible(); await page.keyboard.press('Escape');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cookies = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(c => /^http/.test(c.getURL())).session.cookies.get({ name: 'study_log_session' }));
    await context.addCookies(cookies.map(c => ({ name: c.name, value: c.value, url: new URL(page.url()).origin, httpOnly: true, sameSite: 'Lax' })));
    const web = await context.newPage(); await web.goto(page.url()); await expect(web.locator('.workspace')).toBeVisible(); await exercise(web, 'browser');
    await web.setViewportSize({ width: 390, height: 780 });
    await web.getByRole('button', { name: '更多设置', exact: true }).click();
    await web.getByRole('button', { name: '使用帮助', exact: true }).filter({ visible: true }).click();
    await expect(web.getByRole('dialog', { name: '使用帮助' })).toBeVisible();
    assert.ok(await web.locator('.help-dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    await web.screenshot({ path: path.join(evidence, 'browser-mobile-help.png') });
    await web.locator('.help-dialog-content').evaluate(e => e.scrollTop = e.scrollHeight);
    await expect(web.locator('.help-dialog').getByText('Shift + Enter', { exact: true })).toBeInViewport();
    await web.screenshot({ path: path.join(evidence, 'browser-mobile-help-bottom.png') });
    await web.keyboard.press('Escape'); await expect(web.locator('.help-dialog')).toHaveCount(0);
    await blur(web); await web.keyboard.press('Control+Shift+F'); await expect(web.getByRole('combobox', { name: '搜索全部日志' })).toBeFocused();
    await web.keyboard.press('Escape'); await blur(web); await web.keyboard.press('Control+Alt+n'); await expect(web.getByLabel('新建指定日期')).toBeFocused();
    rows.push({ mobileHelpAndShortcuts: true });
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, packaged: !!process.argv[2], rows }, null, 2)); console.log(evidence);
} catch (error) {
  console.error(error);
  for (const p of app.context().pages().filter(p => /^http/.test(p.url()))) await p.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  const closed = app.waitForEvent('close', { timeout: 60000 });
  await app.evaluate(({ BrowserWindow, dialog }) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.getAllWindows().reverse().forEach(w => w.close()); }); await closed;
}
