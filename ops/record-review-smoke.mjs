// Independent Playwright: short records, search scope and section statistics.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { DesktopManager } from './desktop/manager.mjs';
import { workspacePage } from './electron/workspace-test.mjs';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, _electron: electron, expect } = require('@playwright/test');
const mode = process.argv[2] || 'web';
assert.ok(['web', 'electron'].includes(mode));
const evidence = path.resolve('.local', `record-review-${mode}-${Date.now()}`);
await fs.mkdir(evidence);
let manager, browser, app, page;
const checks = [], errors = [];
try {
  if (mode === 'web') {
    manager = new DesktopManager({ packageRoot:path.join(evidence,'program'), webRoot:path.resolve('study-log-web'), mcpRoot:path.resolve('study-log-mcp') });
    const password = 'SyntheticRecordReviewOnly2026';
    await manager.select({ root:path.join(evidence,'instance'), create:true, password });
    const base = (await manager.start()).url;
    browser = await chromium.launch();
    page = await browser.newPage({ viewport:{width:1440,height:900} });
    await page.request.post(base + '/api/auth/login', {data:{password}});
    await page.goto(base);
  } else {
    const er = createRequire(new URL('./electron/package.json', import.meta.url));
    const profile = await fs.mkdtemp(path.join(os.tmpdir(),'record-review-'));
    const env = {...process.env, STUDY_LOG_DESKTOP_PROFILE:profile};
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({executablePath:process.argv[3] || er('electron'), args:process.argv[3] ? [] : [path.resolve('ops/electron')], env, timeout:60000});
    page = await workspacePage(app);
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1280,820));
  }
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.workspace')).toBeVisible({timeout:60000});
  const base = page.url().split('?')[0].replace(/\/$/, '');
  async function put(date, content) {
    const result = await page.evaluate(async ({base,date,content}) => {
      const currentResponse = await fetch(`${base}/api/logs/day?date=${date}`);
      if(!currentResponse.ok) return {status:currentResponse.status};
      const current = await currentResponse.json();
      const response = await fetch(`${base}/api/logs/day`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,content,baseVersion:current.day.version})});
      return {status:response.status};
    },{base,date,content});
    assert.equal(result.status,200);
  }
  await put('2026-09-09', '### 上月合成记录\n\n用于确认比较数字不会遮蔽小节计数口径。');
  await page.goto(`${base}?view=log&date=2026-10-09`);
  // Create through the same entry as normal recording, then edit actual CodeMirror.
  if (!(await page.locator('.cm-content').isVisible())) {
    await page.getByLabel('新建指定日期',{exact:true}).fill('2026-10-09');
    await page.locator('.sidebar').getByRole('button',{name:'新建',exact:true}).click();
  }
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click(); await editor.press('Control+A');
  await page.keyboard.insertText('合成检索标记：今天读了几页书，仅在上下文支持时才作判断。');
  const saved = page.waitForResponse(r=>r.url().endsWith('/api/logs/day') && r.request().method()==='PUT');
  await page.locator('.reader-toolbar-log').getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await saved).status(),200);
  const actualDate = new URL(page.url()).searchParams.get('date');
  assert.equal(actualDate,'2026-10-09');
  await page.reload();
  await expect(page.locator('.markdown-preview')).toContainText('合成检索标记');
  checks.push('short record saves and reopens without headings or a model');
  const search = page.getByRole('combobox',{name:'搜索全部日志'});
  await search.fill('合成检索标记'); await search.press('Enter');
  await expect(page.locator('.search-popover .result-item')).toHaveCount(1);
  await page.getByRole('button',{name:'当前搜索标题和正文，点击后仅搜索小节标题'}).click();
  await expect(page.getByText('未找到匹配的小节标题',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'当前仅搜索小节标题，点击后搜索标题和正文'}).click();
  await expect(page.locator('.search-popover .result-item')).toHaveCount(1);
  await page.locator('.search-popover .result-item').click();
  checks.push('default full-text search finds short record; heading scope and return preserve query');
  await page.goto(`${base}?view=stats&month=2026-10`);
  const metrics = page.locator('.stats-metric-strip > div');
  await expect(metrics.nth(0).locator('strong')).toHaveText('1');
  await expect(metrics.nth(1).locator('strong')).toHaveText('0');
  await expect(metrics.nth(1)).toContainText('按三级标题计数');
  await expect(metrics.nth(1).locator('.stats-delta')).toBeVisible();
  await expect(page.getByText('普通段落会计入记录天数，三级标题会计入小节数量。',{exact:true})).toBeVisible();
  await expect(page.locator('.stats-review-toolbar')).not.toContainText('日志日志');
  for (const width of [1440,420]) {
    if(app) await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,820),width);
    else await page.setViewportSize({width,height:900});
    // Native DPI rounding may differ by one CSS pixel from the requested size.
    await expect.poll(()=>page.evaluate(w=>Math.abs(innerWidth-w)<=1,width)).toBe(true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(evidence,`short-record-stats-${width}.png`)});
  }
  checks.push('record days and zero H3 sections remain distinct with previous-month comparison, wide and narrow');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({mode,checks,errors,paidCalls:0},null,2));
  console.log(evidence);
} catch(error) {
  if(app) for(const p of app.context().pages()) if(!p.isClosed()) console.error(p.url(), await p.locator('body').innerText().catch(()=>''));
  throw error;
} finally {
  if(browser) await browser.close();
  if(manager) await manager.shutdown();
  if(app && app.process().exitCode === null) {
    const closed = app.waitForEvent('close',{timeout:60000});
    await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});
    await closed;
  }
}
