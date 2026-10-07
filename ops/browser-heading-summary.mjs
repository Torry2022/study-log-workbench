import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initialize, acquireInstanceLock } from './instance.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const root = path.join(repository, '.local', `heading-summary-${Date.now()}`);
await initialize(root);
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
const data = path.join(root, 'data'), date = '2026-01-15';
const content = ['## ' + date, '', '### 未编号小节', '合成资料。', '#### 内部标题', '',
  ...Array(24).fill('合成段落，用于检查小节定位。\n'), '### 2. 编号小节', '编号正文。', '',
  ...Array(24).fill('合成段落，用于检查小节定位。\n'), '### 3D 与 HTTP/2', '末尾正文。', '',
  ...Array(24).fill('合成段落，用于保留滚动空间。\n')].join('\n');
const file = path.join(data, '2026-01_学习日志.md');
await fs.writeFile(file, content);
const release = await acquireInstanceLock(data, 'heading-summary-browser');
const port = '3579', base = `http://127.0.0.1:${port}/study-log`;
const worker = fork(path.join(repository, 'ops/desktop/worker.mjs'), ['web', path.join(repository, 'study-log-web')], {
  env: { ...process.env, ...env, PORT: port, LOG_ROOT: data, BACKUP_ROOT: path.join(root, 'backups'), NODE_ENV: 'production' },
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
});
const exited = once(worker, 'exit');
let browser;
try {
  await Promise.race([once(worker, 'message'), exited.then(() => { throw Error('Web worker exited before ready'); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Web readiness timeout')), 30000); timer.unref(); })]);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}?date=${date}`);
  await page.getByLabel('访问密码').fill(env.APP_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const tags = page.locator('.day-tag.interactive');
  await expect(tags).toHaveText(['未编号小节', '编号小节', '3D 与 HTTP/2']);
  await expect(page.locator('.topbar')).toContainText('未编号小节 / 编号小节 / 3D 与 HTTP/2');
  for (const [index, text] of ['未编号小节', '2. 编号小节', '3D 与 HTTP/2'].entries()) {
    await tags.nth(index).click();
    const heading = page.locator('.markdown-preview h3').filter({ hasText: text });
    await expect.poll(() => heading.evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeGreaterThan(0);
    await expect.poll(() => heading.evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThan(350);
  }
  await tags.first().click();
  await page.getByRole('button', { name: '收藏章节：未编号小节', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏：未编号小节', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const search = page.getByRole('combobox', { name: '搜索全部日志', exact: true });
  await search.fill('未编号小节'); await search.press('Enter');
  await expect(page.locator('#global-search-popover')).toContainText('未编号小节');
  await search.press('Escape'); await search.blur();
  await page.screenshot({ path: path.join(root, 'wide.png') });
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator('.markdown-preview h3').first()).toHaveText('未编号小节');
  await page.screenshot({ path: path.join(root, 'compact.png') });
  assert.equal(await fs.readFile(file, 'utf8'), content);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, checks: ['sidebar and topbar labels', 'mixed H3 index navigation', 'outline favorite', 'search', 'source bytes unchanged'], screenshots: ['wide.png', 'compact.png'] }, null, 2));
  console.log(`Passed heading-summary browser checks: ${root}`);
} finally {
  await browser?.close();
  if (worker.connected) worker.send({ type: 'stop' });
  const [code] = await exited;
  if (code === 0) await release();
  else throw Error('Web worker did not stop normally; instance lock retained');
}
