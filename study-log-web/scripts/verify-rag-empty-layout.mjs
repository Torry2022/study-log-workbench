import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Run against an isolated build. All API responses are synthetic; no model or data writes.
const origin = new URL(process.env.RAG_LAYOUT_ORIGIN || 'http://127.0.0.1:3724/study-log');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname), 'use a loopback test instance');
const root = process.env.RAG_LAYOUT_OUTPUT;
assert.ok(root, 'set RAG_LAYOUT_OUTPUT to an isolated evidence directory');
await fs.mkdir(root, { recursive: true });
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const results = [];
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  try {
    for (const viewport of [{ width: 1912, height: 948 }, { width: 1440, height: 900 },
      { width: 1280, height: 720 }, { width: 1280, height: 600 }, { width: 390, height: 844 }]) {
      for (const configured of [true, false]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/**', async route => {
          const request = route.request(), pathname = new URL(request.url()).pathname;
          assert.equal(request.method(), 'GET', 'empty conversation never writes or calls a model');
          let value = {};
          if (pathname.endsWith('/auth/me')) value = { authenticated: true };
          else if (pathname.endsWith('/logs/months')) value = { months: [] };
          else if (pathname.endsWith('/logs')) value = { days: [] };
          else if (pathname.endsWith('/favorites')) value = { favorites: [], groups: [] };
          else if (pathname.endsWith('/capabilities')) value = { instanceId: 'synthetic-layout-instance', features: {
            aiWriting: { supported: false, configured: false }, aiHighlighting: { supported: false, configured: false },
            aiNoteExtraction: { supported: false, configured: false }, aiTaxonomy: { supported: false, configured: false },
            rag: { supported: true, configured, issues: configured ? [] : [{ message: '合成配置未就绪' }] },
            ragTasks: { supported: false, configured: false } } };
          else if (pathname.endsWith('/rag/sessions')) value = { sessions: [] };
          else if (pathname.endsWith('/rag/tasks')) value = { tasks: [] };
          else if (pathname.endsWith('/notes')) value = { notes: [] };
          else if (pathname.includes('/rag/')) value = { configured };
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
        });
        try {
          await page.goto(origin.href + '?view=qa');
          const workspace = page.locator('.rag-workspace').filter({ visible: true });
          await expect(workspace).toBeVisible();
          await expect(workspace.locator('.rag-empty')).toBeVisible();
          await page.waitForTimeout(400);
          for (const collapsed of [false, true]) {
            if (viewport.width >= 1024 && collapsed) {
              await page.getByRole('button', { name: '折叠问答历史', exact: true }).first().click();
              await page.waitForTimeout(250);
            }
            await page.evaluate(() => scrollTo(0, 0));
            const geometry = await workspace.evaluate(element => {
              const composer = element.querySelector('.rag-composer-slot').getBoundingClientRect();
              const sidebar = document.querySelector('.qa-sidebar').getBoundingClientRect();
              const topbar = document.querySelector('.topbar').getBoundingClientRect();
              return { viewport: innerHeight, scrollHeight: document.documentElement.scrollHeight,
                composerTop: composer.top, composerBottom: composer.bottom, sidebarHeight: sidebar.height, topbarHeight: topbar.height };
            });
            const label = `${engine}-${viewport.width}x${viewport.height}-${configured ? 'ready' : 'unconfigured'}-${collapsed ? 'collapsed' : 'expanded'}`;
            await page.screenshot({ path: path.join(root, label + '.png') });
            results.push({ label, geometry });
            assert.ok(geometry.composerTop >= 0 && geometry.composerBottom <= geometry.viewport + 1,
              `${label}: complete composer fits the viewport: ${JSON.stringify(geometry)}`);
            assert.ok(geometry.scrollHeight <= geometry.viewport + 1, `${label}: empty conversation needs no page scroll`);
          }
          const guidance = workspace.locator('.rag-conversation');
          await guidance.evaluate(element => { element.scrollTop = element.scrollHeight; });
          const lastAction = guidance.getByRole('button').last();
          if (await lastAction.count()) {
            const action = await lastAction.boundingBox(), region = await guidance.boundingBox();
            assert.ok(action && region && action.y + action.height <= region.y + region.height + 1,
              'overflowing guidance remains reachable without covering the composer');
          }
          await guidance.evaluate(element => { element.scrollTop = 0; });
          await page.getByRole('textbox', { name: '输入知识库问题', exact: true }).fill(
            Array.from({ length: 12 }, (_, index) => `合成输入第${index + 1}行`).join('\n'));
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
          const expanded = await workspace.locator('.rag-composer-slot').boundingBox();
          assert.ok(expanded && expanded.y >= 0 && expanded.y + expanded.height <= viewport.height + 1,
            'a multiline draft keeps the whole composer in the viewport');
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
          const draftGeometry = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight,
            viewport: innerHeight, scrollY, composer: document.querySelector('.rag-composer-slot').getBoundingClientRect().toJSON() }));
          results.push({ label: `${engine}-${viewport.width}x${viewport.height}-${configured}-multiline`, geometry: draftGeometry });
          await page.screenshot({ path: path.join(root, `${engine}-${viewport.width}x${viewport.height}-${configured}-multiline.png`) });
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ results }, null, 2)); }
}
console.log(JSON.stringify({ passed: true, checks: results.length, root }));
