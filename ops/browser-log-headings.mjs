import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DesktopManager } from './desktop/manager.mjs';

const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `log-headings-${Date.now()}`);
await fs.mkdir(evidence);
const root = path.join(evidence, 'synthetic');
const manager = new DesktopManager({ packageRoot: path.join(evidence, 'program'),
  webRoot: path.resolve('study-log-web'), mcpRoot: path.resolve('study-log-mcp') });
let browser;
try {
  await manager.select({ root, create: true, password: 'SyntheticHeadingsOnly2026' });
  await manager.start();
  const base = manager.status().url;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('访问密码').fill('SyntheticHeadingsOnly2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.workspace').waitFor();
  const date = '2026-01-15';
  const read = async () => (await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json()).day;
  const initial = await read();
  assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, content: '### 已保存\n\n保留正文', baseVersion: initial.version } })).status(), 200);
  const original = await read();
  const sourcePath = path.join(root, 'data', original.fileName);
  const originalBytes = await fs.readFile(sourcePath);
  await page.goto(`${base}?date=${date}`);
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  const editor = page.locator('.cm-content');
  const replace = async text => {
    await editor.click(); await editor.press('Control+a'); await page.keyboard.insertText(text);
  };
  const passed = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const body of ['# 标题', '标题\n===', '标题\n---', '##']) {
      await replace(body);
      await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).click();
      const response = await page.request.put(`${base}/api/logs/day`, { data: { date, content: body, baseVersion: original.version } });
      assert.equal(response.status(), 400);
      const { error } = await response.json();
      await expect(page.locator('.toast.error')).toHaveText(error);
      await expect.poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n')).toBe(body);
      assert.equal((await read()).version, original.version);
      assert.deepEqual(await fs.readFile(sourcePath), originalBytes);
    }
    passed.push(`${width}px: ATX/Setext heading rejection, visible explanation, draft and source retained`);
  }
  const valid = '几句话的记录。\n\n### 小节\n\n#### 层次\n\n```markdown\n# 示例\n示例\n===\n```';
  await replace(valid);
  await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.toast.success')).toHaveText('已保存');
  assert.equal((await read()).content, `## ${date}\n\n${valid}`);
  passed.push('corrected draft saves normally; short paragraph, H3/H4 and code examples retained');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(evidence, 'narrow-saved.png') });
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed, paidCalls: 0 }, null, 2));
  console.log(evidence);
} finally {
  await browser?.close();
  await manager.shutdown();
}
