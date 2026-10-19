// Adapted from personal f106965 / d6d1cdf browser checks; only synthetic public instances.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { initialize } from './instance.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, '.local', `help-reload-${Date.now()}`), instance = path.join(root, 'instance');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const env = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
const data = path.join(instance, 'data'), sourcePath = path.join(data, '2024-04_学习日志.md');
const original = ['## 2024-04-30', '', '### 1. 合成刷新测试', '', ...Array.from({ length: 100 }, (_, i) => `段落 ${i}：仅用于隔离刷新测试，验证阅读位置和滚动区域。\n`), '### 2. 第二小节', '', '末尾正文。', '',
  ...Array.from({ length: 29 }, (_, i) => ['---', '', `## 2024-04-${String(29 - i).padStart(2, '0')}`, '', `### 1. 导航条目 ${29 - i}`, '', '合成导航资料。', '']).flat()].join('\n');
await fs.writeFile(sourcePath, original);
const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, url = `${base}?view=log&month=2024-04&date=2024-04-30`;
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const report = { root, checks: [], restores: [], screenshots: [], errors: [], paidModelCalls: 0 };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
let serverLog = '', browser, currentPage;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...safe, ...env, NODE_ENV: 'production', LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), CHAT_API_URL: '', CHAT_API_KEY: '', CHAT_MODEL: '', STUDY_LOG_MCP_URL: '', STUDY_LOG_MCP_TOKEN: '' }
});
server.stdout.on('data', value => serverLog += value); server.stderr.on('data', value => serverLog += value);
async function screenshot(page, name) { const file = path.join(root, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file); }
try {
  await expect.poll(() => fetch(base).then(response => response.ok).catch(() => false), { timeout: 30000 }).toBe(true);
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    if (process.env.VERIFY_ENGINE && process.env.VERIFY_ENGINE !== engine) continue;
    browser = await launcher.launch();
    async function open(width, theme = 'light', reducedMotion = 'no-preference') {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion });
      const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(15000);
      await page.addInitScript(theme => localStorage.setItem('study-log-theme', theme), theme);
      page.on('pageerror', error => report.errors.push(`${engine}: ${error.stack || error.message}`));
      await page.goto(url); await page.getByLabel('访问密码').fill(env.APP_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.locator('article.markdown-preview')).toContainText('合成刷新测试');
      await page.waitForLoadState('networkidle'); return { page, context };
    }
    const { page: help, context: helpContext } = await open(1440);
    await help.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).first().click();
    const editor = help.locator('.source-workspace .cm-content'); await editor.click();
    await help.keyboard.press('Control+Home'); await help.keyboard.press('Control+a'); await help.keyboard.insertText('alpha\nbeta\ngamma');
    await help.keyboard.press('Control+Home'); await help.keyboard.press('ArrowDown'); await help.keyboard.press('Alt+ArrowUp');
    await expect(editor).toHaveText('betaalphagamma'); await help.keyboard.press('Control+z'); await expect(editor).toHaveText('alphabetagamma');
    await help.keyboard.press('Control+y'); await expect(editor).toHaveText('betaalphagamma');
    await help.keyboard.press('Alt+Shift+ArrowDown'); await expect(editor).toHaveText('betabetaalphagamma');
    await help.keyboard.press('Control+Home'); await help.keyboard.press('Control+d'); await help.keyboard.press('Control+d');
    await expect(help.locator('.cm-selectionBackground')).toHaveCount(2);
    await help.keyboard.press('Control+f'); await expect(help.locator('.cm-search')).toBeVisible();
    await help.locator('.cm-search input[name="search"]').fill('beta'); await help.keyboard.press('F3'); await help.keyboard.press('Shift+F3');
    await expect(help.locator('.cm-searchMatch')).not.toHaveCount(0); await help.keyboard.press('Escape');
    await help.getByRole('button', { name: '使用帮助', exact: true }).click();
    assert.deepEqual(await help.locator('.help-shortcut-grid h4').allTextContents(), ['全局', '搜索与阅读', '源码：常用编辑', '源码：查找与选中', '源码：Markdown 排版', '知识问答']);
    await expect(help.locator('.help-shortcuts')).not.toContainText('Ctrl + Shift + ↑');
    for (const [width, theme] of [[1440, 'light'], [390, 'dark'], [320, 'light']]) {
      await help.getByRole('button', { name: '关闭帮助', exact: true }).click();
      await expect(help.getByRole('dialog', { name: '使用帮助', exact: true })).toHaveCount(0);
      await help.setViewportSize({ width: 1440, height: 900 });
      await help.getByRole('button', { name: '切换主题模式', exact: true }).click();
      await help.getByRole('group', { name: '主题模式', exact: true }).getByRole('button', { name: theme === 'dark' ? '夜间模式' : '日间模式', exact: true }).click();
      await expect(help.locator('html')).toHaveAttribute('data-theme', theme);
      await help.getByRole('button', { name: '使用帮助', exact: true }).click();
      await help.setViewportSize({ width, height: 900 }); await help.emulateMedia({ colorScheme: theme });
      await expect(help.locator('html')).toHaveAttribute('data-theme', theme);
      await help.evaluate(() => document.fonts.ready); await help.locator('.help-shortcuts').scrollIntoViewIfNeeded();
      assert.equal(await help.locator('.help-dialog-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      await screenshot(help, `${engine}-help-${width}-${theme}`);
      record(`${engine}: help ${width}/${theme}, six groups, no horizontal overflow, existing editor keys work`);
    }
    await helpContext.close();

    // Native source runtime is unchanged: verify the keys documented by cac664d against the real bundle.
    const native = await browser.newPage(); currentPage = native;
    await native.addInitScript(() => { window.messages = []; window.editorBridge = { message: raw => window.messages.push(JSON.parse(raw)), imageChunk: () => false }; });
    await native.goto(pathToFileURL(path.join(repo, 'study-log-harmony/entry/src/main/resources/rawfile/editor/index.html')).href);
    await native.waitForFunction(() => typeof window.editorRequest === 'function');
    let sequence = 0;
    const rpc = (action, extra = {}) => native.evaluate(async request => { await window.editorRequest(request); return window.messages.find(event => event.type === 'result' && event.requestId === request.requestId); }, { action, requestId: ++sequence, documentKey: 'help-native-keys', ...extra });
    await rpc('load', { date: '2024-04-30', text: 'one\nsecond\nthird' }); await rpc('focus');
    await native.keyboard.press('Alt+ArrowDown'); assert.equal((await rpc('snapshot')).text, 'second\none\nthird');
    await native.keyboard.press('Alt+Shift+ArrowDown'); assert.equal((await rpc('snapshot')).text, 'second\none\none\nthird');
    await native.keyboard.press('Control+z'); assert.equal((await rpc('snapshot')).text, 'second\none\nthird');
    await native.keyboard.press('Control+y'); assert.equal((await rpc('snapshot')).text, 'second\none\none\nthird');
    await native.close(); record(`${engine}: native bundle documented move/copy/undo/redo keys work without new bindings`);

    for (const [mode, label, width, theme] of [['preview', '浏览', 1440, 'light'], ['source', '源码', 1440, 'dark'], ['split', '分屏', 1920, 'light'], ['preview', '浏览', 390, 'light'], ['source', '源码', 390, 'dark'], ['preview', '浏览', 1440, 'dark']]) {
      const { page, context } = await open(width, theme, mode === 'split' ? 'reduce' : 'no-preference');
      await page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first().click();
      await page.waitForTimeout(600);
      const measure = () => page.evaluate(() => ({ y: scrollY, editor: document.querySelector('.source-workspace .cm-scroller')?.scrollTop || 0, preview: document.querySelector('.reader-preview-pane')?.scrollTop || 0 }));
      const sidebar = () => page.locator('.sidebar .day-item').evaluateAll(items => items.filter(item => { const rect = item.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; }).map(item => ({ text: item.textContent, top: Math.round(item.getBoundingClientRect().top) })));
      await page.evaluate(mode => { scrollTo(0, 650); if (mode !== 'preview') document.querySelector('.source-workspace .cm-scroller').scrollTop = 400; }, mode);
      await page.waitForTimeout(300); await page.evaluate(() => document.fonts.ready);
      const before = await measure(), sidebarBefore = await sidebar(); assert.ok(before.y + before.editor + before.preview > 200);
      await screenshot(page, `${engine}-${width}-${mode}-${theme}-before`);
      let release; const gate = new Promise(resolve => release = resolve);
      await page.route('**/api/logs**', async route => { await gate; await route.continue(); });
      await page.addInitScript(() => {
        window.loadingFrames = [];
        function sample() { const title = document.querySelector('.reader-toolbar-log h2'); if (title && document.documentElement.dataset.logReload === 'pending') window.loadingFrames.push({ date: title.textContent, days: document.querySelectorAll('.sidebar .day-item').length }); if (window.loadingFrames.length < 120) requestAnimationFrame(sample); }
        requestAnimationFrame(sample);
      });
      await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#log-reload-loading')).toBeVisible();
      await expect(page.locator('.reader-toolbar-log h2').first()).toHaveText('2024-04-30');
      await expect(page.locator('.reader-log-identity .eyebrow')).toHaveText('2024-04_学习日志.md');
      await expect(page.locator('body > #log-reload-loading')).toHaveCount(0);
      await expect(page.locator('#log-reload-loading')).toContainText('正在加载日志');
      await expect(page.locator('#log-reload-loading').getByText('正在加载日志', { exact: true })).toBeInViewport();
      if (width >= 1024) {
        await expect(page.locator('.sidebar .day-item')).toHaveCount(30); assert.deepEqual(await sidebar(), sidebarBefore);
        if (mode === 'preview') { await expect(page.locator('.preview-outline .outline-item')).toHaveText(['1. 合成刷新测试', '2. 第二小节']); await expect(page.locator('.preview-outline .outline-item').first()).toBeDisabled(); }
      }
      await screenshot(page, `${engine}-${width}-${mode}-${theme}-loading`); await page.waitForTimeout(350);
      const loadingFrames = await page.evaluate(() => window.loadingFrames); assert.ok(loadingFrames.length);
      assert.ok(loadingFrames.every(frame => frame.date === '2024-04-30'), 'date must be present from the first workspace frame');
      if (width >= 1024) assert.ok(loadingFrames.every(frame => frame.days === 30), 'cached navigation must be present from the first workspace frame');
      await page.evaluate(() => { window.reloadFrames = []; function sample() { if (!document.documentElement.dataset.logReload) window.reloadFrames.push({ y: scrollY, editor: document.querySelector('.source-workspace .cm-scroller')?.scrollTop || 0, preview: document.querySelector('.reader-preview-pane')?.scrollTop || 0 }); if (window.reloadFrames.length < 80) requestAnimationFrame(sample); } requestAnimationFrame(sample); });
      release(); await page.waitForFunction(() => window.reloadFrames.length >= 65);
      const frames = await page.evaluate(() => window.reloadFrames);
      assert.equal(await page.evaluate(() => history.scrollRestoration), 'manual', 'reload must preserve workspace history ownership');
      for (const frame of frames) for (const key of Object.keys(before)) assert.ok(Math.abs(frame[key] - before[key]) <= 3, `${engine}/${mode}/${width}: ${key} expected ${before[key]} got ${frame[key]}`);
      await screenshot(page, `${engine}-${width}-${mode}-${theme}-restored`);
      report.restores.push({ engine, mode, width, theme, before, first: frames[0], last: frames.at(-1), frames: frames.length, loadingFrames: loadingFrames.length });
      await page.unroute('**/api/logs**'); record(`${engine}: reload ${width}/${mode}/${theme}, first reveal and 65 frames keep position`);
      if (mode === 'preview' && width === 1440 && theme === 'light') {
        await page.locator('.sidebar .day-item.active .day-tag.interactive').filter({ hasText: '第二小节' }).click();
        await expect(page.locator('article.markdown-preview h3').filter({ hasText: '第二小节' })).toBeInViewport();
        await page.evaluate(() => scrollTo(0, 650)); await page.waitForTimeout(200);
        let releaseCancelled; const cancelledGate = new Promise(resolve => releaseCancelled = resolve);
        await page.route('**/api/logs**', async route => { await cancelledGate; await route.continue(); });
        await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#log-reload-loading')).toBeVisible();
        await page.evaluate(() => { window.cancelScrollFrames = []; const started = performance.now(); function sample() { window.cancelScrollFrames.push({ y: scrollY, active: window.__studyLogReload?.active, at: performance.now() - started }); if (performance.now() - started < 2500) requestAnimationFrame(sample); } requestAnimationFrame(sample); });
        const beforeWheel = await measure();
        await page.mouse.move(width * 0.6, 450);
        await page.mouse.wheel(0, 100); await expect(page.locator('#log-reload-loading')).toBeHidden();
        await expect.poll(async () => (await measure()).y).toBeGreaterThan(beforeWheel.y);
        await page.waitForTimeout(150);
        const cancelled = await measure(); releaseCancelled(); await expect(page.locator('article.markdown-preview')).toContainText('合成刷新测试');
        await page.waitForTimeout(1200); const afterCancel = await measure();
        (report.manualCancel ||= []).push({ engine, beforeWheel, cancelled, after: afterCancel, frames: await page.evaluate(() => window.cancelScrollFrames) });
        assert.ok(Math.abs(afterCancel.y - cancelled.y) <= 3, `manual scrolling must cancel delayed restoration: ${JSON.stringify({ cancelled, after: afterCancel })}`);
        await page.unroute('**/api/logs**');
        await page.route('**/api/logs/day?**', async route => { const response = await route.fetch(), json = await response.json(); json.day.content = json.day.content.replace('合成刷新测试', '服务端更新标题'); await route.fulfill({ response, json }); });
        await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#log-reload-loading')).toBeHidden();
        await expect(page.locator('.preview-outline .outline-item').first()).toHaveText('1. 服务端更新标题'); await expect(page.locator('.preview-outline .outline-item').first()).toBeEnabled();
        await page.unroute('**/api/logs/day?**');
        await page.route('**/api/logs**', route => route.fulfill({ status: 403, json: { error: '合成读取失败' } }));
        await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#log-reload-loading')).toBeHidden();
        await expect(page.locator('.preview-pane').getByText('合成读取失败', { exact: true })).toBeVisible(); await page.unroute('**/api/logs**');
        await page.getByRole('button', { name: '重新加载', exact: true }).click(); await expect(page.locator('article.markdown-preview')).toContainText('合成刷新测试');
        await page.route('**/api/logs/day?**', async route => { const response = await route.fetch(), json = await response.json(); json.day = { ...json.day, exists: false, content: '', headings: [] }; await route.fulfill({ response, json }); });
        await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#log-reload-loading')).toBeHidden();
        await expect(page.getByText('暂无正文', { exact: true })).toBeVisible(); await page.unroute('**/api/logs/day?**');
        record(`${engine}: normal heading navigation, manual cancel, current outline, error retry and empty day release`);
      }
      await context.close();
    }
    await browser.close(); browser = null;
  }
  assert.deepEqual(report.errors, []); assert.equal(await fs.readFile(sourcePath, 'utf8'), original); report.sourceUnchanged = true; report.passed = true;
} catch (error) {
  report.passed = false; report.errors.push(error.stack || String(error));
  if (currentPage && !currentPage.isClosed()) { await screenshot(currentPage, 'failure').catch(() => {}); await fs.writeFile(path.join(root, 'failure.html'), await currentPage.content().catch(() => '')); }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (server.exitCode === null) { const closed = once(server, 'close'); server.kill(); await closed; }
  await fs.writeFile(path.join(root, 'server.log'), serverLog); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}
