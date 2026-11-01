import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

// Saved synthetic history exercises the production page without any model calls.
const appRoot = process.env.QA_JUMP_APP;
assert.ok(appRoot, 'QA_JUMP_APP required');
const { chromium, webkit, expect } = createRequire(path.join(appRoot, 'package.json'))('@playwright/test');
const engine = process.env.QA_JUMP_ENGINE || 'chromium';
const output = process.env.QA_JUMP_OUTPUT;
assert.ok(output, 'QA_JUMP_OUTPUT required');
await fs.mkdir(output, { recursive: true });
const instance = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-composer-'));
await fs.mkdir(path.join(instance, '.backups'));
await fs.writeFile(path.join(instance, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
await fs.writeFile(path.join(instance, '2026-10_学习日志.md'), '## 2026-10-01\n\n### 合成滚动记录\n\n核对输入区滚动衔接。\n');
const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`;
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: appRoot, windowsHide: true, env: { ...safe, LOG_ROOT: instance, BACKUP_ROOT: path.join(instance, '.backups'), RAG_RUNTIME: 'legacy',
    APP_PASSWORD: 'synthetic-ui-password', SESSION_SECRET: 'synthetic-ui-session-secret-local-only', COOKIE_SECURE: 'false' }
});
let serverLog = '', browser, page;
app.stdout.on('data', chunk => serverLog += chunk); app.stderr.on('data', chunk => serverLog += chunk);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { engine, appRoot, instance, cases: [] };
try {
  for (let attempt = 0; ; attempt++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    assert.ok(attempt < 200, 'local production server starts'); await delay(100);
  }
  browser = await ({ chromium, webkit })[engine].launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { password: 'synthetic-ui-password' } })).status(), 200);
  const id = crypto.randomUUID();
  const created = await context.request.post(`${base}/api/rag/sessions`, { data: { id, mutationId: crypto.randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [
    { id: 'question', role: 'user', content: '检查输入框接近底部时是否连续移动' },
    { id: 'answer', role: 'assistant', content: Array.from({ length: 35 }, (_, i) => `第${i + 1}段：${'合成内容用于验证连续滚动。'.repeat(12)}`).join('\n\n') }
  ] } });
  assert.equal(created.status(), 200, await created.text());
  page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}?view=qa&session=${id}`);
  await expect(page.locator('.rag-answer')).toContainText('第35段');
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    for (const draft of ['', '多行草稿\n'.repeat(12)]) {
      await input.fill(draft); await input.focus();
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await delay(200);
      const samples = await page.evaluate(async () => {
        const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const samples = [];
        for (const remaining of [...Array.from({ length: 76 }, (_, i) => 600 - i * 8), ...Array.from({ length: 76 }, (_, i) => i * 8)]) {
          scrollTo({ top: document.documentElement.scrollHeight - innerHeight - remaining, behavior: 'instant' });
          await frames();
          const slot = document.querySelector('.rag-composer-slot'), form = slot.querySelector('.rag-composer');
          const rect = form.getBoundingClientRect();
          samples.push({ remaining, scroll: scrollY, top: rect.top, bottom: rect.bottom, height: document.documentElement.scrollHeight,
            hidden: slot.classList.contains('is-hidden'), position: getComputedStyle(slot).position });
        }
        return samples;
      });
      const jumps = samples.slice(1).flatMap((sample, i) => Math.abs(sample.top - samples[i].top) > Math.abs(sample.scroll - samples[i].scroll) + 2 ? [{ before: samples[i], after: sample }] : []);
      report.cases.push({ width, multiline: Boolean(draft), jumps, samples });
      await page.screenshot({ path: path.join(output, `${engine}-${width}-${draft ? 'long' : 'short'}.png`) });
      assert.equal(jumps.length, 0, 'input moves continuously across the conversation tail: ' + JSON.stringify(jumps.slice(0, 2)));
      assert.equal(new Set(samples.map(s => s.height)).size, 1, 'scrolling does not change the document height');
      assert.ok(samples.every(s => !s.hidden), 'input remains visible during the focused sweep');
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await delay(150);
      const bottom = await page.evaluate(() => ({ input: document.querySelector('.rag-composer').getBoundingClientRect().toJSON(), actions: document.querySelector('.rag-answer-actions').getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > innerWidth, viewport: innerHeight }));
      assert.ok(bottom.actions.bottom < bottom.input.top, 'actions have their own place above the input');
      assert.ok(bottom.input.bottom <= bottom.viewport + 1, 'entire input is visible at the bottom');
      assert.equal(bottom.overflow, false);
    }
  }
  assert.deepEqual(errors, []); report.passed = true;
} catch (error) {
  report.failure = error.stack;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (app.exitCode === null) { app.kill(); await once(app, 'exit'); }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(output, 'server.log'), serverLog);
  console.log(JSON.stringify({ passed: report.passed || false, cases: report.cases.map(({ samples, ...summary }) => summary), failure: report.failure }));
}
