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
import { startHttpServer } from '../study-log-mcp/src/http-server.mjs';

// Current production UI/API, real local MCP and SQLite/JSON; only the model is a loopback substitute.
const repo = path.resolve(import.meta.dirname, '..'), root = path.join(repo, '.local', `rag-task-browser-${Date.now()}`);
const instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
const source = '## 2026-09-01\n\n### 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const sourceFile = path.join(data, '2026-09_学习日志.md'); await fs.writeFile(sourceFile, source);
const report = { checks: [], requests: [], modelRequests: [], errors: [], root };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 20000) {
  const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(40); }
}
let streams = 0, active = 0, peak = 0, web, holdTitles = false;
const heldTitles = [];
const pending = new Map();
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); report.modelRequests.push({ stream: body.stream === true, model: body.model });
  if (!body.stream) {
    const title = body.messages?.[0]?.content?.includes('短语式标题');
    const respond = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: title ? '合成保存问答' : JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); };
    if (title && holdTitles) heldTitles.push(respond); else respond(); return;
  }
  const n = ++streams; active++; peak = Math.max(peak, active); pending.set(n, res);
  res.setHeader('content-type', 'text/event-stream'); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `第${n}次合成回答：先确认内容` }, finish_reason: null }] })}\n\n`);
  res.once('close', () => { active--; pending.delete(n); });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const finish = (n, fail = false) => {
  const res = pending.get(n); assert.ok(res, `model ${n} is waiting`);
  res.end(fail ? `data: ${JSON.stringify({ error: { message: 'synthetic provider failure' } })}\n\n` :
    `data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
};
const answer = n => `第${n}次合成回答：先确认内容，再保存。`;
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-browser-task-mcp', retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
let serverLog = '', currentPage, browser;
try {
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...environment, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
    CHAT_API_URL: `http://127.0.0.1:${model.address().port}/chat`, CHAT_API_KEY: 'synthetic-browser-model-key', CHAT_MODEL: 'synthetic-browser-model', CHAT_LIGHT_MODEL: 'synthetic-browser-model',
    STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-browser-task-mcp', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' } });
  web.stdout.on('data', value => serverLog += value); web.stderr.on('data', value => serverLog += value);
  await until(async () => fetch(base).then(r => r.ok).catch(() => false), Boolean);
  for (const [engine, launcher, theme] of [['chromium', chromium, 'light'], ['webkit', webkit, 'dark']]) {
    browser = await launcher.launch();
    const contexts = [], browserErrors = [], unhandled = [], navigations = [];
    async function navigate(page, url) {
      const navigation = { engine, page: contexts.indexOf(page.context()), startedAt: Date.now(), endedAt: null };
      navigations.push(navigation);
      try { return await (url ? page.goto(url) : page.reload()); } finally { navigation.endedAt = Date.now(); }
    }
    async function pageFor({ legacy = false, width = 1440, unavailable = false, unknownProtocol = false } = {}) {
      const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, colorScheme: theme }); contexts.push(context);
      const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(20000);
      const pageIndex = contexts.indexOf(context);
      await page.exposeFunction('captureUnhandledTaskTest', value => unhandled.push({ engine, page: pageIndex, ...value }));
      await page.addInitScript(() => window.addEventListener('unhandledrejection', event => {
        void window.captureUnhandledTaskTest({ message: String(event.reason), stack: event.reason?.stack }).catch(() => {});
      }));
      await page.addInitScript(theme => localStorage.setItem('study-log-theme', theme), theme);
      page.on('pageerror', error => { const value = { engine, page: pageIndex, at: Date.now(), url: page.url(), message: error.message, stack: error.stack, checksCompleted: report.checks.length }; browserErrors.push(value); (report.browserErrors ||= []).push(value); });
      page.on('requestfailed', request => (report.networkFailures ||= []).push({ engine, page: pageIndex, at: Date.now(), url: request.url(), failure: request.failure(), checksCompleted: report.checks.length }));
      page.on('request', request => { const url = new URL(request.url()); if (url.pathname.includes('/api/rag/')) report.requests.push({ engine, page: pageIndex, path: url.pathname, method: request.method(), ...(request.method() === 'POST' && /\/tasks$/.test(url.pathname) ? { body: request.postDataJSON() } : {}) }); });
      if (legacy || unavailable || unknownProtocol) await page.route('**/api/capabilities', async route => { const response = await route.fetch(), json = await response.json(); if (legacy) delete json.features.ragTasks; if (unavailable) json.features.ragTasks.configured = false; if (unknownProtocol) json.features.ragTasks.protocolVersion = 99; await route.fulfill({ response, json }); });
      await navigate(page, base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.locator('.workspace')).toBeVisible(); await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: '问答', exact: true }).click(); await expect(page.getByRole('textbox', { name: '输入知识库问题', exact: true })).toBeVisible(); await page.waitForLoadState('networkidle');
      return page;
    }
    const page = await pageFor(), input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    const workspace = page.locator('.rag-workspace').filter({ visible: true });
    const beforeInvalidRetry = streams;
    const invalidRetry = await page.request.post(`${base}/api/rag/tasks`, { data: { submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成重试校验', retryTaskId: 'invalid-task-id' } });
    assert.equal(invalidRetry.status(), 400); assert.equal(streams, beforeInvalidRetry);
    const rows = (p, id) => p.locator(`.rag-session-item[data-session-id="${id}"]`);
    const task = async id => { const r = await page.request.get(`${base}/api/rag/tasks/${id}`); return r.ok() ? (await r.json()).task : null; };
    const tasks = async () => (await (await page.request.get(`${base}/api/rag/tasks`)).json()).tasks;
    const getSession = async id => { const r = await page.request.get(`${base}/api/rag/sessions/${id}`); return r.ok() ? (await r.json()).session : null; };
    const fresh = async () => { await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).first().click(); await expect(workspace.locator('.rag-message')).toHaveCount(0); };
    let serial = 0;
    const send = async () => { const n = streams + 1; await input.fill(`合成保存，${engine}第${++serial}问应如何操作？`); await page.getByRole('button', { name: '发送问题', exact: true }).click(); await until(() => streams, value => value === n); const id = new URL(page.url()).searchParams.get('session'); const row = await until(tasks, list => list.some(item => item.sessionId === id)); return { n, sessionId: id, taskId: row.find(item => item.sessionId === id).id }; };
    const saved = async value => { await until(() => task(value.taskId), value => value?.saveState === 'saved'); await expect(workspace.locator('.rag-answer')).toContainText(answer(value.n)); await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0); await expect(workspace.locator('.rag-message')).toHaveCount(2); };
    const authTask = await send(); await page.evaluate(() => window.dispatchEvent(new Event('study-log:auth-expired')));
    await expect(page.getByLabel('访问密码')).toBeVisible(); finish(authTask.n); await until(() => task(authTask.taskId), value => value?.saveState === 'saved');
    await page.getByLabel('访问密码').fill(environment.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(workspace).toContainText(answer(authTask.n)); await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    await expect(workspace.locator('.rag-message')).toHaveCount(2);
    record(`${engine}: a task completed while logged out replaces stale running state after same-page login`);
    await fresh();
    const first = await send(); await expect(workspace).toContainText(`第${first.n}次合成回答`); await expect(rows(page, first.sessionId).getByRole('status', { name: '正在生成', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '随记', exact: true }).click(); assert.ok(pending.has(first.n));
    const other = await pageFor(); currentPage = page; await expect(rows(other, first.sessionId)).toBeVisible(); await rows(other, first.sessionId).locator('.rag-session-main').click(); await expect(other.locator('.rag-workspace').filter({ visible: true })).toContainText(`第${first.n}次合成回答`);
    await navigate(page, `${base}?view=qa&session=${first.sessionId}`); await expect(workspace).toContainText(`第${first.n}次合成回答`); await navigate(page); await expect(workspace).toContainText(`第${first.n}次合成回答`);
    finish(first.n); await saved(first); await expect(other.locator('.rag-workspace').filter({ visible: true })).toContainText(answer(first.n)); assert.equal((await getSession(first.sessionId)).messages.length, 2);
    await until(() => getSession(first.sessionId), value => value?.titleSource === 'generated'); await navigate(page); await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace).toContainText(answer(first.n));
    record(`${engine}: module leave, refresh and independent browser recover one task and one saved pair`);

    const beforeRegenerate = streams;
    await workspace.getByRole('button', { name: '重新生成', exact: true }).first().click();
    await until(() => streams, value => value === beforeRegenerate + 1); finish(streams);
    await expect(workspace).toContainText(answer(streams)); await expect(workspace.locator('.rag-message')).toHaveCount(2);
    await until(() => getSession(first.sessionId), value => value?.messages.at(-1)?.content.includes(answer(streams)));
    await navigate(page); await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace).toContainText(answer(streams));
    record(`${engine}: successful regeneration replaces the final pair and remains a single pair after refresh`);

    await fresh(); holdTitles = true; const delayedTitle = await send(); finish(delayedTitle.n); await saved(delayedTitle);
    await until(() => heldTitles.length, n => n > 0); const nextDuringTitle = await send(); assert.ok(pending.has(nextDuringTitle.n));
    holdTitles = false; for (const respond of heldTitles.splice(0)) respond(); await until(() => getSession(delayedTitle.sessionId), value => value?.titleSource === 'generated');
    finish(nextDuringTitle.n); await until(() => task(nextDuringTitle.taskId), value => value?.saveState === 'saved'); await expect(workspace.locator('.rag-message')).toHaveCount(4);
    record(`${engine}: delayed automatic title neither blocks the next task nor causes a save conflict`);

    await fresh(); const queueFirst = await send(); await fresh(); await input.fill('合成保存排队中的第二个问题'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
    const queuedSession = new URL(page.url()).searchParams.get('session');
    const queued = (await until(tasks, list => list.some(item => item.sessionId === queuedSession && item.state === 'queued'))).find(item => item.sessionId === queuedSession);
    await expect(workspace).toContainText('正在等待前一项问答完成'); assert.equal(streams, queueFirst.n);
    finish(queueFirst.n); await until(() => streams, n => n === queueFirst.n + 1); finish(streams); await until(() => task(queued.id), value => value?.saveState === 'saved');
    await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace).toContainText(answer(streams));
    record(`${engine}: a second session queues, keeps its own view and starts only after the first completes`);

    await fresh(); let lostBody, lostResolve; const lost = new Promise(resolve => { lostResolve = resolve; });
    await page.route('**/api/rag/tasks', async route => {
      if (route.request().method() !== 'POST' || lostBody) return route.continue();
      lostBody = route.request().postDataJSON(); await route.fetch(); await route.abort('failed'); lostResolve();
    });
    const beforeLost = streams; await input.fill('合成保存响应丢失后如何继续？'); await page.getByRole('button', { name: '发送问题', exact: true }).click(); await lost; await navigate(page);
    await expect(workspace).toContainText(`第${beforeLost + 1}次合成回答`); assert.equal(streams, beforeLost + 1); finish(streams);
    const lostTask = await until(tasks, values => values.some(value => value.submissionId === lostBody.submissionId)); const recovered = lostTask.find(value => value.submissionId === lostBody.submissionId); await until(() => task(recovered.id), value => value?.saveState === 'saved');
    await expect(workspace.locator('.rag-message')).toHaveCount(2); assert.equal((await getSession(lostBody.sessionId)).messages.length, 2); await page.unroute('**/api/rag/tasks');
    record(`${engine}: accepted POST response lost, refresh recovers original submission without regeneration`);

    await fresh(); let unseenBody, unseenResolve; const unseen = new Promise(resolve => { unseenResolve = resolve; });
    await page.route('**/api/rag/tasks', async route => { if (route.request().method() !== 'POST' || unseenBody) return route.continue(); unseenBody = route.request().postDataJSON(); await route.abort('failed'); unseenResolve(); });
    const beforeUnseen = streams; await input.fill('合成保存请求未送达后如何继续？'); await page.getByRole('button', { name: '发送问题', exact: true }).click(); await unseen; await navigate(page);
    await until(() => streams, n => n === beforeUnseen + 1); finish(streams); await expect(workspace).toContainText(answer(streams));
    const unseenWrites = report.requests.filter(r => r.engine === engine && r.body?.submissionId === unseenBody.submissionId); assert.ok(unseenWrites.length >= 2); assert.deepEqual(unseenWrites[0].body, unseenWrites.at(-1).body); await page.unroute('**/api/rag/tasks');
    record(`${engine}: unsent POST survives refresh and retries identical submission identity`);

    await fresh(); const cancelled = await send(); await page.getByRole('button', { name: '停止生成', exact: true }).click(); await expect(workspace).toContainText('生成已停止'); await until(() => pending.has(cancelled.n), value => !value); assert.equal((await task(cancelled.taskId)).state, 'cancelled');
    const retryCalls = streams; await workspace.getByRole('button', { name: '重新生成', exact: true }).first().click(); await until(() => streams, n => n === retryCalls + 1); finish(streams); await expect(workspace).toContainText(answer(streams)); await expect(workspace.locator('.rag-message')).toHaveCount(2);
    await expect(workspace.locator('.rag-answer-versions')).toHaveText('2 / 2'); await workspace.getByRole('button',{name:'上一个回答版本'}).click();
    const stoppedSnapshot = await task(cancelled.taskId); await expect(workspace.locator('.rag-message-assistant')).toContainText('生成已停止');
    if (stoppedSnapshot.partial) await expect(workspace.locator('.rag-message-assistant')).toContainText(stoppedSnapshot.partial);
    else await expect(workspace.locator('.rag-message-assistant').locator('.rag-answer')).toHaveCount(0);
    await workspace.getByRole('button',{name:'下一个回答版本'}).click();await expect(workspace.locator('.rag-answer')).toContainText(answer(streams)); assert.equal((await getSession(cancelled.sessionId)).messages.length, 2);
    record(`${engine}: explicit cancel aborts generation; explicit retry creates one new task`);

    await fresh(); const blocked = path.join(instance, 'backups', 'rag-sessions'), held = path.join(instance, 'backups', `rag-sessions-held-${engine}`);
    await fs.rename(blocked, held); await fs.writeFile(blocked, 'synthetic save blocker');
    const failedSave = await send(); finish(failedSave.n); await until(() => task(failedSave.taskId), value => value?.saveState === 'error'); await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
    await navigate(page); await expect(workspace).toContainText(answer(failedSave.n)); await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
    await fs.unlink(blocked); await fs.rename(held, blocked); const callsBeforeSave = streams; await page.getByRole('button', { name: '重试保存', exact: true }).click(); await saved(failedSave); assert.equal(streams, callsBeforeSave);
    record(`${engine}: actual server save failure survives refresh; retry only saves the retained result`);

    await until(() => getSession(failedSave.sessionId), value => value?.titleSource === 'generated');
    const version = (await getSession(failedSave.sessionId)).version, conflict = await send();
    const renamed = await page.request.patch(`${base}/api/rag/sessions/${failedSave.sessionId}`, { data: { mutationId: randomUUID(), baseVersion: version, title: '另一端保留的合成标题' } }); assert.equal(renamed.status(), 200);
    const changed = (await renamed.json()).session; finish(conflict.n); await until(() => task(conflict.taskId), value => value?.saveState === 'conflict'); await expect(workspace).toContainText('会话已被另一端修改'); await expect(page.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0);
    await navigate(page); await expect(workspace).toContainText('会话已被另一端修改'); assert.equal((await getSession(changed.id)).version, changed.version);
    await page.getByRole('button', { name: '放弃此结果', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: '放弃', exact: true }).click(); await expect(workspace.locator('.rag-message')).toHaveCount(2); assert.equal((await getSession(changed.id)).version, changed.version);
    record(`${engine}: save conflict retains result, offers no overwrite and respects another client's version`);

    const deleted = await send(), deleteVersion = (await getSession(deleted.sessionId)).version;
    assert.equal((await page.request.delete(`${base}/api/rag/sessions/${deleted.sessionId}`, { data: { mutationId: randomUUID(), baseVersion: deleteVersion } })).status(), 200);
    await until(() => pending.has(deleted.n), value => !value); await expect(rows(page, deleted.sessionId)).toHaveCount(0); await expect(workspace.locator('.rag-message')).toHaveCount(0); assert.equal(await getSession(deleted.sessionId), null);
    record(`${engine}: another client deletes the session; recovery stops and never recreates it`);

    await fresh(); const failed = await send(); finish(failed.n, true); await expect(workspace.getByRole('button', { name: '重试', exact: true })).toBeVisible();
    await navigate(page); await expect(workspace.getByRole('button', { name: '重试', exact: true })).toBeVisible(); const beforeRetry = streams;
    await workspace.getByRole('button', { name: '重试', exact: true }).click(); await until(() => streams, n => n === beforeRetry + 1); finish(streams); await expect(workspace).toContainText(answer(streams)); await expect(workspace.locator('.rag-message')).toHaveCount(2);
    await expect(workspace.locator('.rag-answer-versions')).toHaveText('2 / 2');await workspace.getByRole('button',{name:'上一个回答版本'}).click();
    const failedSnapshot = await task(failed.taskId); await expect(workspace.locator('.rag-message-assistant')).toContainText(failedSnapshot.error || '回答生成失败');
    if (failedSnapshot.partial) await expect(workspace.locator('.rag-message-assistant')).toContainText(failedSnapshot.partial);
    await workspace.getByRole('button',{name:'下一个回答版本'}).click();await expect(workspace.locator('.rag-answer')).toContainText(answer(streams)); assert.equal((await getSession(failed.sessionId)).messages.length, 2);
    record(`${engine}: failed generation and partial remain discoverable; explicit retry succeeds once`);

    await page.setViewportSize({ width: 390, height: 844 }); await expect(input).toBeVisible(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(root, `${engine}-${theme}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: path.join(root, `${engine}-${theme}-desktop.png`), fullPage: true });
    const identity = (await (await page.request.get(`${base}/api/capabilities`)).json()).instanceId, beforeMismatch = streams;
    const mismatch = await page.request.post(`${base}/api/rag/tasks`, { headers: { 'X-Study-Log-Instance': randomUUID() }, data: { submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成保存实例隔离', mode: 'logs_only' } });
    assert.equal(mismatch.status(), 409); assert.equal((await mismatch.json()).code, 'RAG_INSTANCE_CHANGED'); assert.equal(streams, beforeMismatch); assert.ok(identity);
    record(`${engine}: desktop/mobile layout and actual instance-binding rejection`);

    for (const mode of [{ unavailable: true }, { unknownProtocol: true }]) {
      const blockedPage = await pageFor(mode); await blockedPage.getByRole('textbox', { name: '输入知识库问题', exact: true }).fill('合成保存不能静默退回普通请求');
      await expect(blockedPage.getByRole('button', { name: '发送问题', exact: true })).toBeDisabled();
      const index = contexts.indexOf(blockedPage.context()); assert.ok(!report.requests.some(r => r.engine === engine && r.page === index && r.method === 'POST' && /\/rag\/(tasks|query)$/.test(r.path)));
      await blockedPage.unrouteAll({ behavior: 'wait' }); await blockedPage.context().close();
    }
    record(`${engine}: unavailable or unknown task protocol blocks sending rather than silently using legacy generation`);

    const durableWrites = report.requests.filter(r => r.engine === engine && ['POST', 'PUT'].includes(r.method) && /\/rag\/sessions(?:\/[^/]+)?$/.test(r.path)); assert.equal(durableWrites.length, 0, JSON.stringify(durableWrites));
    const legacy = await pageFor({ legacy: true }), legacyInput = legacy.getByRole('textbox', { name: '输入知识库问题', exact: true }), legacyBefore = streams;
    await legacyInput.fill('合成保存旧服务器如何操作？'); await legacy.getByRole('button', { name: '发送问题', exact: true }).click(); await until(() => streams, n => n === legacyBefore + 1); finish(streams); await expect(legacy.locator('.rag-workspace').filter({ visible: true })).toContainText(answer(streams));
    const legacyId = new URL(legacy.url()).searchParams.get('session'); await until(() => getSession(legacyId), Boolean);
    const legacyIndex = contexts.indexOf(legacy.context()); assert.ok(report.requests.some(r => r.engine === engine && r.page === legacyIndex && /\/rag\/query$/.test(r.path) && r.method === 'POST'));
    assert.ok(!report.requests.some(r => r.engine === engine && r.page === legacyIndex && /\/rag\/tasks/.test(r.path))); await until(() => getSession(legacyId), value => value?.titleSource === 'generated'); await navigate(legacy); await expect(legacy.locator('.rag-workspace').filter({ visible: true })).toContainText(answer(streams));
    record(`${engine}: absent capability uses legacy query/client save, durable path never duplicates session writes`);
    (report.unhandledRejections ||= []).push(...unhandled);
    // WebKit sometimes reports a caught Fetch cancellation as pageerror while its document is leaving.
    // Keep the raw event and its actual navigation window; no other errors or unhandled rejections are allowed.
    const navigationTransport = browserErrors.filter(error => engine === 'webkit' && /^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/study-log\/api\/.*due to access control checks\./.test(error.stack || '') &&
      navigations.some(navigation => navigation.page === error.page && error.at >= navigation.startedAt && error.at <= (navigation.endedAt || navigation.startedAt) + 500));
    (report.navigationTransportDiagnostics ||= []).push(...navigationTransport); (report.navigations ||= []).push(...navigations);
    assert.deepEqual(unhandled, []); assert.deepEqual(browserErrors.filter(error => !navigationTransport.includes(error)), []);
    for (const context of contexts) { for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' }); await context.close(); } await browser.close(); browser = null;
  }
  assert.equal(await fs.readFile(sourceFile, 'utf8'), source); assert.equal(peak, 1);
  report.passed = true; report.maxConcurrentModelStreams = peak; report.sourceUnchanged = true; report.paidModelCalls = 0;
} catch (error) {
  report.passed = false; report.errors.push(error.stack || String(error));
  if (currentPage && !currentPage.isClosed()) { await currentPage.screenshot({ path: path.join(root, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(root, 'failure.html'), await currentPage.content().catch(() => '')); }
  throw error;
} finally {
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog);
  await browser?.close().catch(() => {});
  if (web && web.exitCode === null) { const closed = once(web, 'close'); web.kill(); await closed; }
  for (const res of pending.values()) res.destroy(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await mcp.close(); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}
