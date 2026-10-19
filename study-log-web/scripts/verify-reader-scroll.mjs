// Adapted from personal 830dd33: isolated public fixtures, PUT API and public reading labels.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium, webkit, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, '..', '.local', `reader-scroll-${Date.now()}`);
const data = path.join(evidence, 'data');
await fs.mkdir(data, { recursive: true });
await fs.writeFile(path.join(data, '2026-07_学习日志.md'), [
  '## 2026-07-07', '',
  ...['第一小节', '第二小节', '第三小节'].flatMap(title => [
    `### ${title}`, '', ...Array.from({ length: 45 }, (_, i) =>
      `${title}长段落 ${i + 1}：${'仅用于隔离验证，保存和切换应保留阅读位置。'.repeat(5)}\n`)
  ])
].join('\n'));
const reservation = http.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const password = randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(key)));
Object.assign(env, { LOG_ROOT: data, BACKUP_ROOT: path.join(data, '.local'), APP_PASSWORD: password,
  SESSION_SECRET: randomUUID(), COOKIE_SECURE: 'false', NODE_ENV: 'production',
  CHAT_API_KEY: '', CHAT_LIGHT_API_KEY: '', CHAT_API_URL: 'http://127.0.0.1:1/chat',
  STUDY_LOG_MCP_URL: 'http://127.0.0.1:1/mcp', RAG_JEV_ENABLED: 'false',
  DEEPSEEK_API_KEY: '', DASHSCOPE_API_KEY: '', OPENAI_API_KEY: '', WIKI_JEV_API_KEY: '', WIKI_COMPILE_TOKEN: '' });
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', chunk => { log += chunk; });
server.stderr.on('data', chunk => { log += chunk; });
const url = `http://127.0.0.1:${port}/study-log/`;
const results = [];
async function state(page) {
  return page.evaluate(() => ({ y: scrollY,
    heading: document.querySelector('.reader #第二小节')?.getBoundingClientRect().top,
    toolbar: document.querySelector('.reader-toolbar').getBoundingClientRect().bottom,
    editor: document.querySelector('.cm-scroller')?.scrollTop || 0 }));
}
async function record(page, duration = 900, trigger = null) {
  await page.evaluate(({ duration, trigger }) => {
    window.readerFrames = []; let start = 0;
    const sample = () => {
      const surface = document.querySelector('.reader-content');
      window.readerFrames.push({ t: performance.now() - start, y: scrollY,
        opacity: Number(getComputedStyle(surface).opacity), preview: Boolean(document.querySelector('.reader-preview')),
        animations: document.getAnimations().map(a => ({ name: a.animationName, duration: a.effect?.getTiming().duration })) });
      if (performance.now() - start < duration) requestAnimationFrame(sample);
    };
    const begin = () => { start = performance.now(); requestAnimationFrame(sample); };
    if (trigger) document.querySelector(trigger).addEventListener('click', begin, { once: true });
    else begin();
  }, { duration, trigger });
}
async function settled(page) {
  await expect.poll(() => page.locator('html').getAttribute('data-workspace-transition')).toBeNull();
  await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0);
}
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (attempt > 150 || server.exitCode !== null) throw Error(log);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    if (process.env.READER_BROWSER && process.env.READER_BROWSER !== engineName) continue;
    const browser = await engine.launch();
    try {
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.getByLabel('访问密码').fill(password);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.locator('.reader #第二小节')).toBeVisible();
        await settled(page); await page.evaluate(() => document.fonts.ready);
        for (const reduced of [false, true]) {
          const label = `${engineName}-${scheme}-${reduced ? 'reduced' : 'motion'}`;
          await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
          const landings = [];
          for (const initial of [0, 200]) {
            await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), initial);
            await page.locator('.reader .outline-item').filter({ hasText: '第二小节' }).click();
            await page.waitForTimeout(reduced ? 200 : 1700);
            landings.push(await state(page));
          }
          assert.ok(Math.abs(landings[0].heading - landings[1].heading) <= 2, `${label}: outline destination differs at page top`);
          assert.ok(Math.abs(landings[1].heading - landings[1].toolbar - 12) <= 2, `${label}: heading landing gap`);
          results.push({ label, test: 'outline', landings });
          await page.getByRole('button', { name: '源码', exact: true }).click(); await settled(page);
          // Save normal edits, then save a trailing newline that the backing format trims.
          for (const normalization of ['body', 'trailing', 'both']) {
            // The public editor stays mounted with its last selection. Establish
            // this save fixture with a real navigation key before sampling it.
            await page.locator('.source-workspace .cm-content').press('Control+Home');
            await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
            await page.waitForTimeout(150);
            const line = page.locator('.source-workspace:not(.source-workspace-hidden) .cm-line').filter({ hasText: '第一小节长段落 6：' }).first();
            await line.click(); await page.keyboard.press('End'); await page.keyboard.type(' 合成保存验证');
            if (normalization !== 'body') {
              if (normalization === 'both') { await page.keyboard.press('Control+Home'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); }
              await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
              await page.getByRole('button', { name: '源码', exact: true }).focus();
              await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
            }
            await page.waitForTimeout(150); const before = await state(page);
            await record(page, 900, '.reader .toolbar-save-button');
            const response = page.waitForResponse(r => r.url().endsWith('/api/logs/day') && r.request().method() === 'PUT');
            await page.getByRole('button', { name: '保存', exact: true }).click();
            assert.equal((await response).status(), 200);
            await page.waitForTimeout(1000); const after = await state(page);
            await expect(page.getByText('已保存', { exact: true })).toBeVisible();
            const frames = await page.evaluate(() => window.readerFrames);
            assert.ok(Math.abs(after.y - before.y) <= 2, `${label}: save moved window ${before.y} -> ${after.y}`);
            assert.ok(frames.every(frame => Math.abs(frame.y - before.y) <= 2), `${label}: save flickered`);
            assert.ok(Math.abs(after.editor - before.editor) <= 2, `${label}: save moved editor`);
            results.push({ label, test: 'save', normalization, before, after, frames });
          }
          await page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
          await record(page, 900, '.reader .view-mode-button[title="浏览"]');
          await page.getByRole('button', { name: '浏览', exact: true }).click();
          await settled(page); await page.waitForTimeout(1000);
          const frames = await page.evaluate(() => window.readerFrames);
          results.push({ label, test: 'source-preview', frames });
          const visible = frames.filter(frame => frame.preview && frame.opacity > 0);
          assert.ok(visible.length > 2);
          assert.ok(Math.max(...visible.map(f => f.y)) - Math.min(...visible.map(f => f.y)) <= 2, `${label}: preview exposed a changing scroll position`);
          await page.screenshot({ path: path.join(evidence, `${label}-preview.png`) });
          for (const direction of ['进入', '退出']) {
            await record(page);
            await page.evaluate(direction => document.querySelector(`button[aria-label="${direction === '退出' ? '退出阅读' : '进入阅读模式'}"]`).click(), direction);
            await page.waitForTimeout(60);
            await page.screenshot({ path: path.join(evidence, `${label}-${direction}-during.png`) });
            await page.waitForTimeout(1000);
            const frames = await page.evaluate(() => window.readerFrames);
            const animations = frames.flatMap(f => f.animations);
            assert.ok(!animations.some(a => a.name === 'reading-mode-view-out'), `${label}: old reading frame must not crossfade over new text`);
            assert.ok(!animations.some(a => /workspace-content/.test(a.name || '')), `${label}: reading transition mixed with content transition`);
            if (!reduced) assert.ok(animations.some(a => a.duration === 240 && (a.name === 'reading-mode-view-in' || !a.name)), `${label}: missing reading transition`);
            else assert.ok(!animations.some(a => /reading-mode/.test(a.name || '')));
            await expect(page.locator('html')).not.toHaveClass(/reading-mode-transition/);
            results.push({ label, test: `reading-${direction}`, frames });
          }
        }
        // Last operation wins, with no stale snapshot or transition flag left behind.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => document.querySelector('button[aria-label="进入阅读模式"]').click());
          await expect(page.locator('.app-shell')).toHaveClass(/reading-mode/);
          await page.evaluate(() => document.querySelector('button[aria-label="退出阅读"]').click());
          await expect(page.locator('.app-shell')).not.toHaveClass(/reading-mode/);
        }
        await page.waitForTimeout(350); await settled(page);
        await expect(page.locator('html')).not.toHaveClass(/reading-mode-transition/);
        // Exercise the same CSS fallback used by browsers without View Transition API.
        await page.evaluate(() => { document.startViewTransition = undefined; });
        await page.getByRole('button', { name: '进入阅读模式' }).click();
        await expect(page.locator('.app-shell')).toHaveClass(/reading-mode/);
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: '退出阅读' }).click();
        await expect(page.locator('.app-shell')).not.toHaveClass(/reading-mode/);
        await page.waitForTimeout(300);
        assert.deepEqual(errors, []);
        results.push({ engineName, scheme, test: 'rapid-and-fallback', passed: true });
        await page.close();
      }
      for (const width of [320, 360, 390, 430, 768, 1280, 1920]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await page.goto(url);
        await page.getByLabel('访问密码').fill(password);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.locator('.reader #第二小节')).toBeVisible(); await settled(page);
        await page.getByRole('button', { name: '源码', exact: true }).click(); await settled(page);
        await expect(page.locator('.reader .source-workspace:not(.source-workspace-hidden) .cm-content')).toBeVisible();
        await page.getByRole('button', { name: '浏览', exact: true }).click(); await settled(page);
        await expect(page.locator('.reader .markdown-preview')).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${engineName}-${width}: overflow`);
        if (width >= 1024) {
          await page.addStyleTag({ content: '.markdown-preview { font-size: 20px; }' });
          await page.locator('.reader .outline-item').filter({ hasText: '第二小节' }).click();
          await page.getByRole('button', { name: '进入阅读模式' }).click();
          await page.getByRole('button', { name: '退出阅读' }).click();
        }
        await page.screenshot({ path: path.join(evidence, `${engineName}-${width}-responsive.png`) });
        results.push({ engineName, width, test: 'responsive', enlargedPreview: width >= 1024, passed: true });
        await page.close();
      }
    } catch (error) {
      for (const page of browser.contexts().flatMap(context => context.pages())) {
        await page.screenshot({ path: path.join(evidence, `${engineName}-failure.png`) }).catch(() => {});
        await fs.writeFile(path.join(evidence, `${engineName}-failure.json`), JSON.stringify(await page.evaluate(() => ({
          y: scrollY, mode: document.querySelector('.editing-workspace')?.className,
          editor: document.querySelector('.cm-scroller')?.scrollTop,
          lines: [...document.querySelectorAll('.cm-line')].map(line => line.textContent),
          focused: document.activeElement?.outerHTML.slice(0, 500),
          source: document.querySelector('.source-workspace')?.getBoundingClientRect().toJSON(),
          transition: document.documentElement.dataset.workspaceTransition
        })).catch(() => ({})), null, 2));
      }
      throw error;
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ evidence, checks: results.length }));
} finally {
  server.kill();
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(evidence, 'server.log'), log);
}

