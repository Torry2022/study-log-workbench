import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'inspector-scroll-')) }; delete env.ELECTRON_RUN_AS_NODE;
const evidence = path.resolve('.local', `inspector-scroll-${Date.now()}`); await fs.mkdir(evidence);
const app = await electron.launch({ executablePath: er('electron'), args: [path.resolve('ops/electron')], env });
const errors = [], rows = [];
async function check(page, entry) {
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 1280]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height:900}); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole('button', {name:'展开右侧栏', exact:true}).click();
      for (const position of ['top', 'partial', 'middle', 'bottom']) {
        await page.evaluate(position => {
          const max = document.documentElement.scrollHeight - innerHeight;
          scrollTo(0, position === 'top' ? 0 : position === 'partial' ? 32 : position === 'middle' ? max / 2 : max);
        }, position);
        await expect.poll(async () => page.locator('.writing-inspector').evaluate(e => Math.abs(e.getBoundingClientRect().bottom - innerHeight))).toBeLessThanOrEqual(1);
        const geometry = await page.locator('.writing-inspector').evaluate(e => ({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:innerHeight,scrollY}));
        rows.push({entry,width,theme,expanded,position,...geometry});
      }
      await page.screenshot({path:path.join(evidence, `${entry}-${width}-${theme}-${expanded}.png`)});
      if (expanded) await page.getByRole('button', {name:'折叠右侧栏', exact:true}).click();
    }
  }
  await page.evaluate(() => scrollTo(0,0));
}
try {
  const page = await workspacePage(app); await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '学习日志工作台').setContentSize(1440,900));
  await check(page, 'electron');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const cookies = await app.evaluate(async ({webContents}) => webContents.getAllWebContents().find(c => /^http/.test(c.getURL())).session.cookies.get({name:'study_log_session'}));
    await context.addCookies(cookies.map(c => ({name:c.name,value:c.value,url:new URL(page.url()).origin,httpOnly:true,sameSite:'Lax'})));
    const web = await context.newPage(); await web.goto(page.url()); await expect(web.locator('.workspace')).toBeVisible();
    await check(web, 'browser');
    const date = await web.locator('.reader-toolbar-log h2').filter({visible:true}).innerText();
    assert.equal(await web.evaluate(async date => {
      const day = (await (await fetch(`/study-log/api/logs/day?date=${date}`)).json()).day;
      return (await fetch('/study-log/api/logs/day',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,baseVersion:day.version})})).status;
    },date),200);
    await web.reload(); await expect(web.locator('.reader .workspace-state-title').filter({visible:true})).toHaveText('暂无学习日志');
    assert.ok(await web.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'empty state must not gain root overflow');
    await web.setViewportSize({width:420,height:900}); await web.getByRole('button',{name:'更多设置',exact:true}).click();
    await web.getByRole('button',{name:'AI 工具',exact:true}).click();
    await expect(web.locator('.writing-inspector.mobile-open')).toBeVisible();
    assert.ok(await web.locator('.writing-inspector').evaluate(e => Math.abs(e.getBoundingClientRect().bottom-innerHeight)<=1));
    await web.screenshot({path:path.join(evidence,'mobile.png')});
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,rows,emptyNoOverflow:true,mobileDrawer:true},null,2)); console.log(evidence);
} finally {
  const ended = app.waitForEvent('close',{timeout:60000}); await app.evaluate(({BrowserWindow,dialog}) => {dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());}); await ended;
}
