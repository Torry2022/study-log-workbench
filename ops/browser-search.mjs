import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base = 'http://127.0.0.1:3561/study-log'] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local synthetic fixture required');
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
const artifacts = path.resolve('artifacts/search');
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const login = async () => {
    await page.getByLabel('访问密码').fill(env.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.workspace')).toBeVisible();
  };
  const input = () => page.getByRole('combobox', { name: '搜索全部日志', exact: true });
  const popover = () => page.locator('#global-search-popover');
  const options = () => popover().getByRole('option');
  const query = async term => {
    await input().fill(term); await input().press('Enter');
    await expect(popover()).toBeVisible();
    await expect(popover()).toHaveAttribute('aria-busy', 'false');
  };
  const source = async () => {
    await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
  };
  const edit = async () => {
    await source(); await page.locator('.cm-content').press('Control+End');
    await page.keyboard.insertText('\n\nB12未保存草稿');
  };
  await page.goto(base); await login();
  const sources = [
    ['2026-06-11', '### 1. B12Source\n\n' + '合成占位段落，用于验证首处命中定位。\n\n'.repeat(45)
      + '### 2. B12HeadingOnly\n\nB12Shared B12BodyOnly B12Case\n\n```ts\nconst B12CodeIdentifier = 1;\n// ### B12FakeTitle\n```\n\n' + '目标后的合成段落，允许首处命中滚至工具栏下方。\n\n'.repeat(25)],
    ['2026-06-12', '### 1. B12Twin\n\nB12Shared\n\nB12Destination 正文目标。']
  ];
  for (const [date, content] of sources) {
    const { day } = await (await page.request.get(base + '/api/logs/day?date=' + date)).json();
    assert.equal((await page.request.put(base + '/api/logs/day', { data: { date, content, baseVersion: day.version } })).status(), 200);
  }
  await page.goto(base + '?date=2026-06-11');
  await query('B12Shared'); await expect(options()).toHaveCount(2);
  await expect(options().first()).toContainText('2026-06-12');
  await input().press('ArrowUp'); await expect(options().last()).toHaveAttribute('aria-selected', 'true');
  await input().press('ArrowDown'); await expect(options().first()).toHaveAttribute('aria-selected', 'true');
  await input().press('Escape'); await expect(popover()).not.toBeVisible();
  await input().blur(); await input().focus(); await expect(popover()).toBeVisible();
  await page.locator('.reader-log-identity h2').click(); await expect(popover()).not.toBeVisible();

  await query('b12case'); await expect(options()).toHaveCount(1);
  await page.getByRole('button', { name: '搜索时忽略大小写，点击后区分大小写', exact: true }).click();
  await expect(popover()).toContainText('未找到匹配内容');
  await page.getByRole('button', { name: '搜索时区分大小写，点击后忽略大小写', exact: true }).click();
  await expect(options()).toHaveCount(1);
  await query('B12BodyOnly'); await expect(options()).toHaveCount(1);
  await page.getByRole('button', { name: '当前搜索标题和正文，点击后仅搜索小节标题', exact: true }).click();
  await expect(popover()).toContainText('未找到匹配的小节标题');
  await query('B12HeadingOnly'); await expect(options()).toHaveCount(1);
  await query('B12FakeTitle'); await expect(options()).toHaveCount(0);
  await page.getByRole('button', { name: '当前仅搜索小节标题，点击后搜索标题和正文', exact: true }).click();
  await expect(options()).toHaveCount(1);
  await query('B12CodeIdentifier'); await expect(options()).toHaveCount(1);
  await query('B12Shared');
  await page.screenshot({ path: path.join(artifacts, 'desktop.png') });
  await query('B12HeadingOnly'); await input().press('ArrowDown'); await input().press('Enter');
  await expect(popover()).not.toBeVisible();
  await expect(page.locator('.markdown-preview .search-hit-highlight').first()).toHaveText('B12HeadingOnly');
  await expect.poll(() => page.locator('.markdown-preview .search-hit-highlight').first().evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.markdown-preview .search-hit-highlight').first().evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(350);
  await input().fill('changed'); await expect(page.locator('.markdown-preview .search-hit-highlight')).toHaveCount(0);
  await query('B12AbsentSynthetic'); await expect(popover()).toContainText('未找到匹配内容');

  let failures = 1;
  await page.route('**/api/search?**', route => failures-- > 0 ? route.fulfill({ status: 500, json: { error: 'B12合成读取失败' } }) : route.continue());
  await query('B12Shared'); await expect(popover()).toContainText('B12合成读取失败');
  await popover().getByRole('button', { name: '重试', exact: true }).click(); await expect(options()).toHaveCount(2);
  await page.unroute('**/api/search?**');
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }); const seen = new Promise(resolve => { started = resolve; });
  await page.route('**/api/search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'B12Source') return route.continue();
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response }).catch(() => {});
  });
  await input().fill('B12Source'); await input().press('Enter'); await seen;
  await query('B12Destination'); await expect(options().first()).toContainText('2026-06-12');
  release(); await page.unroute('**/api/search?**');
  await expect(options()).toHaveCount(1); await expect(options().first()).toContainText('B12Destination');

  // Navigation must honor the parent's unsaved-draft decision.
  await input().press('Escape'); await edit(); await query('B12Destination'); await options().first().click();
  await expect(page.getByRole('alertdialog')).toContainText('未保存');
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('B12未保存草稿'); await expect(page).toHaveURL(/date=2026-06-11/);
  await input().focus();
  await options().first().click(); await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page).toHaveURL(/date=2026-06-12/); await expect(page.locator('.markdown-preview')).toContainText('B12Destination');

  await page.reload(); await input().focus(); await expect(popover()).toContainText('最近搜索');
  await expect(popover().locator('.search-history-item')).toHaveCount(8);
  await popover().getByRole('button', { name: '删除搜索记录：B12Destination', exact: true }).click();
  await expect(popover().getByRole('button', { name: '删除搜索记录：B12Destination', exact: true })).toHaveCount(0);
  await input().press('ArrowDown'); await input().press('Enter'); await expect(options().first()).toBeVisible();
  await page.getByRole('button', { name: '清空搜索', exact: true }).click(); await input().blur(); await input().focus();
  await popover().getByRole('button', { name: '清除', exact: true }).click(); await input().blur(); await input().focus(); await expect(popover()).not.toBeVisible();
  await query('B12Shared'); await page.getByRole('button', { name: '退出', exact: true }).click(); await login();
  await input().focus(); await expect(popover()).not.toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('study-log:/study-log:search-history')), null);

  await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.getByRole('button', { name: '全局搜索', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '搜索全部日志', exact: true });
  await expect(dialog).toBeVisible(); await expect(input()).toBeFocused();
  await query('B12Shared'); await expect(options()).toHaveCount(2);
  assert.equal(await page.locator('#global-search-popover').count(), 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.height <= 845);
  await page.screenshot({ path: path.join(artifacts, 'mobile.png') });
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click(); await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
  await edit(); await opener.click(); await query('B12Source'); await options().first().click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(dialog).toBeVisible(); await input().focus(); await expect(options().first()).toBeEnabled();
  await options().first().click(); await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('study-log:auth-expired')));
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('alertdialog')).not.toBeVisible(); await login();
  await expect(page.locator('.cm-content')).toContainText('B12未保存草稿');
  await expect(page).toHaveURL(/date=2026-06-12/);
  await opener.click(); await query('B12Source'); await expect(options().first()).toBeEnabled();
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Passed: literal/case/H3/code search, keyboard/result highlights, empty/error/retry/stale requests, draft cancel/confirm, persisted history/delete/clear/logout, mobile boundaries/focus and nested-confirmation auth expiry');
} catch (error) {
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); }
