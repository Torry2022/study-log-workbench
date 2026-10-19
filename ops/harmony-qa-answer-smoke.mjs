import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, webkit } = require('playwright');
const output = path.resolve(process.env.HARMONY_QA_SCREENSHOTS || '.local/harmony-qa-answer');
await fs.mkdir(output, { recursive: true });
const citation = { sourceId: 'S1', date: '2026-09-01', heading: '合成记录', headingIndex: 0, excerpt: '<img src=x onerror=alert(1)> 合成原文' };
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
      await page.goto(pathToFileURL(path.resolve('study-log-harmony/entry/src/main/resources/rawfile/markdown/index.html')).href);
      const messages = [
        { id: 'q-A', role: 'user', content: '相同的问题' },
        { id: 'a-A2', role: 'assistant', content: '第一题的第二个回答', citations: [citation], versions: ['a-A1', 'a-A2'], versionIndex: 1, canRegenerate: false },
        { id: 'q-B', role: 'user', content: '相同的问题' },
        { id: 'a-B', role: 'assistant', content: '第二题的回答', citations: [{ ...citation, sourceId: 'S2' }], versions: ['a-B'], versionIndex: 0, canRegenerate: true }
      ];
      const render = () => page.evaluate(async ({ messages, theme }) => window.renderMarkdown(JSON.stringify(messages), '', theme, 'qa', ''), { messages, theme });
      await render();
      const answers = page.locator('.qa-message-assistant');
      assert.equal(await answers.count(), 2);
      assert.equal(await answers.nth(0).getByRole('link', { name: '重新生成', exact: true }).count(), 0);
      assert.equal(await answers.nth(1).getByRole('link', { name: '重新生成', exact: true }).count(), 1);
      const previous = answers.nth(0).getByRole('link', { name: '上一个回答版本' });
      const url = new URL(await previous.getAttribute('href'));
      assert.equal(url.searchParams.get('id'), 'a-A2'); assert.equal(url.searchParams.get('target'), 'a-A1');
      assert.equal(await answers.nth(1).getByRole('link', { name: '上一个回答版本' }).count(), 0);
      await answers.nth(0).locator('summary').click();
      assert.equal(await answers.nth(0).locator('.qa-sources img').count(), 0);
      assert.match(await answers.nth(0).locator('.qa-sources').textContent(), /<img src=x/);
      await render(); assert.equal(await answers.nth(0).locator('details[open]').count(), 1);
      assert.match(await answers.nth(0).getByRole('link', { name: '复制', exact: true }).getAttribute('href'), /id=a-A2&action=copy/);
      await answers.nth(1).locator('summary').click();
      assert.match(await answers.nth(1).getByRole('link', { name: '查看原日志' }).getAttribute('href'), /date=2026-09-01/);
      const sourceAction = answers.nth(1).getByRole('link', { name: '查看原日志' });
      if (await page.evaluate(() => CSS.supports('-webkit-tap-highlight-color', 'transparent'))) {
        assert.equal(await sourceAction.evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-tap-highlight-color')), 'rgba(0, 0, 0, 0)');
      }
      await sourceAction.hover(); await page.mouse.down();
      assert.equal(await sourceAction.evaluate(node => getComputedStyle(node).backgroundColor), await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--interaction-hover').trim()).then(value => page.evaluate(color => { const node = document.createElement('div'); node.style.color = color; document.body.append(node); const result = getComputedStyle(node).color; node.remove(); return result; }, value)));
      await page.screenshot({ path: path.join(output, `${engine}-${theme}-pressed.png`), fullPage: true });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `${engine}-${theme}.png`), fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
}
console.log('Harmony answer footer: Chromium/WebKit light/dark, scoped versions/actions, source expansion and safe text passed.');
