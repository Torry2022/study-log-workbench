import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium, webkit, expect } from '@playwright/test';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = path.resolve(webRoot, '..', '.local', `internal-link-dialog-${Date.now()}`);
const dataRoot = path.join(evidenceRoot, 'data');
await fs.mkdir(dataRoot, { recursive: true });
const sourcePath = path.join(dataRoot, '2024-04_学习日志.md');
const original = ['## 2024-04-03', '', '### Alpha 很长的小节标题用于验证日期固定对齐', '', 'bodyOnly 和 Needle 出现在正文。', '',
  ...Array.from({ length: 94 }, (_, index) => [`### 条目 ${index + 1}`, '', '合成正文。', '']).flat(),
  '---', '', '## 2024-04-02', '', '### 短标题', '', 'needle 位于旧日志。', ''].join('\n');
await fs.writeFile(sourcePath, original);
const reservation = http.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const baseUrl = `http://127.0.0.1:${port}/study-log`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: webRoot, windowsHide: true, env: { ...process.env, LOG_ROOT: dataRoot, APP_PASSWORD: 'synthetic-password', SESSION_SECRET: 'synthetic-internal-link-verification-secret', COOKIE_SECURE: 'false', CHAT_API_KEY: '', STUDY_LOG_MCP_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = ''; server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
const results = [];
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(baseUrl)).ok) break; } catch { /* Wait for the synthetic production instance. */ }
    if (attempt > 100 || server.exitCode !== null) throw new Error(log);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
      await page.goto(baseUrl);
      await page.getByLabel('访问密码').fill('synthetic-password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('button', { name: '源码', exact: true }).click();
      const editor = page.locator('.source-workspace:not(.source-workspace-hidden) .cm-content');
      await expect(editor).toContainText('Alpha');
      await expect.poll(() => page.locator('html').getAttribute('data-workspace-transition')).toBeNull();
      await editor.click(); await page.keyboard.press('Control+Home');
      await page.keyboard.press('Control+Shift+K');
      const dialog = page.getByRole('dialog', { name: '插入内部链接' });
      const input = dialog.getByLabel('搜索链接目标');
      const list = dialog.locator('.internal-link-results');
      const rows = list.getByRole('option');
      const status = dialog.locator('.internal-link-results-status');
      const settled = async () => expect(list).toHaveAttribute('aria-busy', 'false');
      await expect(rows.first().locator('strong')).toHaveText('2024-04-03 的日志'); await settled();
      await expect(rows.first().locator('small')).toHaveCount(0);
      await expect(status).toHaveText('最近的日志与小节');
      // Later pages append without moving the list; failures retry the same page.
      let failedMore = false;
      await page.route('**/api/links?**', async route => {
        if (new URL(route.request().url()).searchParams.get('offset') === '40' && !failedMore) {
          failedMore = true;
          await route.fulfill({ status: 503, json: { error: '合成分页失败' } });
        } else await route.continue();
      });
      const bottom = async () => list.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await bottom();
      await expect(status).toContainText('未能加载更多');
      await expect(rows).toHaveCount(40); await expect(rows.first()).toBeEnabled();
      await status.getByRole('button', { name: '重试' }).click();
      await expect(rows).toHaveCount(80);
      await bottom(); await expect(rows).toHaveCount(98);
      assert.equal(new Set(await rows.evaluateAll(items => items.map(item => item.textContent))).size, 98);
      await page.unroute('**/api/links?**');
      // Changing a query cancels an in-flight append and discards its response.
      await input.fill(''); await dialog.getByRole('button', { name: '查询链接目标' }).click(); await settled();
      await expect(rows).toHaveCount(40);
      let releasePage;
      const pageGate = new Promise(resolve => { releasePage = resolve; });
      await page.route('**/api/links?**', async route => {
        if (new URL(route.request().url()).searchParams.get('offset') === '40') {
          await pageGate;
          await route.fulfill({ json: { results: [], hasMore: false } }).catch(() => {});
        } else await route.continue();
      });
      await bottom(); await expect(status).toHaveText('正在加载更多…');
      await input.fill('短标题'); await dialog.getByRole('button', { name: '查询链接目标' }).click(); await settled();
      await expect(rows).toHaveCount(2); releasePage();
      await expect(status).toHaveText('找到 2 个匹配项');
      await page.unroute('**/api/links?**');
      const query = async text => { await input.fill(text); await dialog.getByRole('button', { name: '查询链接目标' }).click(); await settled(); };
      await query('bodyOnly'); await expect(rows).toHaveCount(2);
      await dialog.getByRole('button', { name: '仅搜索小节标题' }).click(); await settled(); await expect(rows).toHaveCount(0);
      await query('alpha'); await expect(rows).toHaveCount(1);
      await dialog.getByRole('button', { name: '区分大小写' }).click(); await settled(); await expect(rows).toHaveCount(0);
      await query('Alpha'); await expect(rows).toHaveCount(1);
      await dialog.getByRole('button', { name: '仅搜索小节标题' }).click();
      await dialog.getByRole('button', { name: '区分大小写' }).click();
      await query('短标题');
      await dialog.getByLabel('筛选日志日期').fill('2024-04-02'); await settled();
      await expect(input).toHaveValue('短标题');
      await expect(dialog.locator('.internal-link-date-filter')).toContainText('2024-04-02');
      await expect(dialog.locator('.internal-link-date-toggle')).toHaveClass(/active/);
      await dialog.getByRole('button', { name: '清除日期筛选' }).click(); await settled();
      await expect(input).toHaveValue('短标题');
      await expect(dialog.locator('.internal-link-date-filter')).toHaveCount(0);
      await expect(dialog.getByLabel('自定义显示文字')).toHaveAttribute('placeholder', '自定义链接文字（留空使用所选日志或小节的标题）');
      await query('');
      await dialog.getByLabel('筛选日志日期').fill('2024-04-02'); await settled();
      await dialog.getByRole('button', { name: '清除日期筛选' }).click(); await settled();
      await dialog.getByLabel('自定义显示文字').focus();
      await page.screenshot({ path: path.join(evidenceRoot, `${name}-recent-long-titles.png`) });
      const dates = await rows.locator('.internal-link-result-copy small').evaluateAll(items => items.map(item => item.getBoundingClientRect().right));
      assert.ok(Math.max(...dates) - Math.min(...dates) < 1);
      await dialog.getByLabel('筛选日志日期').fill('2024-04-02'); await settled();
      await dialog.getByLabel('自定义显示文字').focus();
      await expect(rows).toHaveCount(2);
      await expect(rows.first().locator('strong')).toHaveText('2024-04-02 的日志');
      await expect(rows.first().locator('small')).toHaveCount(0);
      await expect(rows.nth(1).locator('small')).toHaveText('2024-04-02');
      await expect(rows.nth(1)).toContainText('短标题');
      await query('bodyOnly'); await expect(rows).toHaveCount(0);
      await expect(status).toBeEmpty();
      await query('');
      await dialog.getByRole('button', { name: '清除日期筛选' }).click(); await settled(); await expect(rows).toHaveCount(40);
      // Keep the last stable results visible and non-selectable while updating or after failure.
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/api/links?**', async route => {
        if (new URL(route.request().url()).searchParams.get('query') === 'slow') { await gate; await route.fulfill({ status: 503, json: { error: '合成查询失败' } }); }
        else await route.continue();
      });
      const top = await rows.first().evaluate(element => element.getBoundingClientRect().top);
      await input.fill('slow'); await dialog.getByRole('button', { name: '查询链接目标' }).click();
      await expect(list).toHaveAttribute('aria-busy', 'true');
      await expect(rows).toHaveCount(40); await expect(rows.first()).toBeDisabled();
      assert.ok(Math.abs(await rows.first().evaluate(element => element.getBoundingClientRect().top) - top) <= 2);
      release(); await expect(status).toContainText('已保留上次结果');
      await expect(rows).toHaveCount(40); await expect(rows.first()).toBeDisabled();
      await page.unroute('**/api/links?**');
      await status.getByRole('button', { name: '重试' }).click(); await settled();
      await expect(rows).toHaveCount(0);
      await page.setViewportSize({ width: 320, height: 844 });
      const assertTitleDateLine = async (term, expectEllipsis = false) => {
        await query(term);
        const headingRow = rows.filter({ has: page.locator('small') }).first();
        await expect(headingRow).toBeVisible();
        const line = await headingRow.evaluate(element => {
          const title = element.querySelector('strong'), date = element.querySelector('small');
          const titleBox = title.getBoundingClientRect(), dateBox = date.getBoundingClientRect();
          return { titleTop: titleBox.top, dateTop: dateBox.top, titleRight: titleBox.right, dateLeft: dateBox.left,
            clipped: title.scrollWidth > title.clientWidth };
        });
        assert.ok(Math.abs(line.titleTop - line.dateTop) < 4, JSON.stringify({ term, line }));
        assert.ok(line.titleRight <= line.dateLeft + 1, JSON.stringify({ term, line }));
        if (expectEllipsis) assert.equal(line.clipped, true, JSON.stringify({ term, line }));
      };
      await assertTitleDateLine('Alpha', true);
      await assertTitleDateLine('短标题');
      await query('');
      await dialog.getByLabel('筛选日志日期').fill('2024-04-02'); await settled();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        for (const width of [320, 360, 390, 430, 768, 1440]) {
          await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
          await page.evaluate(() => document.fonts.ready);
          await expect(dialog).toBeVisible();
          const geometry = await dialog.evaluate(root => {
            const rect = root.getBoundingClientRect();
            const dateInput = root.querySelector('input[type="date"]');
            const dateRect = dateInput.getBoundingClientRect();
            return { left: rect.left, right: rect.right, bottom: rect.bottom, height: innerHeight, overflow: root.scrollWidth - root.clientWidth,
              search: root.querySelector('.internal-link-search').getBoundingClientRect().toJSON(),
              alias: root.querySelector('.internal-link-alias').getBoundingClientRect().toJSON(),
              dateHit: document.elementFromPoint(dateRect.x + dateRect.width / 2, dateRect.y + dateRect.height / 2) === dateInput,
chip: root.querySelector('.internal-link-date-filter').getBoundingClientRect().toJSON(),
              calendar: root.querySelector('.internal-link-date-toggle').getBoundingClientRect().toJSON(),
              dates: [...root.querySelectorAll('.internal-link-result-copy small')].map(item => item.getBoundingClientRect().right),
              controls: [...root.querySelectorAll('.internal-link-search-tools button, .internal-link-date-toggle')].map(item => { const box = item.getBoundingClientRect(); return [box.width, box.height]; }) };
          });
          assert.ok(geometry.left >= -1 && geometry.right <= width + 1 && geometry.bottom <= geometry.height + 1, JSON.stringify(geometry));
          assert.ok(geometry.overflow <= 1, JSON.stringify(geometry));
          assert.ok(Math.abs(geometry.search.left - geometry.alias.left) < 1 && Math.abs(geometry.search.right - geometry.alias.right) < 1);
          assert.ok(geometry.chip.top >= geometry.search.top && geometry.chip.bottom <= geometry.search.bottom);
          assert.ok(geometry.dateHit, JSON.stringify(geometry));
          assert.ok(geometry.calendar.left >= geometry.search.left && geometry.calendar.right <= geometry.search.right);
          assert.ok(Math.max(...geometry.dates) - Math.min(...geometry.dates) < 1, JSON.stringify(geometry));
          if (width < 768) assert.ok(geometry.search.height <= 110, JSON.stringify(geometry));
          if (width < 768) assert.ok(geometry.controls.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(geometry));
          await page.screenshot({ path: path.join(evidenceRoot, `${name}-${theme}-${width}.png`) });
          results.push({ browser: name, theme, width, geometry });
        }
      }
      // Keyboard insertion uses the explicit alias; selected text remains authoritative after changing the search.
      await page.setViewportSize({ width: 1920, height: 1000 });
      await dialog.getByLabel('自定义显示文字').fill('自定义别名');
      await input.focus();
      const explicitSearch = page.waitForResponse(response => response.url().includes('/api/links?'));
      await input.press('Enter'); await (await explicitSearch).finished(); await settled();
      await input.press('ArrowDown'); await input.press('ArrowDown');
      await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
      await input.press('Enter');
      await expect(dialog).toBeHidden(); await expect(editor).toContainText('[[2024-04-02#短标题|自定义别名]]');
      await page.keyboard.press('Control+z');
      await editor.click(); await page.keyboard.press('Control+Home');
      for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowRight');
      for (let step = 0; step < 5; step++) await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('Control+Shift+K');
      await expect(input).toHaveValue('Alpha');
      await expect(dialog.getByLabel('自定义显示文字')).toHaveCount(0);
      await settled(); await expect(rows).toHaveCount(2);
      await expect(rows.first().locator('strong')).toContainText('Alpha');
      await query('短标题'); await expect(rows).toHaveCount(2);
      await expect(rows.first().locator('strong')).toHaveText('短标题');
      await rows.first().click(); await expect(dialog).toBeHidden();
      await expect(editor).toContainText('[[2024-04-02#短标题|Alpha]]');
      const invalid = await page.request.get(`${baseUrl}/api/links?date=2024-02-30`);
      assert.equal(invalid.status(), 400);
      for (const offset of ['-1', '1.5', 'NaN']) {
        assert.equal((await page.request.get(`${baseUrl}/api/links?offset=${offset}`)).status(), 400);
      }
      const beyond = await page.request.get(`${baseUrl}/api/links?offset=98`);
      assert.deepEqual(await beyond.json(), { results: [], hasMore: false });
    } finally { await browser.close(); }
  }
  assert.equal(await fs.readFile(sourcePath, 'utf8'), original);
  await fs.writeFile(path.join(evidenceRoot, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, layouts: results.length, evidenceRoot }));
} finally {
  server.kill();
  await fs.writeFile(path.join(evidenceRoot, 'server.log'), log);
}
