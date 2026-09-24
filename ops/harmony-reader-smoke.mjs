import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const seen = [];
await page.route('https://one.example/**', route => {
  seen.push({ url: route.request().url(), authorization: route.request().headers().authorization });
  route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />' });
});
await page.route('https://outside.example/**', route => {
  seen.push({ url: route.request().url(), authorization: route.request().headers().authorization });
  route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />' });
});
await page.route('https://two.example/**', route => {
  seen.push({ url: route.request().url(), authorization: route.request().headers().authorization });
  route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />' });
});
await page.goto(pathToFileURL(resolve('study-log-harmony/entry/src/main/resources/rawfile/markdown/index.html')).href);
await page.evaluate(async () => {
  await window.renderMarkdown('## 2026-09-24\n\n### 合成小节\n\n公式 $a^2+b^2=c^2$。\n\n![本地](assets/demo.svg)\n\n![外部](https://outside.example/demo.svg)',
    'synthetic-token', 'light', 'log', 'https://one.example');
});
await page.waitForTimeout(300);
assert.equal(await page.locator('h3').textContent(), '合成小节');
assert.equal(await page.locator('.katex').count(), 1);
assert(seen.some(entry => entry.url === 'https://one.example/study-log/api/assets/demo.svg' &&
  entry.authorization === 'Bearer synthetic-token'), 'own-instance asset must use the current token');
assert(seen.some(entry => entry.url === 'https://outside.example/demo.svg' && !entry.authorization),
  'external image must not receive the current token');
await page.evaluate(async () => {
  await window.renderMarkdown('![另一个实例](assets/second.svg)', 'second-token', 'dark', 'log', 'https://two.example');
});
assert(seen.some(entry => entry.url === 'https://two.example/study-log/api/assets/second.svg' &&
  entry.authorization === 'Bearer second-token'), 'switching instance must change image origin and token');
await browser.close();
process.stdout.write('reader origin and token isolation passed\n');
