import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

for (const engine of ['chromium', 'webkit']) for (const width of [390, 1440]) {
  test(`${engine} ${width}: explicit bottom jump resumes buffered QA following after manual reading`, async () => {
    const browser = await ({chromium,webkit})[engine].launch();
    try {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.route(/^https?:\/\//, route => route.abort());
      await page.goto(new URL('../../../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url).href);
      await page.evaluate(async () => {
        window.readerFrames = { qaFollowStopped() { window.detached = true; }, qaFollowResumed() { window.resumed = true; } };
        window.message = { id: 'live', role: 'assistant', content: '', status: 'streaming' };
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', '', 'jump', true);
        window.message.content = '合成回答段落。\n\n'.repeat(150);
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', '', 'jump', true);
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => { document.dispatchEvent(new WheelEvent('wheel', {deltaY: -200})); scrollTo(0,0); });
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(await page.evaluate(() => window.detached), true);
      await page.evaluate(async () => {
        window.message.content += '阅读时收到的正文。\n\n'.repeat(30);
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', '', 'jump', true);
      });
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => scrollY), 0, 'new output leaves manual reading alone');
      await page.evaluate(() => window.resumeQaFollow());
      await page.evaluate(async () => {
        window.message.content += '恢复跟随后新增正文。\n\n'.repeat(30);
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', '', 'jump', true);
      });
      await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight-innerHeight-scrollY)<3);
      assert.equal(await page.locator('.qa-answer-body').innerText(), await page.evaluate(() => window.message.content.trim()));
    } finally { await browser.close(); }
  });
}
