import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `preview-edit-${Date.now()}`); await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'preview-edit-')) }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: er('electron'), args: [path.resolve('ops/electron')], env });
const reports = [], errors = [];
const body = Array.from({ length: 45 }, (_, i) => `### 第${i + 1}段\n\n第${i + 1}段合成正文，用于验证阅读和编辑之间的位置衔接，不是真实学习记录。\n\n第二个普通段落，验证单击、双击及三击的边界。`).join('\n\n') + '\n\n`行内代码`\n\n```text\n代码块文本\n```\n\n[内部跳转](#第1段)\n';
async function exercise(page, name) {
  page.on('pageerror', error => errors.push(error.message));
  const base = new URL('/study-log', page.url()).href;
  const status = await page.evaluate(async body => {
    const { day } = await (await fetch('/study-log/api/logs/day?date=2026-06-03')).json();
    return (await fetch('/study-log/api/logs/day', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-06-03', content: body, baseVersion: day.version }) })).status;
  }, body); assert.equal(status, 200);
  await page.goto(base + '?date=2026-06-03'); await expect(page.locator('.markdown-preview h3').first()).toHaveText('第1段');
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT') writes++; });
  const preview = page.locator('.markdown-preview'), editor = page.locator('.cm-content');
  const mode = label => page.getByRole('button', { name: label, exact: true }).filter({ visible: true });
  await preview.locator('p').first().click(); await expect(preview).toBeVisible();
  await preview.locator('p').first().dblclick(); await expect(preview).toBeVisible(); assert.ok(await page.evaluate(() => Boolean(getSelection()?.toString())));
  for (const selector of ['p > code', 'pre code', 'a']) {
    await preview.locator(selector).first().click({ clickCount: 3 }); await expect(preview).toBeVisible();
  }
  await preview.locator('p').first().evaluate(e => e.dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 3, pointerType: 'touch' })));
  await expect(preview).toBeVisible();
  const target = preview.locator('h3').filter({ hasText: /^第30段$/ }); await target.scrollIntoViewIfNeeded();
  await target.click({ clickCount: 3 }); await expect(editor).toBeVisible(); await expect(editor).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY + (document.querySelector('.cm-scroller')?.scrollTop || 0))).toBeGreaterThan(100);
  assert.equal(writes, 0); await page.screenshot({ path: path.join(evidence, `${name}-source.png`) });
  await mode('浏览').click(); await expect(target).toBeInViewport();
  await page.evaluate(() => scrollTo(0, 0)); await page.getByRole('button', { name: '进入阅读模式' }).click();
  await preview.locator('p').first().click({ clickCount: 3 }); await expect(editor).toBeVisible(); await expect(editor).toBeFocused(); await expect(page.locator('.reading-mode-workspace')).toHaveCount(0);
  await editor.press('Control+End'); await page.keyboard.insertText('\n未保存的三击切换草稿');
  await mode('浏览').click(); await preview.locator('p').filter({ hasText: '未保存的三击切换草稿' }).click({ clickCount: 3 });
  await expect(editor).toContainText('未保存的三击切换草稿'); assert.equal(writes, 0);
  // Save explicitly only after checking the gesture did not save or discard edits.
  const saved = page.waitForResponse(r => r.url().endsWith('/api/logs/day') && r.request().method() === 'PUT'); await editor.press('Control+s'); assert.equal((await saved).status(), 200);
  await mode('分屏').click(); await preview.locator('p').first().click({ clickCount: 3 }); await expect(mode('分屏')).toHaveAttribute('aria-pressed', 'true');
  await mode('浏览').click(); await page.evaluate(() => scrollTo(0, 0));
  const newDate = name === 'electron' ? '2026-06-04' : '2026-06-05';
  await page.goto(base + '?date=' + newDate); await mode('源码').click(); await editor.fill('尚未保存的新日期正文');
  await mode('浏览').click(); await preview.locator('p').first().click({ clickCount: 3 });
  await expect(editor).toContainText('尚未保存的新日期正文'); assert.equal(writes, 1);
  const firstSave = page.waitForResponse(r => r.url().endsWith('/api/logs/day') && r.request().method() === 'PUT'); await editor.press('Control+s'); assert.equal((await firstSave).status(), 200);
  await mode('浏览').click();
  reports.push({ name, singleAndDoubleClick: true, excludedTargets: true, touchIgnored: true, positionAndFocus: true, readingModeExit: true, unsavedDraft: true, explicitSave: true, newUnsavedDate: true, splitUnchanged: true });
}
try {
  const page = await workspacePage(app); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '学习日志工作台').setContentSize(1440, 900));
  await exercise(page, 'electron');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cookies = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(c => /^http/.test(c.getURL())).session.cookies.get({ name: 'study_log_session' }));
    await context.addCookies(cookies.map(c => ({ name: c.name, value: c.value, url: new URL(page.url()).origin, httpOnly: true, sameSite: 'Lax' })));
    const web = await context.newPage(); await web.goto(page.url()); await exercise(web, 'browser');
    await web.setViewportSize({ width: 420, height: 800 }); await web.locator('.markdown-preview p').first().click({ clickCount: 3 }); await expect(web.locator('.cm-content')).toBeFocused();
    await web.screenshot({ path: path.join(evidence, 'browser-narrow-source.png') });
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, reports }, null, 2)); console.log(evidence);
} catch (error) { console.error(error); throw error; }
finally {
  const ended = app.waitForEvent('close', { timeout: 60000 });
  await app.evaluate(({ BrowserWindow, dialog }) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.getAllWindows().reverse().forEach(w => w.close()); }); await ended;
}
