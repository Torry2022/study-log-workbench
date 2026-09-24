import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.bridgeEvents = [];
    window.editorBridge = { message: raw => window.bridgeEvents.push(JSON.parse(raw)), imageChunk: () => false };
  });
  await page.goto(pathToFileURL(resolve('study-log-harmony/entry/src/main/resources/rawfile/editor/index.html')).href);
  await page.waitForFunction(() => window.bridgeEvents.some(event => event.type === 'ready'));
  await page.evaluate(() => window.editorRequest({ action: 'load', documentKey: '2026-09-24:v1',
    requestId: 1, date: '2026-09-24', text: '### 合成小节\n\n原文' }));
  await page.waitForFunction(() => window.bridgeEvents.some(event => event.type === 'result' && event.requestId === 1));
  const snapshot = await page.evaluate(async () => {
    await window.editorRequest({ action: 'snapshot', documentKey: '2026-09-24:v1', requestId: 2 });
    return window.bridgeEvents.find(event => event.type === 'result' && event.requestId === 2);
  });
  assert.equal(snapshot.text, '### 合成小节\n\n原文');
  assert.equal(await page.locator('#date').textContent(), '## 2026-09-24');
  await page.locator('.cm-content').fill('### 合成小节\n\n新稿');
  await page.waitForFunction(() => window.bridgeEvents.some(event => event.type === 'dirty'));
  const changed = await page.evaluate(async () => {
    await window.editorRequest({ action: 'snapshot', documentKey: '2026-09-24:v1', requestId: 3 });
    return window.bridgeEvents.find(event => event.type === 'result' && event.requestId === 3);
  });
  assert.equal(changed.text, '### 合成小节\n\n新稿');
  await page.close();
  process.stdout.write('editor load and snapshot passed\n');
} finally { await browser.close(); }
