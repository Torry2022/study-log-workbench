import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserScope } from './browser-scope.mjs';

const engine = process.env.BROWSER_ENGINE || 'chromium';
{
  test(`${engine}: native QA presentation drains after done, follows final geometry, leaves history and user reading alone`, async () => {
    const browser = await createBrowserScope();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
      await page.goto(new URL('../../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url).href);
      await page.evaluate(async () => {
        window.readerFrames = { qaFollowStopped() { window.detached = true; } };
        window.message = { id: 'live', role: 'assistant', content: '', status: 'streaming', stage: '正在理解问题' };
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', 'https://synthetic-native-origin.example', 'session-a', true);
      });
      assert.equal(await page.locator('.qa-answer-pending svg').count(), 1);
      assert.equal(await page.locator('.qa-answer-pending').innerText(), '正在理解问题');
      assert.equal(await page.evaluate(() => instanceOrigin), 'https://synthetic-native-origin.example');
      await page.evaluate(async () => {
        window.message.content = '合成回答段落。'.repeat(200);
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', 'https://synthetic-native-origin.example', 'session-a', true);
      });
      await page.waitForFunction(() => document.querySelector('.qa-answer-body').textContent.length > 0);
      assert.equal(await page.locator('.qa-answer-pending').count(), 0);
      assert.equal(await page.locator('.qa-answer-actions').count(), 0);
      assert.ok(await page.locator('.qa-answer-body').evaluate(node => node.textContent.length) < 1600);
      await page.evaluate(async () => {
        window.message.content += '\n\n最终内容。'.repeat(30); window.message.status = 'complete';
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', 'https://synthetic-native-origin.example', 'session-a', true);
      });
      assert.equal(await page.locator('.qa-answer-pending').count(), 0);
      assert.equal(await page.locator('.qa-answer-actions').count(), 0);
      await page.waitForFunction(() => document.querySelector('.qa-answer-actions'));
      assert.equal(await page.locator('.qa-answer-body').innerText(), await page.evaluate(() => window.message.content.replace(/\n\n/g, '\n\n')));
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY) < 2);
      await page.evaluate(async () => {
        window.message = { id: 'next', role: 'assistant', content: '', status: 'streaming' };
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', '', 'session-b', true);
        window.message.content = '合成内容\n\n'.repeat(300);
        await window.renderMarkdown(JSON.stringify([window.message]), '', 'light', 'qa', '', 'session-b', true);
      });
      await page.waitForTimeout(80);
      await page.evaluate(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.equal(await page.evaluate(() => window.detached), true);
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await window.renderMarkdown(JSON.stringify([{ id: 'history', role: 'assistant', content: '已保存历史'.repeat(100), status: 'complete' }]), '', 'light', 'qa', '', 'history', true);
      });
      assert.equal(await page.locator('.qa-answer-pending').count(), 0);
      assert.equal(await page.locator('.qa-answer-body').innerText(), '已保存历史'.repeat(100));
      assert.equal(await page.evaluate(() => scrollY), 0);
    } finally { await browser.close(); }
  });
}
