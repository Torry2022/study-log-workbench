import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const [base, output] = process.argv.slice(2);
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname) && path.isAbsolute(output));
await fs.mkdir(output, { recursive: true });
const results = [];
const patterns = { months: '**/api/logs/months', dates: /\/api\/logs\?month=/, day: /\/api\/logs\/day\?date=/ };
const rect = locator => locator.evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; });
const observeResize = async (dialog, start, end) => {
  const samples = [];
  for (let index = 0; index < 6; index++) { await dialog.page().waitForTimeout(35); samples.push(await rect(dialog)); }
  assert.ok(samples.some(sample => sample.width > Math.min(start.width, end.width) + 1 && sample.width < Math.max(start.width, end.width) - 1));
  assert.ok(samples.some(sample => sample.height > Math.min(start.height, end.height) + 1 && sample.height < Math.max(start.height, end.height) - 1));
};
const verifyResize = async (dialog, maximize, restore, viewport) => {
  await dialog.page().waitForTimeout(220); const settled = await rect(dialog), fullscreen = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  await maximize.click(); await observeResize(dialog, settled, fullscreen); await expect.poll(() => rect(dialog)).toMatchObject(fullscreen);
  await dialog.page().waitForTimeout(80); await restore.click(); await observeResize(dialog, fullscreen, settled); await expect.poll(() => rect(dialog)).toMatchObject(settled);
};
for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch();
  try {
    for (const theme of ['light','dark']) for (const width of [1920,390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await context.addInitScript(() => {
        window.__loadingFrames = [];
        window.__watchLoading = true;
        const check = () => {
          if (window.__watchLoading && document.querySelector('.workspace')) {
            const empty = [...document.querySelectorAll('.reader-content .workspace-state-empty')].find(element => element.getClientRects().length);
            const title = document.querySelector('.reader-log-identity h2')?.textContent;
            if (empty || title === '未选择日期') window.__loadingFrames.push(empty?.textContent || title);
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      const page = await context.newPage(), errors = []; let paid = 0, writes = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/capabilities')) {
          return route.fulfill({ json: {
            instanceId: '00000000-0000-4000-8000-000000000000', apiContractVersion: 1, serverVersion: 'synthetic',
            aiConfiguration: { provider: { configured: true, issues: [] }, templates: { generation: { configured: false }, highlighting: { configured: true }, extraction: { configured: false } } },
            features: { aiWriting: { supported: true, configured: false }, aiHighlighting: { supported: true, configured: true }, aiNoteExtraction: { supported: true, configured: false }, aiTaxonomy: { supported: true, configured: true }, rag: { supported: true, configured: false, issues: [] } }
          } });
        }
        if (url.pathname.endsWith('/ai/bold-highlights')) {
          const input = route.request().postDataJSON();
          return route.fulfill({ json: { result: { content: input.content.replace('二月前一篇', '**二月前一篇**'), model: 'synthetic-motion', boldCount: 1, warnings: [] } } });
        }
        if (/\/(ai\/generate|ai\/bold-highlights|rag\/query|taxonomy\/suggest|notes\/candidates)$/.test(url.pathname)) { paid++; return route.abort(); }
        if (url.pathname.endsWith('/logs/day') && route.request().method() !== 'GET') { writes++; return route.abort(); }
        await route.continue();
      });
      const name = `${engine}-${theme}-${width}`;
      const screenshot = async stage => {
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
        await page.screenshot({ path: path.join(output, `${name}-${stage}.png`) });
      };
      const navigation = async open => {
        if (width < 1024) await page.getByRole('button', { name: open ? '打开日志导航' : '关闭左侧导航', exact: true }).click();
      };
      const reader = page.locator('.reader-content');
      const ready = () => expect(page.locator('.markdown-preview')).toContainText('二月前一篇正文');
      const gate = async (stage, predicate) => {
        let release; const promise = new Promise(resolve => release = resolve);
        await page.route(patterns[stage], async route => { if (!predicate || predicate(route)) await promise; await route.continue().catch(() => {}); });
        return async () => { release(); await page.unroute(patterns[stage]); };
      };
      const releaseMonths = await gate('months'), releaseDates = await gate('dates'), releaseDay = await gate('day');
      await page.goto(`${base}?date=2024-02-09`);
      await page.getByLabel('访问密码').fill('synthetic-loading-password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(reader.locator('.workspace-state-loading').first()).toBeVisible();
      await navigation(true);
      await expect(page.locator('[data-log-section="months"]')).toContainText('正在加载月份');
      await expect(page.getByRole('button',{name:'今天',exact:true})).toBeDisabled();
      await expect(page.locator('[data-log-section="dates"]')).not.toContainText('本月暂无日志');
      await screenshot('months-pending'); await navigation(false);
      if (width >= 1024) await expect(page.getByRole('navigation',{name:'当前日志大纲'})).toContainText('正在加载目录');
      await releaseMonths(); await navigation(true);
      await expect(page.locator('[data-log-section="months"] .nav-item')).toHaveCount(2);
      await expect(page.locator('[data-log-section="dates"]')).toContainText('正在读取日志目录');
      await screenshot('dates-pending'); await navigation(false);
      await releaseDates();
      await expect(reader.locator('.workspace-state-loading').first()).toBeVisible();
      await expect(page.locator('.reader-log-identity h2')).toHaveText('2024-02-09');
      await screenshot('day-pending'); await releaseDay(); await ready();
      assert.deepEqual(await page.evaluate(() => { window.__watchLoading = false; return window.__loadingFrames; }), []);
      if (width >= 1024) await expect(page.getByRole('navigation',{name:'当前日志大纲'})).toContainText('二月前一篇');
      assert.notEqual(await page.locator('.motion-segmented').filter({ visible: true }).first().evaluate(element => getComputedStyle(element, '::before').transitionDuration), '0s');
      await screenshot('ready');
      if (width >= 1024) {
        await page.getByRole('button',{name:'日志历史版本',exact:true}).filter({visible:true}).click();
        const historyDialog = page.getByRole('dialog',{name:'日志历史版本',exact:true}); await expect(historyDialog).toBeVisible();
        await verifyResize(historyDialog, historyDialog.getByRole('button',{name:'最大化历史版本窗口'}), historyDialog.getByRole('button',{name:'还原历史版本窗口'}), {width,height:900});
        await historyDialog.getByRole('button',{name:'关闭日志历史版本',exact:true}).click(); await expect(historyDialog).toHaveCount(0);
        if (await page.getByRole('button',{name:'展开右侧栏',exact:true}).count()) await page.getByRole('button',{name:'展开右侧栏',exact:true}).click();
        await page.getByRole('button',{name:'重点标注',exact:true}).filter({visible:true}).last().click();
        await page.getByRole('button',{name:'标注重点',exact:true}).click();
        const highlightDialog = page.getByRole('dialog',{name:'AI 重点标注差异查看',exact:true}); await expect(highlightDialog).toBeVisible();
        await verifyResize(highlightDialog, highlightDialog.getByRole('button',{name:'最大化重点标注窗口'}), highlightDialog.getByRole('button',{name:'还原重点标注窗口'}), {width,height:900});
        await highlightDialog.getByRole('button',{name:'关闭',exact:true}).click(); await expect(highlightDialog).toHaveCount(0);
      }
      if (width === 1920 && theme === 'light') {
        const existingFavorites = (await (await page.request.get(`${base}/api/favorites`)).json()).favorites;
        if (!existingFavorites.some(item => item.date === '2024-02-09' && item.headingText === '二月前一篇')) {
          assert.equal((await page.request.post(`${base}/api/favorites`, { data: { date: '2024-02-09', headingText: '二月前一篇', headingId: '二月前一篇', level: 3 } })).status(), 200);
        }
        await page.getByRole('button',{name:'收藏',exact:true}).filter({visible:true}).click(); await expect(page.locator('.favorite-item-center').first()).toBeVisible();
        let releaseFavorites, startFavorites; const favoritesGate = new Promise(resolve => releaseFavorites = resolve), favoritesStarted = new Promise(resolve => startFavorites = resolve);
        await page.route('**/api/favorites', async route => { if (route.request().method() !== 'GET') return route.continue(); startFavorites(); await favoritesGate; await route.continue().catch(() => {}); });
        await page.getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click(); await page.getByRole('button',{name:'收藏',exact:true}).filter({visible:true}).click(); await favoritesStarted;
        await expect(page.locator('.favorite-item-center').first()).toBeVisible(); await expect(page.locator('.reader-toolbar-container.pending')).toBeVisible(); releaseFavorites(); await page.unroute('**/api/favorites'); await expect(page.locator('.reader-toolbar-container.pending')).toHaveCount(0);

        const noteTitle = `${engine} 动效保留材料`;
        const existingNotes = (await (await page.request.get(`${base}/api/notes`)).json()).notes;
        if (!existingNotes.some(item => item.title === noteTitle)) assert.equal((await page.request.post(`${base}/api/notes`, { data: { title: noteTitle, body: '后台读取期间仍应显示。', insight: '', sources: [], tags: ['动效'], recordedAt: '2024-02-09T12:00' } })).status(), 200);
        await page.getByRole('button',{name:'随记',exact:true}).filter({visible:true}).click(); await expect(page.locator('.note-entry').filter({hasText:noteTitle})).toBeVisible();
        let releaseNotes, startNotes; const notesGate = new Promise(resolve => releaseNotes = resolve), notesStarted = new Promise(resolve => startNotes = resolve);
        await page.route('**/api/notes', async route => { if (route.request().method() !== 'GET') return route.continue(); startNotes(); await notesGate; await route.continue().catch(() => {}); });
        await page.getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click(); await page.getByRole('button',{name:'随记',exact:true}).filter({visible:true}).click(); await notesStarted;
        await expect(page.locator('.note-entry').filter({hasText:noteTitle})).toBeVisible(); await expect(page.locator('.reader-toolbar-container.pending')).toBeVisible(); releaseNotes(); await page.unroute('**/api/notes'); await expect(page.locator('.reader-toolbar-container.pending')).toHaveCount(0);

        await page.getByRole('button',{name:'统计',exact:true}).filter({visible:true}).click(); await expect(page.locator('.stats-review-toolbar')).toBeVisible();
        let releaseStats, startStats; const statsGate = new Promise(resolve => releaseStats = resolve), statsStarted = new Promise(resolve => startStats = resolve);
        await page.route('**/api/stats?*', async route => { startStats(); await statsGate; await route.continue().catch(() => {}); });
        const statsMonth = await page.locator('.stats-review-toolbar h2').textContent(); await page.locator('.stats-review-actions').getByRole('button',{name:'刷新',exact:true}).click(); await statsStarted;
        await expect(page.locator('.stats-review-toolbar h2')).toHaveText(statsMonth || ''); await expect(page.locator('.stats-review-toolbar.pending')).toBeVisible(); releaseStats(); await page.unroute('**/api/stats?*'); await expect(page.locator('.stats-review-toolbar.pending')).toHaveCount(0);
        await page.getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('log');
        await expect(page.locator('.workspace-view:not([hidden]) .markdown-preview')).toContainText('二月前一篇正文');
      }
      // Each failed stage retries the same URL target, never offers creation as recovery.
      for (const stage of ['months','dates','day']) {
        await page.route(patterns[stage], route => route.fulfill({ status:500, contentType:'application/json', body:JSON.stringify({error:`合成${stage}错误`}) }));
        await page.reload(); await expect(reader.locator('.workspace-state-error').first()).toBeVisible();
        if (stage === 'months') { await navigation(true); await expect(page.locator('[data-log-section="months"]')).toContainText('月份加载失败'); await navigation(false); }
        await screenshot(`${stage}-error`);
        await navigation(true); await expect(page.getByRole('button',{name:'今天',exact:true})).toBeDisabled(); await navigation(false);
        await page.unroute(patterns[stage]);
        await reader.getByRole('button',{name:'重新加载',exact:true}).filter({visible:true}).first().click();
        await ready(); assert.equal(new URL(page.url()).searchParams.get('date'),'2024-02-09');
      }
      const releaseUnselected = await gate('months');
      await page.goto(base); await expect(page.locator('.reader-log-identity h2')).toHaveText('正在加载');
      await screenshot('initial-no-date'); await releaseUnselected();
      await expect(page.locator('.markdown-preview')).toContainText('二月后一篇正文');
      await page.goto(`${base}?date=2024-02-09`); await ready();
      // A selected date remains identifiable in source/split while refresh is pending or fails.
      for (const mode of width < 1024 ? ['源码'] : ['源码','分屏']) {
        await page.getByRole('button',{name:mode,exact:true}).filter({visible:true}).click();
        await expect(page.locator('.cm-content')).toContainText('二月前一篇正文');
        const release = await gate('day');
        if (width < 1024) { await page.getByRole('button',{name:'更多日志操作',exact:true}).click(); await page.getByRole('dialog',{name:'日志操作'}).getByRole('button',{name:'刷新',exact:true}).click(); }
        else await page.getByRole('button',{name:'刷新',exact:true}).filter({visible:true}).click();
        await expect(page.locator('.reader-toolbar-container.pending')).toBeVisible();
        await expect(page.locator('.source-workspace .cm-content')).toContainText('二月前一篇正文');
        await screenshot(`${mode}-pending`); await release();
        await expect(page.locator('.cm-content')).toContainText('二月前一篇正文');
        await page.route(patterns.day, route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'合成正文错误'})}));
        if (width < 1024) { await page.getByRole('button',{name:'更多日志操作',exact:true}).click(); await page.getByRole('dialog',{name:'日志操作'}).getByRole('button',{name:'刷新',exact:true}).click(); }
        else await page.getByRole('button',{name:'刷新',exact:true}).filter({visible:true}).click();
        await expect(page.locator('.source-workspace .cm-content')).toContainText('二月前一篇正文');
        await expect(page.locator('.toast.error')).toContainText('合成正文错误'); await screenshot(`${mode}-error`);
        await page.unroute(patterns.day); await page.locator('.toast.error').getByRole('button',{name:'重试',exact:true}).evaluate(button => button.click());
        await expect(page.locator('.cm-content')).toContainText('二月前一篇正文');
      }
      await page.getByRole('button',{name:'浏览',exact:true}).filter({visible:true}).click();
      // Slow old month/date responses cannot override a later selection.
      const releaseOldDates = await gate('dates', route => new URL(route.request().url()).searchParams.get('month') === '2024-01');
      await navigation(true); await page.locator('[data-log-section="months"] .nav-item').filter({hasText:'2024-01'}).click();
      await expect(page.locator('.date-section-title.pending')).toBeVisible();
      await expect(page.locator('[data-log-section="dates"]')).toContainText('二月后一篇');
      await page.locator('[data-log-section="months"] .nav-item').filter({hasText:'2024-02'}).click(); await navigation(false);
      await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0);
      await expect(page.locator('.markdown-preview')).toContainText('二月后一篇正文'); await releaseOldDates();
      await expect(page.locator('.reader-log-identity h2')).toHaveText('2024-02-10');
      const releaseOldDay = await gate('day', route => new URL(route.request().url()).searchParams.get('date') === '2024-02-09');
      await navigation(true); await page.locator('.day-item-open').filter({hasText:'02-09'}).click();
      await navigation(true); await page.locator('.day-item-open').filter({hasText:'02-10'}).click(); await releaseOldDay();
      await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0);
      await expect(page.locator('.markdown-preview')).toContainText('二月后一篇正文');
      // Navigation cancellation keeps the unsaved draft; no write/model endpoint is permitted.
      await page.getByRole('button',{name:'源码',exact:true}).filter({visible:true}).click();
      await page.locator('.cm-content').click(); await page.locator('.cm-content').press('Control+End'); await page.keyboard.insertText('\n未保存合成草稿');
      await navigation(true); await page.locator('[data-log-section="months"] .nav-item').filter({hasText:'2024-01'}).click();
      await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click(); await navigation(false);
      await expect(page.locator('.cm-content')).toContainText('未保存合成草稿'); await screenshot('draft-retained');
      // Clean reload, then true-empty and no-heading states.
      page.once('dialog', dialog=>dialog.accept()); await page.reload(); await expect(page.locator('.markdown-preview')).toContainText('二月后一篇正文');
      await page.route(patterns.months, route=>route.fulfill({status:200,contentType:'application/json',body:'{"months":[]}'}));
      await page.goto(base); await expect(reader).toContainText('暂无学习日志');
      await expect(page.getByRole('navigation',{name:'当前日志大纲'})).toHaveCount(0);
      await navigation(true); await expect(page.getByRole('button',{name:'今天',exact:true})).toBeEnabled(); await screenshot('empty'); await navigation(false);
      await page.unroute(patterns.months);
      await page.goto(`${base}?date=2024-01-08`); await expect(page.locator('.markdown-preview')).toContainText('没有标题的普通正文');
      await expect(page.getByRole('navigation',{name:'当前日志大纲'})).toHaveCount(0); await screenshot('no-heading');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${base}?date=2024-02-09`); await ready();
      await page.getByRole('button',{name:'源码',exact:true}).filter({visible:true}).click();
      await page.getByRole('button',{name:'浏览',exact:true}).filter({visible:true}).click();
      await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0);
      assert.equal(await page.locator('.motion-segmented').filter({ visible: true }).first().evaluate(element => getComputedStyle(element, '::before').transitionDuration), '0s');
      assert.equal(await page.locator('html').evaluate(element => element.hasAttribute('data-workspace-transition')), false);
      assert.deepEqual(errors, []); assert.equal(paid,0); assert.equal(writes,0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      results.push({engine,theme,width,delayedStages:3,failedStages:3,modes:width < 1024 ? ['preview','source'] : ['preview','source','split'],rapidSwitch:true,reducedMotion:true,draftRetained:true,empty:true,noHeading:true,paid,writes});
      await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
      await context.close();
    }
  } finally { await browser.close(); }
}
console.log(JSON.stringify(results));
