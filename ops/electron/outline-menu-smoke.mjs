import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';

const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `outline-menu-${Date.now()}`);
await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'outline-menu-')) };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2] || er('electron');
const app = await electron.launch({ executablePath, args: process.argv[2] ? [] : [path.resolve('ops/electron')], env });
const childProcess = app.process(), rows = [], errors = [];

async function closeGeometry(page) {
  await page.mouse.move(0, 0);
  const result = await page.getByRole('button', { name: '关闭大纲', exact: true }).evaluate(button => {
    const box = button.getBoundingClientRect(), icon = button.querySelector('svg').getBoundingClientRect();
    const style = getComputedStyle(button);
    const sample = document.createElement('span');
    button.append(sample);
    sample.style.backgroundColor = 'var(--surface-soft)'; sample.style.color = 'var(--body)';
    const expected = { background: getComputedStyle(sample).backgroundColor, color: getComputedStyle(sample).color };
    sample.remove();
    return { width: box.width, height: box.height, dx: icon.x + icon.width / 2 - box.x - box.width / 2,
      dy: icon.y + icon.height / 2 - box.y - box.height / 2, radius: style.borderRadius,
      border: style.borderTopWidth, background: style.backgroundColor, color: style.color, expected };
  });
  assert.equal(result.width, 40); assert.equal(result.height, 40);
  assert.ok(Math.abs(result.dx) < 1 && Math.abs(result.dy) < 1, JSON.stringify(result));
  assert.equal(result.border, '1px'); assert.notEqual(result.radius, '0px');
  assert.equal(result.background, result.expected.background); assert.equal(result.color, result.expected.color);
  return result;
}

async function desktopOutline(page) {
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.locator('.log-toolbar-popover').getByRole('button', { name: '大纲', exact: true }).click();
  await expect(page.locator('.reader-outline-modal')).toBeVisible();
}

