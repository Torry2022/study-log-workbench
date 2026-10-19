import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { initialize } from './instance.mjs';
import { RagTaskStore } from '../study-log-web/lib/rag-task-store.ts';
import { createRagSession, getRagSession, renameRagSession, applyRagTaskResult } from '../study-log-web/lib/rag-sessions-store.ts';

// Durable multi-result fixtures, not a mocked client/hook. A live fixture owner holds queued tasks;
// no model is configured or executed. The normal model execution/cancel path has its own browser suite.
const repo = path.resolve(import.meta.dirname, '..'), root = path.join(repo, '.local', `rag-task-results-${Date.now()}`), instance = path.join(root, 'instance');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const env = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.LOG_ROOT = path.join(instance, 'data'); process.env.BACKUP_ROOT = path.join(instance, 'backups');
const source = '## 2026-09-01\n\n### 合成任务结果\n\n不得改写此合成来源。\n';
await fs.writeFile(path.join(process.env.LOG_ROOT, '2026-09_学习日志.md'), source);
const store = new RagTaskStore(process.env.LOG_ROOT), owner = `${process.pid}:result-fixture`, checks = [];
store.leader(owner); const heartbeat = setInterval(() => store.leader(owner), 500);
const report = { root, checks, requests: [], errors: [], paidModelCalls: 0 };
const record = value => { checks.push(value); console.log(`PASS ${value}`); };
const fixture = async (oldState, newState) => {
  const sessionId = randomUUID(), key = `${oldState}-${newState}`;
  let session = await createRagSession({ id: sessionId, mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [
    { id: randomUUID(), role: 'user', content: `${key}的基线问题`, status: 'complete' }, { id: randomUUID(), role: 'assistant', content: `${key}的基线回答`, status: 'complete' } ] });
  const input = { submissionId: randomUUID(), sessionId, baseVersion: session.version, question: `${key}旧任务的完整问题`, mode: 'logs_only', history: [] };
  const old = store.create(input), claimed = store.claim(owner); assert.equal(claimed.id, old.id);
  if (oldState === 'conflict') session = await renameRagSession(sessionId, { mutationId: randomUUID(), baseVersion: session.version, title: `${key}另一端修改的标题` });
  const result = { answer: `${key}旧任务的完整答案`, citations: [] };
  store.finish(claimed, 'succeeded', result); store.saved(old.id, oldState, oldState === 'conflict' ? '会话已变化，旧结果未覆盖会话' : '旧结果保留，保存失败');
  return { sessionId, key, oldState, newState, old: { id: old.id, question: input.question, answer: result.answer }, baseline: session };
};
const fixtures = [];
for (const oldState of ['conflict', 'error']) for (const newState of ['error', 'saved', 'queued']) fixtures.push(await fixture(oldState, newState));
// Finish all terminal fixtures before leaving the two explicitly queued fixtures.
for (const item of fixtures.filter(item => item.newState !== 'queued').concat(fixtures.filter(item => item.newState === 'queued'))) {
  const current = await getRagSession(item.sessionId), input = { submissionId: randomUUID(), sessionId: item.sessionId, baseVersion: current.version, question: `${item.key}新任务的问题`, mode: 'logs_only', history: [] };
  const task = store.create(input), result = { answer: `${item.key}新任务的答案`, citations: [] };
  if (item.newState !== 'queued') {
    const claimed = store.claim(owner); assert.equal(claimed.id, task.id); store.finish(claimed, 'succeeded', result);
    if (item.newState === 'saved') await applyRagTaskResult({ taskId: task.id, sessionId: item.sessionId, baseVersion: current.version, question: input.question, answerMode: 'logs_only', ...result });
    store.saved(task.id, item.newState, item.newState === 'error' ? '新任务保存失败' : '');
  }
  item.new = { id: task.id, question: input.question, answer: result.answer }; item.before = await getRagSession(item.sessionId);
}
const runningFixture = store.claim(owner); assert.ok(runningFixture); store.progress(runningFixture, '活动任务的合成片段', '正在处理合成资料');
report.runningFixtureIds = [runningFixture.id];
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...env, LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT, NODE_ENV: 'production', CHAT_API_KEY: '', CHAT_LIGHT_API_KEY: '' } });
let serverLog = '', browser, lastPage;
web.stdout.on('data', value => serverLog += value); web.stderr.on('data', value => serverLog += value);
const { chromium, webkit, expect } = createRequire(new URL('../study-log-web/package.json', import.meta.url))('@playwright/test');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (let i = 0; ; i++) { if (await fetch(base).then(r => r.ok).catch(() => false)) break; if (i > 160) throw Error('server not ready'); await pause(100); }
  for (const [engine, launcher, theme] of [['chromium', chromium, 'light'], ['webkit', webkit, 'dark']]) {
    browser = await launcher.launch(); const pageErrors = [];
    const openPage = async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme }), page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000);
      await page.addInitScript(theme => { localStorage.setItem('study-log-theme', theme); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedTaskAnswer = text; } } }); }, theme);
      page.on('pageerror', error => pageErrors.push(error.message)); page.on('request', request => { if (request.url().includes('/api/rag/')) report.requests.push({ engine, method: request.method(), path: new URL(request.url()).pathname }); });
      await page.goto(base); await page.getByLabel('访问密码').fill(env.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.locator('.workspace')).toBeVisible(); await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: '问答', exact: true }).click(); await expect(page.getByRole('textbox', { name: '输入知识库问题', exact: true })).toBeVisible(); return page;
    };
    const page = await openPage(), other = await openPage(), workspace = page.locator('.rag-workspace').filter({ visible: true }); lastPage = page;
    const picker = page.getByRole('combobox', { name: '查看问答结果', exact: true });
    const open = async (p, item) => { await p.locator(`.rag-session-item[data-session-id="${item.sessionId}"] .rag-session-main`).click(); await expect(p).toHaveURL(new RegExp(`session=${item.sessionId}`)); await expect(p.getByRole('combobox', { name: '查看问答结果', exact: true })).toBeVisible(); };
    const read = async id => { const response = await page.request.get(`${base}/api/rag/tasks/${id}`); return response.ok() ? (await response.json()).task : null; };
    // Each engine gets untouched task identities; the first engine mutates only its own half.
    const own = engine === 'chromium' ? fixtures : [];
    if (engine === 'webkit') {
      // Reuse the same real backing store, then seed a second isolated set while its owner remains alive.
      // Queued tasks are cancelled before reseeding so claim order remains deterministic.
      for (const item of fixtures) if ((await read(item.new.id))?.state === 'queued') store.cancel(item.new.id);
      for (const oldState of ['conflict', 'error']) for (const newState of ['error', 'saved', 'queued']) own.push(await fixture(oldState, newState));
      for (const item of own.filter(item => item.newState !== 'queued').concat(own.filter(item => item.newState === 'queued'))) {
        const current = await getRagSession(item.sessionId), input = { submissionId: randomUUID(), sessionId: item.sessionId, baseVersion: current.version, question: `${item.key}新任务的问题`, mode: 'logs_only', history: [] }, task = store.create(input), result = { answer: `${item.key}新任务的答案`, citations: [] };
        if (item.newState !== 'queued') { const claimed = store.claim(owner); assert.equal(claimed.id, task.id); store.finish(claimed, 'succeeded', result); if (item.newState === 'saved') await applyRagTaskResult({ taskId: task.id, sessionId: item.sessionId, baseVersion: current.version, question: input.question, answerMode: 'logs_only', ...result }); store.saved(task.id, item.newState, item.newState === 'error' ? '新任务保存失败' : ''); }
        item.new = { id: task.id, question: input.question, answer: result.answer }; item.before = await getRagSession(item.sessionId);
      }
      const running = store.claim(owner); assert.ok(running); store.progress(running, '活动任务的合成片段', '正在处理合成资料'); report.runningFixtureIds.push(running.id);
      // Refresh the actual history list after the fixtures were seeded.
      await page.getByRole('button', { name: '随记', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
      await other.getByRole('button', { name: '随记', exact: true }).click(); await other.getByRole('button', { name: '问答', exact: true }).click();
    }
    for (const item of own) {
      await open(page, item); await expect(picker.locator(`option[value="${item.old.id}"]`)).toHaveCount(1);
      await picker.selectOption(item.old.id); await expect(picker).toHaveValue(item.old.id); await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace.locator('.rag-answer')).toHaveText(item.old.answer); await expect(workspace.locator('.rag-message-user')).toContainText(item.old.question);
      await workspace.getByRole('button', { name: '复制', exact: true }).click(); assert.equal(await page.evaluate(() => window.__copiedTaskAnswer), item.old.answer);
      await pause(1100); await expect(picker).toHaveValue(item.old.id); await expect(workspace.locator('.rag-answer')).toHaveText(item.old.answer);
      await page.reload(); await expect(picker.locator(`option[value="${item.old.id}"]`)).toHaveCount(1); await picker.selectOption(item.old.id); await expect(picker).toHaveValue(item.old.id); await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace.locator('.rag-answer')).toHaveText(item.old.answer);
      await open(other, item); const otherPicker = other.getByRole('combobox', { name: '查看问答结果', exact: true }); await otherPicker.selectOption(item.old.id); await expect(otherPicker).toHaveValue(item.old.id); await expect(other.locator('.rag-workspace').filter({ visible: true }).locator('.rag-message')).toHaveCount(2); await expect(other.locator('.rag-workspace').filter({ visible: true }).locator('.rag-answer')).toHaveText(item.old.answer);
      assert.equal((await getRagSession(item.sessionId)).version, item.before.version);
      record(`${engine}: ${item.key} old result survives discovery, polling, refresh, second browser and copy`);
      if (item.oldState === 'conflict' && item.newState === 'saved') {
        await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole('button', { name: '打开问答历史', exact: true })).toBeVisible();
        await fs.writeFile(path.join(root, `${engine}-layout.json`), JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          boxes: ['body', '.workspace', '.reader', '.rag-workspace', '.rag-conversation', '.rag-task-picker', '.rag-task-picker select', '.rag-message-list', '.rag-composer'].map(selector => { const e = document.querySelector(selector), s = e && getComputedStyle(e); return { selector, rect: e?.getBoundingClientRect().toJSON(), scroll: e?.scrollWidth, display: s?.display, width: s?.width, minWidth: s?.minWidth, maxWidth: s?.maxWidth, columns: s?.gridTemplateColumns, flex: s?.flex }; }),
          overflow: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && r.left >= 0; }).slice(0, 20).map(e => ({ tag: e.tagName, class: e.className, rect: e.getBoundingClientRect().toJSON() })) })), null, 2));
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(root, `${engine}-selected-old-mobile.png`), fullPage: true });
        await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: path.join(root, `${engine}-selected-old-desktop.png`), fullPage: true });
      }
      if (item.oldState === 'conflict' && item.newState === 'error') {
        await picker.selectOption(''); await expect(picker).toHaveValue('');
        let releaseDeleted, startedDeleted;
        const gateDeleted = new Promise(resolve => { releaseDeleted = resolve; }), startDeleted = new Promise(resolve => { startedDeleted = resolve; });
        let capturedDeleted = false;
        await page.route(`**/api/rag/tasks/${item.old.id}`, async route => { if (capturedDeleted) return route.continue(); capturedDeleted = true; const response = await route.fetch(); startedDeleted(); await gateDeleted; try { await route.fulfill({ response }); } catch {} });
        await picker.selectOption(item.old.id); await startDeleted;
        const current = await getRagSession(item.sessionId);
        assert.equal((await other.request.delete(`${base}/api/rag/sessions/${item.sessionId}`, { data: { mutationId: randomUUID(), baseVersion: current.version } })).status(), 200);
        await expect.poll(() => read(item.old.id)).toBe(null); await expect.poll(() => read(item.new.id)).toBe(null);
        await expect(page.locator(`.rag-session-item[data-session-id="${item.sessionId}"]`)).toHaveCount(0); releaseDeleted(); await page.unroute(`**/api/rag/tasks/${item.old.id}`, { behavior: 'wait' });
        await pause(400); await expect(workspace.locator('.rag-message')).toHaveCount(0); await expect(page.locator(`.rag-session-item[data-session-id="${item.sessionId}"]`)).toHaveCount(0);
        record(`${engine}: session deletion clears retained results and a late captured snapshot cannot revive them`); continue;
      }
      if (item.oldState === 'error' && item.newState === 'error') {
        await picker.selectOption(''); await expect(workspace.locator('.rag-answer').last()).toHaveText(`${item.key}的基线回答`);
        let release, started; const gate = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { started = resolve; });
        await page.route(`**/api/rag/tasks/${item.old.id}`, async route => { started(); await gate; await route.continue(); });
        await picker.selectOption(item.old.id); await start; await picker.selectOption(item.new.id);
        await expect(workspace.locator('.rag-answer').last()).toHaveText(item.new.answer); release(); await page.unroute(`**/api/rag/tasks/${item.old.id}`, { behavior: 'wait' });
        await pause(400); await expect(picker).toHaveValue(item.new.id); await expect(workspace.locator('.rag-answer').last()).toHaveText(item.new.answer);
        await picker.selectOption(item.old.id); await expect(picker).toHaveValue(item.old.id); await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace.locator('.rag-answer')).toHaveText(item.old.answer);
        record(`${engine}: a late old-result response cannot replace a more recent explicit selection`);
      }
      if (item.oldState === 'error') {
        const before = report.requests.length; await page.getByRole('button', { name: '重试保存', exact: true }).click();
        await expect.poll(async () => (await read(item.old.id)).saveState).toBe(item.newState === 'saved' ? 'conflict' : 'saved');
        assert.equal(report.requests.slice(before).filter(request => request.method === 'POST' && /\/save$/.test(request.path)).length, 1);
        assert.ok(report.requests.slice(before).some(request => request.path.endsWith(`/${item.old.id}/save`)));
        assert.equal((await read(item.new.id)).saveState, item.newState === 'queued' ? 'pending' : item.newState);
        const current = await getRagSession(item.sessionId); if (item.newState === 'saved') assert.equal(current.version, item.before.version); else assert.ok(current.messages.at(-1).content === item.old.answer);
        record(`${engine}: ${item.key} retry saves only the selected task and respects the current JSON version`);
      }
      if ((await read(item.old.id)).saveState !== 'saved') {
        const before = report.requests.length, version = (await getRagSession(item.sessionId)).version;
        await page.getByRole('button', { name: '放弃未保存回答并重新读取', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: '重新读取', exact: true }).click();
        await expect.poll(() => read(item.old.id)).toBe(null); assert.ok(await read(item.new.id)); assert.equal((await getRagSession(item.sessionId)).version, version);
        assert.deepEqual(report.requests.slice(before).filter(request => request.method === 'DELETE').map(request => request.path.split('/').at(-1)), [item.old.id]);
        record(`${engine}: ${item.key} discard removes only the selected result`);
      }
      if (item.newState === 'queued') {
        await picker.selectOption(item.new.id); await page.getByRole('button', { name: '停止生成', exact: true }).click(); await expect.poll(async () => (await read(item.new.id)).state).toBe('cancelled'); store.release(item.new.id);
        record(`${engine}: ${item.key} stop targets the selected active task`);
      }
    }
    // Retained results are still visible after actions on another result in the same session.
    const remaining = own.find(item => item.oldState === 'error' && item.newState === 'error'); await page.locator(`.rag-session-item[data-session-id="${remaining.sessionId}"] .rag-session-main`).click();
    if (await picker.count()) await picker.selectOption(remaining.new.id); await expect(workspace.locator('.rag-answer').last()).toHaveText(remaining.new.answer);
    await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole('button', { name: '打开问答历史', exact: true })).toBeVisible(); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: path.join(root, `${engine}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: path.join(root, `${engine}-desktop.png`), fullPage: true });
    assert.deepEqual(pageErrors, []); await browser.close(); browser = null;
  }
  assert.ok(!report.requests.some(request => request.method === 'POST' && /\/rag\/tasks$/.test(request.path)));
  assert.ok(!report.requests.some(request => ['POST', 'PUT'].includes(request.method) && /\/rag\/sessions(?:\/[^/]+)?$/.test(request.path)));
  assert.equal(await fs.readFile(path.join(process.env.LOG_ROOT, '2026-09_学习日志.md'), 'utf8'), source); report.passed = true; report.sourceUnchanged = true;
} catch (error) { report.passed = false; report.errors.push(error.stack || String(error)); if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close().catch(() => {}); if (web.exitCode === null) { const closed = once(web, 'close'); web.kill(); await closed; } clearInterval(heartbeat); store.shutdown(owner); store.close(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog); console.log(JSON.stringify({ root, passed: report.passed, checks: checks.length })); }
