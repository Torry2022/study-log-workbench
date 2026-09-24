import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('study-log-harmony/entry/src/main/resources/rawfile/editor/backup.html')).href);
  await page.evaluate(() => window.renderBackup('第一行\n旧内容', '第一行\n新内容<script>alert(1)</script>', false, '09-24 10:00'));
  assert.equal(await page.locator('header small').last().textContent(), '09-24 10:00');
  assert.match(await page.locator('main').innerText(), /新内容<script>alert\(1\)<\/script>/);
  assert.equal(await page.locator('main script').count(), 0, 'historical Markdown must remain text in the diff viewer');
  await page.evaluate(() => window.renderBackup('当前', '历史', true));
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  process.stdout.write('Harmony backup diff rendering and text safety passed\n');
} finally { await browser.close(); }
