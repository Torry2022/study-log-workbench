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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const file = { name: 'fixture.png', mimeType: 'image/png', buffer: png };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const login = async () => { await page.getByLabel('访问密码').fill(env.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.workspace').waitFor(); };
  const source = async () => { await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click(); await expect(page.locator('.cm-content')).toBeVisible(); };
  const replace = async text => { await page.locator('.cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text); };
  const discard = async () => { await page.getByRole('button', { name: '放弃修改', exact: true }).filter({ visible: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改', exact: true }).click(); await expect(page.getByRole('alertdialog')).not.toBeVisible(); };
  const delayUpload = async () => {
    let release, seen;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { seen = resolve; });
    const handler = async route => { const response = await route.fetch(); seen(); await gate; await route.fulfill({ response }).catch(() => {}); };
    await page.route('**/api/assets/upload', handler);
    return { started, async release() { release(); await page.unroute('**/api/assets/upload', handler); } };
  };
  await page.goto(base); await login();
  for (const date of ['2026-03-11', '2026-03-12']) {
    const current = await (await page.request.get(base + '/api/logs/day?date=' + date)).json();
    const response = await page.request.put(base + '/api/logs/day', { data: { date, content: '### 1. 附件验收\n\n保留的已保存正文', baseVersion: current.day.version } });
    assert.equal(response.status(), 200);
  }
  await page.goto(base + '?date=2026-03-11'); await source();
  await replace('### 1. 附件验收\n\n开始');
  const delayed = await delayUpload();
  await page.getByLabel('选择日志图片').setInputFiles(file); await delayed.started;
  await page.locator('.cm-content').press('Control+End'); await page.keyboard.insertText('上传期间的新输入');
  await page.keyboard.press('Control+Home'); await page.keyboard.insertText('前置文字\n');
  await delayed.release(); await expect(page.locator('.editor-attachment-status')).toContainText('已插入 1 张图片');
  await expect(page.locator('.cm-content')).toContainText('上传期间的新输入');
  await expect(page.locator('.cm-content')).toContainText('前置文字');
  await expect(page.locator('.cm-content')).toContainText('./assets/image-');
  await page.keyboard.press('Control+z'); await expect(page.locator('.cm-content')).not.toContainText('./assets/image-');
  await expect(page.locator('.cm-content')).toContainText('上传期间的新输入');
  await page.keyboard.press('Control+y');
  await page.getByRole('button', { name: '浏览', exact: true }).filter({ visible: true }).click();
  await expect.poll(() => page.locator('.markdown-preview img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await source(); await discard();

  // Real File/DataTransfer events exercise the two non-picker entrypoints.
  for (const kind of ['paste', 'drop']) {
    await page.locator('.cm-content').press('Control+End');
    await page.locator('.cm-content').evaluate((element, { kind, bytes }) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'transfer.png', { type: 'image/png' }));
      const event = kind === 'paste' ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
    }, { kind, bytes: [...png] });
    await expect(page.locator('.cm-content')).toContainText('./assets/image-'); await discard();
  }
  await page.getByLabel('选择日志图片').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('.editor-attachment-status[role=alert]')).toBeVisible();
  await expect(page.locator('.cm-content')).not.toContainText('./assets/image-');

  // A same-day reset must cancel a pending caret insertion.
  await replace('### 1. 未保存的草稿');
  const reset = await delayUpload(); await page.getByLabel('选择日志图片').setInputFiles(file); await reset.started;
  await discard(); await reset.release();
  await expect(page.locator('.cm-content')).toContainText('保留的已保存正文');
  await expect(page.locator('.cm-content')).not.toContainText('./assets/image-');

  const switching = await delayUpload(); await page.getByLabel('选择日志图片').setInputFiles(file); await switching.started;
  await expect(page.locator('.editor-save-status')).not.toBeVisible();
  await page.locator('.day-item').filter({ hasText: '2026-03-12' }).click(); await expect(page.locator('.editor-date-line')).toContainText('2026-03-12');
  await switching.release(); await expect(page.locator('.cm-content')).not.toContainText('./assets/image-');
  const expired = await delayUpload(); await page.getByLabel('选择日志图片').setInputFiles(file); await expired.started;
  await page.evaluate(() => window.dispatchEvent(new Event('study-log:auth-expired'))); await expired.release(); await login();
  await expect(page.locator('.cm-content')).not.toContainText('./assets/image-');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多日志操作', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '插入图片', exact: true }).filter({ visible: true }).click();
  await (await chooser).setFiles(file); await expect(page.locator('.cm-content')).toContainText('./assets/image-');
  await fs.mkdir(path.resolve('artifacts/attachments'), { recursive: true });
  await page.screenshot({ path: path.resolve('artifacts/attachments/mobile.png') });
  assert.deepEqual(errors, []);
  console.log('Passed: picker/paste/drop, authenticated rendering, mapped insertion/isolated undo, invalid format, reset/switch/expiry cancellation, mobile picker');
} finally { await browser.close(); }
