import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base = 'http://127.0.0.1:3561/study-log'] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local fixture required');
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const login = async () => { await page.getByLabel('访问密码').fill(env.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.workspace').waitFor(); };
  await page.goto(base); await login();
  const original = '### 1. 来源\n\n[[2026-04-30|不存在的日块]]\n\n[[2026-04-12#不存在的小节|缺失标题]]\n\n选区别名';
  for (const [date, content] of [['2026-04-11', original], ['2026-04-12', '### 1. 顶部\n\n' + '占位段落，检查定位。\n\n'.repeat(50) + '### 2. 目标标题\n\n可检索正文独特词\n\n' + '目标后的段落。\n\n'.repeat(20)]]) {
    const { day } = await (await page.request.get(base + '/api/logs/day?date=' + date)).json();
    assert.equal((await page.request.put(base + '/api/logs/day', { data: { date, content, baseVersion: day.version } })).status(), 200);
  }
  await page.goto(base + '?date=2026-04-11');
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  await page.locator('.cm-content').press('Control+End'); await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: '内部链接', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: '插入内部链接' });
  await expect(dialog).toContainText('显示文字：选区别名');
  const query = page.getByRole('combobox', { name: '搜索日期、小节标题或正文' });
  await query.fill('目标标题'); await expect(dialog.getByRole('option').first()).toContainText('目标标题');
  await query.press('ArrowDown'); await query.press('Enter'); await expect(dialog).not.toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('[[2026-04-12#目标标题|选区别名]]');
  await page.locator('.cm-content').press('Control+z'); await expect(page.locator('.cm-content')).not.toContainText('#目标标题|选区别名');
  await page.keyboard.press('Control+y');
  await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).click(); await expect(page.locator('.editor-save-status')).toHaveText('已保存');
  await page.getByRole('button', { name: '分屏', exact: true }).click();
  await page.getByRole('link', { name: '选区别名', exact: true }).click();
  await expect(page).toHaveURL(/date=2026-04-12/);
  const target = page.locator('.markdown-preview h3').filter({ hasText: '目标标题' });
  await expect.poll(async () => target.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(0);
  await expect.poll(async () => target.evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(300);
  await page.getByRole('button', { name: '返回链接前位置', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/date=2026-04-11/); await expect(page.getByRole('button', { name: '分屏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: '不存在的日块', exact: true }).click(); await expect(page.locator('.editor-navigation-status[role=alert]')).toHaveText('未找到目标日块'); await expect(page).toHaveURL(/date=2026-04-11/);
  await page.getByRole('link', { name: '缺失标题', exact: true }).click(); await expect(page.getByText('未找到目标小节，已打开该日日志。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回链接前位置', exact: true }).filter({ visible: true }).click();

  // Search failure retries; changing a query cancels a delayed old result.
  let failures = 1;
  await page.route('**/api/links?**', route => failures-- > 0 ? route.fulfill({ status: 500, json: { error: '合成搜索失败' } }) : route.continue());
  await page.getByRole('button', { name: '内部链接', exact: true }).filter({ visible: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('合成搜索失败'); await dialog.getByRole('button', { name: '重试', exact: true }).click(); await expect(dialog.getByRole('option').first()).toBeVisible();
  await page.unroute('**/api/links?**');
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }); const seen = new Promise(resolve => { started = resolve; });
  await page.route('**/api/links?**', async route => { if (new URL(route.request().url()).searchParams.get('query') !== '旧查询') return route.continue(); const response = await route.fetch(); started(); await gate; await route.fulfill({ response }).catch(() => {}); });
  await query.fill('旧查询'); await seen; await query.fill('独特词'); await expect(dialog.getByRole('option').first()).toContainText('目标标题'); release();
  await query.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: '内部链接', exact: true }).filter({ visible: true })).toBeFocused();
  await fs.mkdir(path.resolve('artifacts/links'), { recursive: true }); await page.screenshot({ path: path.resolve('artifacts/links/desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多日志操作', exact: true }).click(); await page.getByRole('button', { name: '内部链接', exact: true }).filter({ visible: true }).click();
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('option').first()).toBeVisible(); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => dialog.evaluate(el => el.getBoundingClientRect().right <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => dialog.evaluate(el => el.getBoundingClientRect().right <= el.parentElement.getBoundingClientRect().right - 10)).toBe(true);
  await fs.mkdir(path.resolve('artifacts/links'), { recursive: true }); await page.screenshot({ path: path.resolve('artifacts/links/mobile.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('study-log:auth-expired'))); await expect(dialog).not.toBeVisible(); await login();
  assert.deepEqual(errors, []); console.log('Passed: selection alias, keyboard insertion/undo, numbered-heading jump and return mode, missing targets, retry/cancel, mobile dialog and session cleanup');
} finally { await browser.close(); }
