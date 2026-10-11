import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base, output] = process.argv.slice(2);
if (!root || !output || !path.isAbsolute(root) || !path.isAbsolute(output) || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Explicit synthetic root, loopback URL and output required');
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch(), results = [];
try {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await context.newPage(), errors = []; let paid = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/ai/generate', route => { paid++; return route.abort(); });
    await page.route('**/api/ai/bold-highlights', route => { paid++; return route.abort(); });
    await page.goto(base);
    await page.getByLabel('访问密码').fill(env.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.workspace')).toBeVisible();
    if (width === 390) {
      await page.getByRole('button', { name: '更多设置', exact: true }).click();
      await page.getByRole('button', { name: 'AI 工具', exact: true }).click();
    } else await page.getByRole('button', { name: 'AI生成', exact: true }).filter({ visible: true }).click();
    const tabs = page.getByRole('group', { name: 'AI 工具类型' });
    const writing = tabs.getByRole('button', { name: 'AI生成', exact: true });
    const highlight = tabs.getByRole('button', { name: '重点标注', exact: true });
    await writing.click();
    const instruction = page.getByLabel('补充要求');
    await instruction.fill('仅用于检查切换后保留输入');
    const geometry = () => tabs.evaluate(element => {
      const style = getComputedStyle(element), slide = getComputedStyle(element, '::before');
      return { height: element.getBoundingClientRect().height, background: style.backgroundColor, radius: style.borderRadius,
        slide: { x: slide.transform === 'none' ? 0 : new DOMMatrix(slide.transform).m41, width: parseFloat(slide.width), background: slide.backgroundColor, radius: slide.borderRadius, shadow: slide.boxShadow, duration: slide.transitionDuration } };
    });
    await expect(writing).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await geometry()).slide.x).toBe(0);
    const first = await geometry();
    assert.equal(first.height, 46); assert.equal(first.radius, '8px'); assert.equal(first.slide.radius, '6px');
    assert.notEqual(first.slide.shadow, 'none'); assert.notEqual(first.background, first.slide.background);
    await page.locator('.writing-inspector').screenshot({ path: path.join(output, `writing-${width}-${theme}.png`) });
    await highlight.focus(); await highlight.press('Enter');
    await expect(highlight).toHaveAttribute('aria-pressed', 'true');
    await expect(writing).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.highlight-panel')).toBeVisible();
    await expect.poll(async () => { const g = await geometry(); return Math.abs(g.slide.x - g.slide.width) < 1; }).toBe(true);
    const second = await geometry();
    await page.locator('.writing-inspector').screenshot({ path: path.join(output, `highlight-${width}-${theme}.png`) });
    await writing.click(); await expect(instruction).toHaveValue('仅用于检查切换后保留输入');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal((await geometry()).slide.duration, '0s');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(paid, 0); assert.deepEqual(errors, []);
    results.push({ theme, width, first, second, draftRetained: true, keyboard: true, reducedMotion: true });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Independent Chromium inspector shared base/slider, light/dark, wide/narrow, keyboard, draft and reduced-motion checks passed.');
} finally { await browser.close(); }
