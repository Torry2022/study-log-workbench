import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base = 'http://127.0.0.1:3560/study-log'] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Explicit local synthetic instance required');
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
const source = path.join(root, 'data', '2026-02_学习日志.md');
const before = await fs.readFile(source, 'utf8');
const backupNames = await fs.readdir(path.join(root, 'backups'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '?date=2026-02-05');
  await page.getByLabel('访问密码').fill(env.APP_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.markdown-preview')).toContainText('并发控制');
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.press('Control+End');
  await page.keyboard.insertText('\n\n### 2. 并发控制\n\n重复标题验收');
  const toolbarBottom = await page.locator('.reader-toolbar-log').evaluate(element => element.getBoundingClientRect().bottom);
  const response = page.waitForResponse(reply => reply.url().endsWith('/api/logs/day') && reply.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).click();
  assert.equal((await response).status(), 400);
  await expect(page.locator('.toast.error')).toContainText('同一天不能保存两个“并发控制”小节');
  await expect(editor).toContainText('重复标题验收');
  assert.equal(await page.locator('.reader-toolbar-log').evaluate(element => element.getBoundingClientRect().bottom), toolbarBottom);
  assert.equal(await fs.readFile(source, 'utf8'), before);
  assert.deepEqual(await fs.readdir(path.join(root, 'backups')), backupNames);
  console.log('Passed: duplicate heading rejected with fixed toast, draft retained, toolbar and source unchanged');
} finally {
  await browser.close();
}
