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
  const command = async (request) => {
    await page.evaluate(request => window.editorRequest(request), request);
    await page.waitForFunction(id => window.bridgeEvents.some(event => event.type === 'result' && event.requestId === id), request.requestId);
    return page.evaluate(id => window.bridgeEvents.find(event => event.type === 'result' && event.requestId === id), request.requestId);
  };
  await command({ action: 'load', documentKey: '2026-09-24', requestId: 1, date: '2026-09-24', text: '### 合成段落\n\n原文' });
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  const target = await command({ action: 'capture', documentKey: '2026-09-24', requestId: 2 });
  assert.equal(target.documentKey, '2026-09-24');
  assert.ok(target.bookmark);
  await command({ action: 'insert', documentKey: target.documentKey, requestId: 3,
    text: '[[2026-09-21#合成链接目标|参考]]', from: target.from, to: target.to,
    expectedRevision: target.revision, bookmark: target.bookmark });
  const saved = await command({ action: 'snapshot', documentKey: '2026-09-24', requestId: 4 });
  assert.match(saved.text, /\[\[2026-09-21#合成链接目标\|参考\]\]/);
  process.stdout.write('Harmony editor captured and inserted an internal link at the selected position\n');
} finally { await browser.close(); }
