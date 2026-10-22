import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, webkit, expect } from '@playwright/test';
import { initialize } from '../../ops/instance.mjs';

const web = path.resolve(import.meta.dirname, '..');
const root = path.resolve(web, '..', '.local', `s36-motion-${Date.now()}`), instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await initialize(instance);
const source = ['## 2026-10-22', '', '### 长内容', '', ...Array.from({ length: 30 }, (_, n) => `固定尺寸采样段落 ${n}，用于检查长内容与短内容切换。\n`), '---', '', '## 2026-10-21', '', '### 短内容', '', '固定尺寸采样短段落。'].join('\n');
await fs.writeFile(path.join(data, '2026-10_学习日志.md'), source);
const socket = http.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(key)));
Object.assign(env, { NODE_ENV: 'production', LOG_ROOT: data, BACKUP_ROOT: path.join(data, '.backups'), APP_PASSWORD: 'motion-synthetic', SESSION_SECRET: 'motion-synthetic-session-32-characters-minimum', COOKIE_SECURE: 'false', CHAT_API_URL: 'http://127.0.0.1:9/chat', CHAT_API_KEY: 'synthetic-motion-key', CHAT_MODEL: 'synthetic-motion-model', DASHSCOPE_API_KEY: '', WIKI_JEV_API_KEY: '', WIKI_COMPILE_TOKEN: '' });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: web, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '', browser, page; server.stdout.on('data', chunk => serverLog += chunk); server.stderr.on('data', chunk => serverLog += chunk);
const base = `http://127.0.0.1:${port}/study-log`, report = { buildId: (await fs.readFile(path.join(web, '.next-build-cache/BUILD_ID'), 'utf8')).trim(), root, checks: [], samples: [], browserErrors: [], networkFailures: [], paidModelCalls: 0 };
let phase = 'startup';
const record = name => { report.checks.push(name); console.log('PASS ' + name); };
const exportProbe = process.argv.includes('--export-probe');
async function exportFeedback(engine) {
  phase = `${engine}: export feedback`;
  await page.evaluate(() => {
    window.s36ExportTrace = [];
    const describe = node => node instanceof Element ? { tag: node.tagName, class: node.className,
      label: node.getAttribute('aria-label'), text: node.textContent?.slice(0, 90) } : null;
    for (const name of ['pointerdown', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout']) {
      document.addEventListener(name, event => window.s36ExportTrace.push({ at: Date.now(), name,
        target: describe(event.target), related: describe(event.relatedTarget), active: describe(document.activeElement) }), true);
    }
  });
  await page.route('**/api/export?*', route => route.fulfill({ status: 503, json: { error: '合成导出反馈' } }));
  const exportStart = (report.exportRequests || []).filter(request => request.engine === engine).length;
  try {
    const exportButton = page.locator('.reader-toolbar-log .log-action-export > button').filter({ visible: true });
    if (await exportButton.count()) {
      await exportButton.click(); await page.getByRole('menuitem', { name: '当前日志', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '更多操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '导出当前日志', exact: true }).click();
    }
    await expect.poll(() => (report.exportRequests || []).filter(request => request.engine === engine).length).toBeGreaterThan(exportStart);
    await expect(page.locator('.toast')).toContainText('合成导出反馈');
    assert.equal(await page.locator('.toast').evaluate(element => getComputedStyle(element).animationName), 'toast-enter');
    await page.getByRole('button', { name: '关闭提示', exact: true }).click(); await expect(page.locator('.toast')).toHaveCount(0);
  } finally {
    (report.exportTrace ||= []).push({ engine, events: await page.evaluate(() => window.s36ExportTrace),
      dom: await page.locator('.reader-toolbar-log').evaluate(element => element.outerHTML) });
    await page.unroute('**/api/export?*');
  }
}
async function windowMotion(dialog, maximize, restore) {
  await dialog.waitFor(); await dialog.page().waitForTimeout(220);
  const rect = () => dialog.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const normal = await rect();
  for (const [name, button] of [['maximize', maximize], ['restore', restore]]) {
    const start = await rect();
    await dialog.evaluate(element => { window.s36ResizeFrames = new Promise(resolve => element.addEventListener('click', async () => {
      const frames = [], start = performance.now(); while (performance.now() - start < 320) { await new Promise(requestAnimationFrame); const r = element.getBoundingClientRect(); frames.push({ ms: performance.now() - start, width: r.width, height: r.height }); } resolve(frames);
    }, { once: true })); });
    await dialog.getByRole('button', { name: button, exact: true }).click(); const frames = await dialog.page().evaluate(() => window.s36ResizeFrames), end = await rect();
    report.samples.push({ kind: 'window-resize', name, start, end, frames });
    assert.ok(frames.some(frame => frame.width > Math.min(start.width, end.width) + 1 && frame.width < Math.max(start.width, end.width) - 1));
    assert.ok(frames.filter(frame => frame.ms >= 280).every(frame => Math.abs(frame.width - end.width) < 1 && Math.abs(frame.height - end.height) < 1));
  }
  const restored = await rect(); assert.ok(Math.abs(normal.height - restored.height) < 1); assert.ok(Math.abs(normal.width - restored.width) < 1);
}
try {
  for (let n = 0; ; n++) { try { if ((await fetch(base)).ok) break; } catch {} if (n > 100 || server.exitCode !== null) throw Error('Synthetic server failed'); await new Promise(r => setTimeout(r, 100)); }
  for (const [engine, launcher] of Object.entries(exportProbe ? { webkit } : { chromium, webkit })) {
    browser = await launcher.launch(); page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    if (exportProbe) page.setDefaultTimeout(7000);
    page.on('pageerror', error => report.browserErrors.push({ engine, phase, at: new Date().toISOString(), message: error.message, stack: error.stack }));
    page.on('requestfailed', request => report.networkFailures.push({ engine, path: new URL(request.url()).pathname, error: request.failure() }));
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/api/export')) (report.exportRequests ||= []).push({ engine, method: request.method(), url: request.url() }); });
    page.on('response', response => { if (new URL(response.url()).pathname.endsWith('/api/export')) (report.exportResponses ||= []).push({ engine, status: response.status() }); });
    await page.addInitScript(() => {
      window.s36NativeCalls = 0;
      if (document.startViewTransition) { const native = document.startViewTransition.bind(document); document.startViewTransition = update => { window.s36NativeCalls++; return native(update); }; }
      new MutationObserver(() => {
        const surface = document.querySelector('.workspace-view:not([hidden]) [data-workspace-transition-surface], .workspace-view:not([hidden]) .reader-content, .workspace-view:not([hidden]) .rag-workspace, .workspace-view:not([hidden]) .stats-shell');
        if (surface && !surface.querySelector('[data-s36-size-marker]')) {
          const marker = document.createElement('div'); marker.dataset.s36SizeMarker = 'true'; marker.textContent = '80 × 32';
          Object.assign(marker.style, { position: 'absolute', right: '4px', top: '4px', width: '80px', height: '32px', border: '1px solid currentColor', fontSize: '12px', lineHeight: '30px', textAlign: 'center', pointerEvents: 'none', zIndex: '2' });
          surface.append(marker);
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
      window.s36Sample = async () => {
        const frames = [], start = performance.now();
        while (performance.now() - start < 320) {
          await new Promise(requestAnimationFrame);
          const surface = document.querySelector('.workspace-view:not([hidden]) [data-workspace-transition-surface], .workspace-view:not([hidden]) .reader-content, .workspace-view:not([hidden]) .rag-workspace, .workspace-view:not([hidden]) .stats-shell'), style = surface && getComputedStyle(surface);
          const markers = [...document.querySelectorAll('[data-s36-size-marker]')].filter(element => element.getClientRects().length).map(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; });
          const pseudo = name => { const s = getComputedStyle(document.documentElement, `::view-transition-${name}(workspace-content)`); return { width: s.width, height: s.height, transform: s.transform, animation: s.animationName }; };
          const box = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, transform: getComputedStyle(element).transform }; };
          frames.push({ ms: performance.now() - start, markers, surface: box(surface), snapshot: box(document.querySelector('.workspace-transition-snapshot')), surfaceTransform: style?.transform, surfaceAnimation: style?.animationName, snapshotCount: document.querySelectorAll('.workspace-transition-snapshot').length,
            nativeAnimations: document.getAnimations().filter(animation => animation.effect?.pseudoElement?.includes('view-transition')).length,
            group: pseudo('group'), pair: pseudo('image-pair'), old: pseudo('old'), new: pseudo('new') });
        }
        return frames;
      };
    });
    await page.goto(base + '?date=2026-10-22'); await page.getByLabel('访问密码').fill('motion-synthetic'); await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.preview-pane .markdown-preview')).toContainText('采样段落 29');
    await page.evaluate(() => document.fonts.ready);
    if (exportProbe) {
      await page.locator('.sidebar .day-item').filter({ hasText: '10-21' }).locator('.day-item-open').click();
      await expect(page.locator('.workspace-view:not([hidden]) .preview-pane .markdown-preview')).toContainText('采样短段落');
      await page.getByRole('button', { name: '折叠日志导航', exact: true }).click();
      await page.getByRole('button', { name: '重点标注', exact: true }).filter({ visible: true }).first().click();
      await page.route('**/api/ai/bold-highlights', route => route.fulfill({ status: 503, json: { error: '合成反馈动效' } }));
      await page.getByRole('button', { name: '标注重点', exact: true }).click();
      await expect(page.locator('.writing-inspector [role="alert"]')).toContainText('合成反馈动效');
      await exportFeedback(engine); record(`${engine}: focused export request, response and Toast path`);
      await browser.close(); browser = null; continue;
    }
    for (const [width, collapsed] of [[1600, false], [1180, true]]) {
      phase = `${engine}: module roundtrips ${width}`;
      await page.setViewportSize({ width, height: 900 });
      if (collapsed) {
        for (const name of ['折叠日志导航', '折叠右侧栏']) { const button = page.getByRole('button', { name, exact: true }); if (await button.isVisible()) await button.click(); }
        await page.waitForTimeout(240);
      }
      for (const [view, name] of [['notes', '随记'], ['favorites', '收藏'], ['qa', '问答'], ['stats', '统计']]) {
        for (const direction of ['out', 'back']) {
          const nativeBefore = await page.evaluate(() => window.s36NativeCalls);
          const sample = page.evaluate(() => window.s36Sample());
          if (direction === 'out') await page.getByRole('button', { name, exact: true }).click(); else await page.getByRole('button', { name: '日志', exact: true }).filter({ visible: true }).first().click();
          if (width === 1600 && view === 'favorites') {
            for (const stage of ['start', 'middle']) {
              const before = await page.evaluate(() => document.getAnimations().map(animation => ({ name: animation.animationName, currentTime: animation.currentTime, duration: animation.effect?.getTiming().duration })));
              await page.screenshot({ path: path.join(root, `${engine}-${view}-${direction}-${stage}.png`), animations: 'allow' });
              (report.captureTimes ||= []).push({ engine, view, direction, stage, before });
            }
          }
          const frames = await sample;
          assert.equal(await page.evaluate(() => window.s36NativeCalls), nativeBefore, 'Module layout changes must never create a replaced-image snapshot');
          assert.ok(frames.some(frame => frame.markers.length));
          for (const frame of frames) {
            assert.equal(frame.nativeAnimations, 0);
            for (const marker of frame.markers) { assert.ok(Math.abs(marker.width - 80) < 0.05); assert.ok(Math.abs(marker.height - 32) < 0.05); }
            if (frame.surfaceTransform && frame.surfaceTransform !== 'none') { const values = frame.surfaceTransform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number); if (values) { assert.equal(values[0], 1); assert.equal(values[3], 1); assert.equal(values[5], 0); } }
          }
          report.samples.push({ engine, width, collapsed, view, direction, frames });
          if (width === 1600 && view === 'favorites') await page.screenshot({ path: path.join(root, `${engine}-${view}-${direction}-end.png`) });
        }
      }
      record(`${engine}: four real module roundtrips at ${width}px preserve the 80x32 marker without native image stretching`);
    }
    if (await page.getByRole('button', { name: '展开日志导航', exact: true }).isVisible()) await page.getByRole('button', { name: '展开日志导航', exact: true }).click();
    phase = `${engine}: log document and modes`;
    await page.locator('.sidebar .day-item').filter({ hasText: '10-21' }).locator('.day-item-open').click();
    await expect(page.locator('.workspace-view:not([hidden]) .preview-pane .markdown-preview')).toContainText('采样短段落');
    await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0);
    for (const mode of ['source', 'split', 'preview']) {
      const sample = page.evaluate(() => window.s36Sample());
      if (await page.locator('.log-mode-select').isVisible()) await page.locator('.log-mode-select').selectOption(mode);
      else await page.locator('.reader-toolbar-log').getByRole('button', { name: { source: '源码', split: '分屏', preview: '浏览' }[mode], exact: true }).click();
      const frames = await sample; for (const frame of frames) for (const marker of frame.markers) { assert.ok(Math.abs(marker.width - 80) < 0.05); assert.ok(Math.abs(marker.height - 32) < 0.05); }
      report.samples.push({ engine, kind: 'log-mode', mode, frames });
    }
    record(`${engine}: short log document and source/split/preview retain marker dimensions`);
    phase = `${engine}: help`;
    await page.getByRole('button', { name: '使用帮助', exact: true }).click(); await expect(page.getByRole('dialog', { name: '使用帮助' })).toBeVisible();
    assert.equal(await page.locator('.help-dialog-content').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.screenshot({ path: path.join(root, `${engine}-help.png`) }); await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '使用帮助' })).toHaveCount(0);
    record(`${engine}: help uses one surface entry direction and its existing exit`);
    phase = `${engine}: history and highlight windows`;
    await page.setViewportSize({ width: 1600, height: 900 });
    const historyButton = page.locator('.reader-toolbar-log').getByRole('button', { name: '日志历史版本', exact: true }).filter({ visible: true });
    if (!await historyButton.count()) await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('button', { name: '日志历史版本', exact: true }).filter({ visible: true }).first().click();
    await windowMotion(page.getByRole('dialog', { name: '日志历史版本', exact: true }), '最大化历史版本窗口', '还原历史版本窗口');
    await page.getByRole('button', { name: '关闭日志历史版本', exact: true }).click(); await expect(page.getByRole('dialog', { name: '日志历史版本', exact: true })).toHaveCount(0);
    if (await page.getByRole('button', { name: '展开右侧栏', exact: true }).isVisible()) await page.getByRole('button', { name: '展开右侧栏', exact: true }).click();
    await page.getByRole('button', { name: '重点标注', exact: true }).filter({ visible: true }).first().click();
    await page.route('**/api/ai/bold-highlights', route => route.fulfill({ status: 503, json: { error: '合成反馈动效' } }));
    await page.getByRole('button', { name: '标注重点', exact: true }).click(); await expect(page.locator('.writing-inspector [role="alert"]')).toContainText('合成反馈动效');
    await exportFeedback(engine);
    await page.unroute('**/api/ai/bold-highlights');
    await page.route('**/api/ai/bold-highlights', route => route.fulfill({ json: { result: { content: route.request().postDataJSON().content.replace('固定尺寸采样短段落。', '**固定尺寸采样短段落。**'), model: 'synthetic', boldCount: 1, warnings: [] } } }));
    await page.getByRole('button', { name: '标注重点', exact: true }).click();
    await windowMotion(page.getByRole('dialog', { name: 'AI 重点标注差异查看' }), '最大化重点标注窗口', '还原重点标注窗口');
    await page.getByRole('dialog', { name: 'AI 重点标注差异查看' }).getByRole('button', { name: '关闭差异查看', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'AI 重点标注差异查看' })).toHaveCount(0);
    await page.unroute('**/api/ai/bold-highlights');
    record(`${engine}: history/highlight windows animate both resize directions; error Toast enters and exits without a model call`);
    phase = `${engine}: menu and Wiki`;
    await page.getByRole('button', { name: '切换主题模式', exact: true }).click();
    const menu = page.getByRole('group', { name: '主题模式', exact: true }); await expect(menu).toBeVisible();
    assert.equal(await menu.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
    record(`${engine}: theme menu hit-testing remains usable`);
    const backToLog = page.getByRole('button', { name: '日志', exact: true }).filter({ visible: true });
    if (await backToLog.count()) await backToLog.first().click();
    const count = await page.evaluate(() => window.s36NativeCalls);
    for (const name of ['进入阅读模式', '退出阅读']) { await page.getByRole('button', { name, exact: true }).click(); await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('reading-mode-transition'))).toBe(false); }
    if (engine === 'chromium') assert.equal(await page.evaluate(() => window.s36NativeCalls), count + 2);
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByLabel('打开日志导航', { exact: true }).click();
    await expect(page.locator('.sidebar.mobile-open')).toBeVisible(); await page.locator('.sidebar.mobile-open').getByLabel('关闭日志导航', { exact: true }).click(); await page.waitForTimeout(240);
    await page.getByRole('button', { name: '统计', exact: true }).filter({ visible: true }).first().click();
    await expect(page.locator('.stats-review-actions').getByRole('button', { name: '分类管理', exact: true })).toHaveCount(0);
    await page.getByLabel('打开统计导航', { exact: true }).click();
    await page.locator('.sidebar.mobile-open').getByRole('button', { name: '分类管理', exact: true }).click(); await expect(page.locator('.taxonomy-manager')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    record(`${engine}: mobile drawer opens/closes and statistics keeps one reachable sidebar category entry`);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    assert.equal(await page.locator('.workspace-view:not([hidden]) [data-workspace-transition-surface], .workspace-view:not([hidden]) .reader-content, .workspace-view:not([hidden]) .rag-workspace, .workspace-view:not([hidden]) .stats-shell').first().evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await page.evaluate(() => document.querySelector('.workspace-transition-snapshot') !== null), false);
    record(`${engine}: reading entry/exit remains separate; reduced motion switches immediately`);
    await browser.close(); browser = null;
  }
  assert.equal(await fs.readFile(path.join(data, '2026-10_学习日志.md'), 'utf8'), source);
  report.layoutNotices = report.browserErrors.filter(error => error.message === 'ResizeObserver loop completed with undelivered notifications.');
  assert.deepEqual(report.browserErrors.filter(error => error.message !== 'ResizeObserver loop completed with undelivered notifications.'), [], 'Unexpected uncaught browser errors');
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.stack || String(error); if (page && !page.isClosed()) await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
finally {
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog);
  await browser?.close().catch(() => {}); if (server.exitCode === null) { const closed = once(server, 'close'); server.kill(); await closed; }
  console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}
