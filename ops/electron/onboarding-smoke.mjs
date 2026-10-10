import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `onboarding-${Date.now()}`); await fs.mkdir(evidence);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-onboarding-'));
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.argv[2] || er('electron'), args: process.argv[2] ? [] : [path.resolve('ops/electron')], env, timeout:60000 });
const errors = [], rows = [];
async function check(page, entry) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const origin = new URL(page.url()).origin;
  const go = view => page.goto(`${origin}/study-log?view=${view}`);
  const api = (url, options) => page.evaluate(async ({ url, options }) => {
    const response = await fetch(`/study-log/api/${url}`, options);
    if (!response.ok) throw Error(`Synthetic API ${url}: ${response.status}`);
    return response.json();
  }, { url, options });
  let modelCalls = 0, mutations = 0;
  page.on('request', request => { if (/\/api\/(notes|favorites|rag\/sessions)/.test(request.url()) && request.method() !== 'GET') mutations++; });
  await page.route('**/api/rag/query', route => { modelCalls++; return route.abort(); });
  const firstMutations = mutations;
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height:900 }); await page.emulateMedia({ colorScheme:theme });
    for (const view of ['notes', 'favorites', 'qa', 'stats']) {
      await go(view); await expect(page.locator(`.app-shell.view-${view}`)).toBeVisible();
      if (view === 'notes') {
        await expect(page.getByLabel('随记写法示例')).toContainText('不会保存为随记');
        await expect(page.locator('.notes-empty-state').getByRole('button', { name:'新建随记', exact:true })).toBeVisible();
      } else if (view === 'favorites') {
        await expect(page.locator('.favorites-empty-state')).toContainText('三级标题');
        await expect(page.locator('.favorites-empty-state').getByRole('button', { name:'前往日志', exact:true })).toBeVisible();
      } else if (view === 'qa') {
        await expect(page.getByRole('group', { name:'示例问题', exact:true }).getByRole('button')).toHaveCount(3);
        await expect(page.locator('.rag-composer .feature-availability')).toBeVisible();
        await expect(page.getByRole('button', { name:'发送问题', exact:true })).toBeDisabled();
      } else {
        await expect(page.locator('.stats-count-explanation')).toBeVisible();
        await expect(page.locator('.stats-count-explanation')).toContainText('数量不代表掌握程度');
        await expect(page.locator('.stats-metric-strip').locator('div').nth(1).locator('strong')).toHaveText('5');
      }
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path:path.join(evidence, `${entry}-${width}-${theme}-${view}.png`), fullPage:true, animations:'disabled' });
      rows.push({ entry, width, theme, view });
    }
  }
  assert.equal(mutations, firstMutations, 'Viewing guidance must not create user data');
  assert.equal(modelCalls, 0);
  assert.equal((await api('notes')).notes.length, 0);
  assert.equal((await api('favorites')).favorites.length, 0);
  console.log(`${entry}: empty-state matrix passed`);
  await page.setViewportSize({ width:1440, height:900 });
  await go('notes'); await page.locator('.notes-empty-state').getByRole('button', { name:'新建随记', exact:true }).click();
  await expect(page.getByLabel('随记正文', { exact:true })).toHaveValue('');
  await expect(page.getByRole('button', { name:'保存随记', exact:true })).toBeDisabled();
  await page.getByRole('button', { name:'取消', exact:true }).click();
  assert.equal((await api('notes')).notes.length, 0);
  await page.locator('.notes-empty-state').getByRole('button', { name:'新建随记', exact:true }).click();
  await page.getByLabel('随记正文', { exact:true }).fill('仅用于引导验收的合成随记。');
  await page.getByRole('button', { name:'保存随记', exact:true }).click();
  await expect(page.locator('.note-entry')).toHaveCount(1); await expect(page.getByLabel('随记写法示例')).toHaveCount(0);
  await page.getByLabel('搜索随记', { exact:true }).fill('找不到的合成关键词'); await page.getByLabel('搜索随记', { exact:true }).press('Enter');
  await expect(page.locator('.notes-empty-state')).toContainText('没有匹配的随记'); await expect(page.getByLabel('随记写法示例')).toHaveCount(0);
  const note = (await api('notes')).notes[0];
  await api('notes', { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id:note.id, baseVersion:note.version }) });
  console.log(`${entry}: note draft, save and filtering passed`);
  await go('favorites'); await page.locator('.favorites-empty-state').getByRole('button', { name:'前往日志', exact:true }).click();
  await expect(page.locator('.markdown-preview')).toContainText('使用示例');
  await page.getByRole('button', { name:'收藏章节：1. 欢迎使用学习日志工作台', exact:true }).click();
  await go('favorites'); await expect(page.locator('.favorite-item')).toHaveCount(1); await expect(page.locator('.favorites-empty-state')).toHaveCount(0);
  await page.getByLabel('搜索收藏', { exact:true }).fill('找不到的合成关键词'); await page.getByLabel('搜索收藏', { exact:true }).press('Enter');
  await expect(page.locator('.favorites-empty-state')).toContainText('没有符合条件的收藏');
  await expect(page.locator('.favorites-empty-state').getByRole('button', { name:'前往日志', exact:true })).toHaveCount(0);
  const favorite = (await api('favorites')).favorites[0]; await api(`favorites?id=${encodeURIComponent(favorite.id)}`, { method:'DELETE' });
  await go('qa'); const question = page.getByLabel('输入知识库问题', { exact:true });
  await page.getByRole('group', { name:'示例问题', exact:true }).getByRole('button').first().click();
  await expect(question).toHaveValue('帮我回顾最近记录的主要内容。'); await expect(question).toBeFocused();
  await expect(page.getByRole('button', { name:'发送问题', exact:true })).toBeDisabled();
  await question.fill('我自己正在写的问题'); await expect(page.getByRole('group', { name:'示例问题', exact:true })).toHaveCount(0);
  await question.fill(''); await expect(page.getByRole('group', { name:'示例问题', exact:true })).toBeVisible();
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch(); const payload = await response.json(); payload.features.rag = { supported:true, configured:true }; await route.fulfill({ response, json:payload });
  });
  await go('qa'); await page.getByRole('group', { name:'示例问题', exact:true }).getByRole('button').nth(1).click();
  await expect(question).toHaveValue('哪些记录讨论了同一个主题？'); await expect(page.getByRole('button', { name:'发送问题', exact:true })).toBeEnabled();
  assert.equal(modelCalls, 0); assert.equal((await api('rag/sessions')).sessions.length, 0);
  await page.unroute('**/api/capabilities');
  await question.fill('');
  await go('log'); rows.push({ entry, blankNoteDraft:true, explicitNoteSave:true, filteredStates:true, realFavorite:true, questionFillOnly:true, noPaidCalls:true });
}
try {
  const page = await workspacePage(app);
  await expect(page.locator('.reader-toolbar-log h2').filter({ visible:true })).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  const exampleDate = await page.locator('.reader-toolbar-log h2').filter({ visible:true }).innerText();
  // Native draft confirmation is covered by the lifecycle suite; do not let an
  // unattended navigation failure leave a modal blocking this isolated runner.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await check(page, 'electron');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const cookies = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(contents => /^http/.test(contents.getURL())).session.cookies.get({ name:'study_log_session' }));
    await context.addCookies(cookies.map(cookie => ({ name:cookie.name, value:cookie.value, url:new URL(page.url()).origin, httpOnly:true, sameSite:'Lax' })));
    const web = await context.newPage(); await web.goto(page.url()); await check(web, 'browser');
    await web.evaluate(async date => {
      const read = await fetch(`/study-log/api/logs/day?date=${date}`);
      if (!read.ok) throw Error(`Synthetic log read: ${read.status}`);
      const { day } = await read.json();
      const response = await fetch('/study-log/api/logs/day', { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ date, baseVersion:day.version }) });
      if (!response.ok) throw Error(`Synthetic log deletion: ${response.status}`);
    }, exampleDate);
    for (const view of ['qa', 'stats']) {
      await web.goto(`${new URL(web.url()).origin}/study-log?view=${view}`);
      const empty = web.locator('.reader .workspace-state-module').filter({ visible:true });
      await expect(empty.getByRole('button', { name:'前往日志', exact:true })).toBeVisible();
      await expect(web.getByRole('group', { name:'示例问题', exact:true })).toHaveCount(0);
      await empty.getByRole('button', { name:'前往日志', exact:true }).click(); await expect(web.locator('.app-shell.view-log')).toBeVisible();
    }
    rows.push({ noLogsGuidance:true });
  } finally { await browser.close(); }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed:true, profile, packaged:!!process.argv[2], webBuild:(await fs.readFile('study-log-web/.next-build-cache/BUILD_ID', 'utf8')).trim(), rows }, null, 2));
  console.log(JSON.stringify({ passed:true, evidence, matrixChecks:32 }));
} catch (error) {
  console.error(error);
  const page = app.context().pages().find(page => /^http/.test(page.url()) && !page.isClosed());
  if (page) await page.screenshot({ path:path.join(evidence, 'failure.png'), fullPage:true }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
  await app.close();
}
