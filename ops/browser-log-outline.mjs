import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DesktopManager } from './desktop/manager.mjs';

const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const evidence = path.resolve('.local', `log-outline-${Date.now()}`);
await fs.mkdir(evidence);
const manager = new DesktopManager({ packageRoot: path.join(evidence, 'program'),
  webRoot: path.resolve('study-log-web'), mcpRoot: path.resolve('study-log-mcp') });
let browser;
try {
  await manager.select({ root: path.join(evidence, 'synthetic'), create: true, password: 'SyntheticOutlineOnly2026' });
  await manager.start();
  const base = manager.status().url;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1230, height: 820 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('访问密码').fill('SyntheticOutlineOnly2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.workspace').waitFor();
  const date = '2026-01-15';
  const read = async () => (await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json()).day;
  const initial = await read();
  assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, content: '短记录。', baseVersion: initial.version } })).status(), 200);
  const saved = await read();
  await page.goto(`${base}?date=${date}`);
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  const editor = page.locator('.cm-content');
  const draft = '### 三级标题\n\n#### 四级标题\n\n尚未保存的正文。';
  await editor.click(); await editor.press('Control+a'); await page.keyboard.insertText(draft);
  await page.getByRole('button', { name: '浏览', exact: true }).filter({ visible: true }).click();
  const outline = page.locator('.preview-outline').filter({ visible: true });
  for (const name of ['三级标题', '四级标题', '三级标题']) {
    await outline.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.editor-navigation-status')).toHaveCount(0);
    await expect(page.locator('.markdown-preview h3')).toHaveText('三级标题');
  }
  assert.equal((await read()).version, saved.version);
  await page.getByRole('button', { name: '源码', exact: true }).filter({ visible: true }).click();
  await expect.poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n')).toBe(draft);
  await page.getByRole('button', { name: '浏览', exact: true }).filter({ visible: true }).click();
  await expect(outline.getByRole('button', { name: '收藏章节：三级标题' })).toBeDisabled();
  await expect(outline.getByRole('button', { name: /收藏章节：四级标题/ })).toHaveCount(0);
  await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.day-tag.interactive')).toHaveText('三级标题');
  await expect(outline.getByRole('button', { name: '收藏章节：三级标题' })).toBeEnabled();
  await page.goto(`${base}?date=${date}&heading=不存在的小节`);
  await expect(page.locator('.editor-navigation-status')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const notice = document.querySelector('.editor-navigation-status').getBoundingClientRect();
    const pane = document.querySelector('.reader-preview-pane').getBoundingClientRect();
    return { height: notice.height, gap: pane.top - notice.bottom };
  });
  assert.ok(geometry.height < 80 && Math.abs(geometry.gap) < 2, JSON.stringify(geometry));
  await page.screenshot({ path: path.join(evidence, 'missing-section.png') });
  await page.locator('.editor-navigation-status').getByRole('button', { name: '关闭' }).click();
  await page.locator('.outline-item').filter({ hasText: '三级标题' }).click();
  await expect(page.locator('.editor-navigation-status')).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, 'draft-and-outline.png') });
  const current = await read();
  const long = `### 三级标题\n\n${Array.from({ length: 40 }, (_, i) => `合成段落 ${i + 1}。`).join('\n\n')}\n\n#### 四级标题\n\n${Array.from({ length: 20 }, (_, i) => `小节内容 ${i + 1}。`).join('\n\n')}`;
  assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, content: long, baseVersion: current.version } })).status(), 200);
  const positions = [];
  for (const width of [1230, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(`${base}?date=${date}`);
    await expect(page.locator('.markdown-preview h4')).toHaveText('四级标题');
    if (width < 1024) {
      await page.getByRole('button', { name: '更多日志操作', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: '打开日志大纲' }).filter({ visible: true }).click();
    }
    await page.locator('.preview-outline').filter({ visible: true }).getByRole('button', { name: '四级标题', exact: true }).click();
    await expect(page.locator('.editor-navigation-status')).toHaveCount(0);
    const position = await page.evaluate(() => ({ scroll: window.scrollY, target: document.querySelector('.markdown-preview h4').getBoundingClientRect().top,
      toolbarBottom: Math.max(...[...document.querySelectorAll('.reader-toolbar-container, .mobile-log-toolbar')].map(element => element.getBoundingClientRect().bottom)) }));
    assert.ok(position.scroll > 500 && position.target >= position.toolbarBottom && position.target < 400, JSON.stringify(position));
    positions.push({ width, ...position });
    await page.screenshot({ path: path.join(evidence, `outline-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ geometry, positions, passed: ['unsaved outline stays in current draft without false missing-section notice or save', 'saved sidebar updates to H3', 'only saved H3 offers favorites', 'real missing destination remains compact and dismissible', 'wide and narrow outline jumps scroll to the actual H4'], paidCalls: 0 }, null, 2));
  console.log(evidence);
} finally { await browser?.close(); await manager.shutdown(); }
