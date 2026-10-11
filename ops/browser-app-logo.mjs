import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base, output] = process.argv.slice(2);
if (!root || !output || !path.isAbsolute(root) || !path.isAbsolute(output) || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Explicit synthetic directory, local URL and screenshot directory required');
const environment = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole('button', { name: '登录', exact: true }).waitFor();
    const check = async (stage, expectedSize) => {
      await page.evaluate(() => document.fonts.ready);
      const logo = page.locator('.theme-logo').first();
      const geometry = await logo.evaluate(async element => {
        await Promise.all([...element.querySelectorAll('img')].map(image => image.decode()));
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, radius: style.borderRadius, border: style.boxShadow, background: style.backgroundColor,
          images: [...element.querySelectorAll('img')].map(image => ({ src: image.getAttribute('src'), opacity: getComputedStyle(image).opacity, width: image.naturalWidth })) };
      });
      assert.equal(geometry.background, theme === 'light' ? 'rgb(250, 249, 245)' : 'rgb(28, 26, 23)');
      assert.equal(geometry.width, expectedSize); assert.equal(geometry.height, expectedSize);
      assert.equal(geometry.radius, stage === 'login' ? '11px' : '6px');
      assert.match(geometry.border, /inset/);
      assert.ok(geometry.images.every(image => image.width === 1024));
      assert.equal(geometry.images.find(image => image.src.includes(`logo-${theme}`)).opacity, '1');
      const icons = await page.locator('link[rel="icon"]').evaluateAll(links => links.filter(link => !link.media || matchMedia(link.media).matches).map(link => link.href));
      assert.ok(icons.some(icon => icon.endsWith(theme === 'dark' ? '/icon-dark.svg' : '/icon.svg')));
      assert.ok(!icons.some(icon => icon.endsWith(theme === 'dark' ? '/icon.svg' : '/icon-dark.svg')));
      for (const icon of icons) assert.equal((await page.request.get(icon)).status(), 200);
      await page.screenshot({ path: path.join(output, `${stage}-${width}-${theme}.png`) });
      if (expectedSize) await logo.screenshot({ path: path.join(output, `${stage}-logo-${width}-${theme}.png`) });
      results.push({ stage, width, theme, geometry, icons });
    };
    await check('login', 52);
    await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.workspace').waitFor();
    await expect(page.locator('.markdown-preview')).toContainText('欢迎使用学习日志工作台');
    // The existing narrow workspace hides the brand, while the login keeps its Logo.
    await check('workspace', width === 390 ? 0 : 32);
    assert.deepEqual(errors, []);
    await context.close();
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Independent Chromium login/workspace wide/narrow light/dark Logo and favicon checks passed.');
} finally { await browser.close(); }