async function check(page, surface) {
  page.on('pageerror', error => errors.push(error.message));
  const writes = [];
  page.on('request', request => { if (request.url().includes('/api/logs/day') && ['PUT', 'DELETE'].includes(request.method())) writes.push(request.method()); });
  await expect(page.locator('.markdown-preview h3')).toHaveCount(5);
  const inline = page.locator('.preview-workspace > .preview-outline');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [1440, 1240, 1180, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      if (width > 1180) await expect(inline).toBeVisible(); else await expect(inline).toBeHidden();
      const more = page.getByRole('button', { name: '更多操作', exact: true });
      if (width > 1180) {
        await expect(more).toBeHidden();
        await page.getByRole('button', { name: '展开右侧栏', exact: true }).click();
      }
      await more.click();
      const menu = page.locator('.log-toolbar-popover'), button = menu.getByRole('button', { name: '大纲', exact: true });
      await expect(menu.getByRole('button', { name: 'AI 工具', exact: true })).toHaveCount(0);
      await expect(button).toHaveCount(width > 1180 ? 0 : 1);
      if (width > 1180) {
        await page.screenshot({ path: path.join(evidence, `${surface}-${theme}-${width}-menu.png`) });
        await more.press('Escape');
        await page.getByRole('button', { name: '折叠右侧栏', exact: true }).click();
        await expect(more).toBeHidden();
        rows.push({ surface, theme, width, inlineOnly: true });
      } else {
        await button.click(); await expect(page.locator('.reader-outline-modal')).toBeVisible();
        const geometry = await closeGeometry(page);
        await page.screenshot({ path: path.join(evidence, `${surface}-${theme}-${width}-popup.png`) });
        await page.getByRole('button', { name: '关闭大纲', exact: true }).click();
        await expect(page.locator('.reader-outline-modal')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeFocused();
        rows.push({ surface, theme, width, geometry });
      }
    }
    // A wider viewport restores the inline outline and closes the redundant popup.
    // The dedicated desktop rail continues to open the tools after the duplicate is removed.
    await page.getByRole('button', { name: 'AI生成', exact: true }).click();
    await expect(page.locator('.writing-inspector-content')).toBeVisible();
    await page.getByRole('button', { name: '折叠右侧栏', exact: true }).click();
    await desktopOutline(page);
    await page.setViewportSize({ width: 1240, height: 900 });
    await expect(inline).toBeVisible(); await expect(page.locator('.reader-outline-modal')).toHaveCount(0);
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.setViewportSize({ width: 1240, height: 900 });
    await expect(page.getByRole('button', { name: '更多操作', exact: true })).toBeHidden();
    await expect(page.locator('.log-toolbar-popover')).toHaveCount(0);
    await page.setViewportSize({ width: 1180, height: 900 });
    await expect(page.locator('.log-toolbar-popover')).toHaveCount(0);
    await desktopOutline(page); await page.keyboard.press('Escape');
    await expect(page.locator('.reader-outline-modal')).toHaveCount(0);
    await desktopOutline(page); await page.mouse.click(10, 850);
    await expect(page.locator('.reader-outline-modal')).toHaveCount(0);
    await desktopOutline(page);
    await page.locator('.reader-outline-modal').getByRole('button', { name: '5. 保存好自己的学习记录', exact: true }).click();
    await expect(page.locator('.reader-outline-modal')).toHaveCount(0);
    await expect(page.locator('.editor-navigation-status')).toHaveCount(0);
    assert.ok(await page.evaluate(() => scrollY > 500));
    // Mobile uses the same styled outline and keeps the explicit entry.
    await page.setViewportSize({ width: 390, height: 900 }); await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole('button', { name: '更多日志操作', exact: true }).click();
    await page.locator('.mobile-action-sheet').getByRole('button', { name: 'AI 工具', exact: true }).click();
    await expect(page.locator('.writing-inspector.mobile-open')).toBeVisible();
    await page.getByRole('button', { name: '关闭 AI 工具', exact: true }).click();
    await page.getByRole('button', { name: '更多日志操作', exact: true }).click();
    await page.getByRole('button', { name: '打开日志大纲', exact: true }).filter({ visible: true }).click();
    const geometry = await closeGeometry(page);
    await page.screenshot({ path: path.join(evidence, `${surface}-${theme}-390-popup.png`) });
    await page.getByRole('button', { name: '关闭大纲', exact: true }).click();
    await expect(page.locator('.reader-outline-modal')).toHaveCount(0);
    rows.push({ surface, theme, width: 390, geometry, resizeAndDismissAndJump: true });
  }
  // Modes without an inline outline retain their entry; opening and cancelling preserves a draft.
  await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  await page.locator('.cm-content').press('Control+End'); await page.keyboard.insertText('\n\n未保存的大纲检查草稿。');
  const draft = await page.locator('.cm-content .cm-line').allTextContents();
  for (const mode of ['源码', '分屏']) {
    await page.getByRole('button', { name: mode, exact: true }).filter({ visible: true }).click();
    await expect(inline).toHaveCount(0); await desktopOutline(page);
    await page.getByRole('button', { name: '关闭大纲', exact: true }).click();
    assert.deepEqual(await page.locator('.cm-content .cm-line').allTextContents(), draft);
  }
  await page.getByRole('button', { name: '浏览', exact: true }).filter({ visible: true }).click();
  await expect(inline).toBeVisible();
  await page.getByRole('button', { name: '进入阅读模式', exact: true }).click();
  await expect(inline).toBeHidden();
  await page.getByRole('button', { name: '打开日志大纲', exact: true }).filter({ visible: true }).click();
  await closeGeometry(page); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '退出阅读', exact: true }).click(); await expect(inline).toBeVisible();
  assert.deepEqual(writes, []);
  rows.push({ surface, modesAndReading: true, draftPreserved: true, logWrites: writes.length });
}

try {
  const page = await workspacePage(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '学习日志工作台').setContentSize(1440, 900));
  await check(page, 'electron');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cookies = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(c => /^http/.test(c.getURL())).session.cookies.get({ name: 'study_log_session' }));
    await context.addCookies(cookies.map(c => ({ name: c.name, value: c.value, url: new URL(page.url()).origin, httpOnly: true, sameSite: 'Lax' })));
    const web = await context.newPage(); await web.goto(new URL('/study-log', page.url()).href);
    await check(web, 'browser');
  } finally { await browser.close(); }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, executablePath, packaged: !!process.argv[2], rows }, null, 2));
  console.log(evidence);
} finally {
  if (childProcess.exitCode === null) {
    const closed = app.waitForEvent('close', { timeout: 60000 });
    await app.evaluate(({ BrowserWindow, dialog }) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.getAllWindows().reverse().forEach(w => w.close()); });
    await closed;
  }
}
