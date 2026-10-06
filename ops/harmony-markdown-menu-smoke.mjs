import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const browser = await chromium.launch();
const output = resolve('artifacts/harmony-markdown-menu'); await fs.mkdir(output, {recursive:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.bridgeEvents = []; window.editorBridge = {
    message: raw => window.bridgeEvents.push(JSON.parse(raw)), imageChunk: () => false }; });
  await page.goto(pathToFileURL(resolve('study-log-harmony/entry/src/main/resources/rawfile/editor/index.html')).href);
  await page.waitForFunction(() => window.bridgeEvents.some(event => event.type === 'ready'));
  const request = async (action, extra = {}) => page.evaluate(async ({action, extra}) => {
    const requestId = window.bridgeEvents.length + 1;
    await window.editorRequest({action, documentKey:'2026-10-06:synthetic', date:'2026-10-06', requestId, ...extra});
    return window.bridgeEvents.find(event => event.type === 'result' && event.requestId === requestId);
  }, {action, extra});
  await request('load', {text:'学习内容'});
  const editor = page.locator('.cm-content'); await editor.click(); await page.keyboard.press('Control+a');
  const format = async command => request(`format:${command}`);
  await format('h3'); assert.equal((await request('snapshot')).text, '### 学习内容');
  await request('undo'); assert.equal((await request('snapshot')).text, '学习内容');
  await request('redo'); await format('paragraph'); assert.equal((await request('snapshot')).text, '学习内容');
  await editor.click(); await page.keyboard.press('Control+a'); await format('codeBlock');
  assert.equal((await request('snapshot')).text, '```\n学习内容\n```'); await request('undo');
  await format('table'); assert.match((await request('snapshot')).text, /\| --- \| --- \|/); await request('undo');
  await format('mathBlock'); assert.equal((await request('snapshot')).text, '$$\n学习内容\n$$'); await request('undo');
  await editor.dispatchEvent('compositionstart', {data:''}); await format('h4');
  await expect(editor).toHaveText('学习内容'); await editor.dispatchEvent('compositionend', {data:''});
  const invalid = await format('invalid'); assert.match(invalid.error, /不支持/);
  assert.equal(await page.locator('#date').textContent(), '## 2026-10-06');
  for (const width of [1280,390]) {
    await page.setViewportSize({width,height:800});
    assert.equal(await page.locator('#markdown-tools').count(), 0);
    assert.equal(await page.locator('#date').textContent(), '## 2026-10-06');
    await page.screenshot({path:resolve(output, `editor-${width}.png`)});
  }
  assert.deepEqual(errors, []);
  console.log('Passed: bundled Harmony native format bridge, shared formatting/undo, selection, IME, invalid command rejection, unchanged date header and 390/1280 editor.');
} finally { await browser.close(); }
