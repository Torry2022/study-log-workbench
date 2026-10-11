import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base, output] = process.argv.slice(2);
if (!root || !output || !path.isAbsolute(root) || !path.isAbsolute(output) || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Explicit synthetic root, loopback URL and output required');
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch(), results = [];
try {
  for (const theme of ['light', 'dark']) for (const width of [2000, 1440, 1920, 2100, 2400]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByLabel('访问密码').fill(env.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.markdown-preview')).toBeVisible();
    for (const mode of ['浏览', '源码', '分屏']) {
      await page.getByRole('button', { name: mode, exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: 'AI生成', exact: true }).filter({ visible: true }).click();
      await expect(page.getByRole('button', { name: '折叠右侧栏', exact: true })).toBeVisible();
      const geometry = () => page.locator('.reader-toolbar-log').evaluate(element => {
        const rect = element.getBoundingClientRect(), title = element.querySelector('.reader-log-identity h2').getBoundingClientRect();
        const save = element.querySelector('.toolbar-save-button').getBoundingClientRect();
        const style = getComputedStyle(element);
        return { height: rect.height, titleTop: title.top, saveTop: save.top, padding: [style.paddingTop, style.paddingBottom] };
      });
      const settle = () => page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(resolve));
        await Promise.all(document.querySelector('.workspace').getAnimations().map(animation => animation.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      await settle();
      const expanded = await geometry();
      await page.getByRole('button', { name: '折叠右侧栏', exact: true }).click();
      await expect(page.getByRole('button', { name: '展开右侧栏', exact: true })).toBeVisible();
      await settle();
      const collapsed = await geometry();
      results.push({ theme, width, mode, expanded, collapsed });
      await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
      await page.screenshot({ path: path.join(output, `${theme}-${width}-${mode}.png`) });
      for (const key of ['height', 'titleTop', 'saveTop']) assert.ok(Math.abs(expanded[key] - collapsed[key]) < 0.5, `Inspector collapse shifts ${key}: ${JSON.stringify(results.at(-1))}`);
    }
    await context.close();
  }
  console.log('Inspector collapse keeps toolbar height, title and save position in preview/source/split, five widths and both themes.');
} finally { await browser.close(); }
