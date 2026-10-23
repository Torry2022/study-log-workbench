import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repo = path.resolve(import.meta.dirname, '..');
const { chromium, webkit } = createRequire(new URL('../study-log-web/package.json', import.meta.url))('@playwright/test');
const root = path.join(repo, '.local', `harmony-qa-inset-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const report = { checks: [], screenshots: [], errors: [], synthetic: true, paidCalls: 0 };
try {
  for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage();
      page.on('pageerror', error => report.errors.push(String(error)));
      await page.goto(pathToFileURL(path.join(repo, 'study-log-harmony/entry/src/main/resources/rawfile/markdown/index.html')).href);
      await page.evaluate(() => {
        window.insetEvents = [];
        window.readerFrames = { bottomInsetReady: (revision, offset) => window.insetEvents.push({ revision, offset }),
          activeHeading() {}, rendered() {}, viewportReady() {}, failed() {} };
      });
      for (const width of [390, 820, 1440]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(async theme => {
          await window.renderMarkdown(JSON.stringify([{ role: 'user', content: '合成问题' },
            { role: 'assistant', id: 'synthetic-answer', content: '合成回答段落。\n\n'.repeat(90) }]), '', theme, 'qa');
          window.originalAnswer = document.querySelector('.qa-answer-body');
        }, theme);
        for (const [revision, inset] of [[1, 132], [2, 0], [3, 196], [4, 0]]) {
          await page.evaluate(([inset, revision]) => { window.insetEvents = []; window.setReaderBottomInset(inset, revision); }, [inset, revision]);
          await page.waitForFunction(revision => window.insetEvents.some(event => event.revision === revision), revision);
          const geometry = await page.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const main = document.querySelector('main'), actions = document.querySelector('.qa-message-assistant .qa-answer-actions');
            return { viewport: innerHeight, padding: parseFloat(getComputedStyle(main).paddingBottom), footerSlot: parseFloat(getComputedStyle(main, '::after').height),
              tail: innerHeight - actions.getBoundingClientRect().bottom,
              sameBody: window.originalAnswer === document.querySelector('.qa-answer-body'), overflow: document.body.scrollWidth > innerWidth };
          });
          assert.equal(geometry.viewport, 800); assert.equal(geometry.padding, 24); assert.equal(geometry.footerSlot, inset);
          assert.ok(Math.abs(geometry.tail - inset - 41) < 2, JSON.stringify(geometry));
          assert.equal(geometry.sameBody, true); assert.equal(geometry.overflow, false);
          report.checks.push({ engine, width, theme, inset, ...geometry });
          if (width === 390 && revision <= 2) {
            const image = path.join(root, `${engine}-${theme}-${inset}.png`);
            await page.screenshot({ path: image }); report.screenshots.push(image);
          }
        }
        await page.evaluate(() => { window.setReaderBottomInset(132, 5); window.setReaderBottomInset(0, 6); });
        await page.waitForFunction(() => window.insetEvents.some(event => event.revision === 6));
        assert.equal(await page.locator('main').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom)), 24);
        await page.evaluate(theme => window.renderMarkdown('### 合成日志\n\n日志正文', '', theme, 'log'), theme);
        assert.equal(await page.locator('main').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom)), 56);
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = error.stack; throw error; }
finally { await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(root); }
