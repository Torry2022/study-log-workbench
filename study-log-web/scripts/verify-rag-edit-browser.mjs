import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { initialize } from '../../ops/instance.mjs';

// Current production UI/API, real local MCP and SQLite/JSON; only the model is a loopback substitute.
const repo = path.resolve(import.meta.dirname, '..', '..'), root = path.join(repo, '.local', `s36-rag-edit-${Date.now()}`);
const instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await initialize(instance);
const environment = { APP_PASSWORD: 'synthetic-task-browser-password', SESSION_SECRET: 'synthetic-task-browser-secret-32-characters-minimum', COOKIE_SECURE: 'false' };
process.env.DASHSCOPE_API_KEY = ''; process.env.RERANK_ENABLED = 'false'; process.env.STUDY_LOG_INDEX_ROOT = path.join(root, 'index');
const source = '## 2026-09-01\n\n### 1. 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const sourceFile = path.join(data, '2026-09_学习日志.md'); await fs.writeFile(sourceFile, source);
const report = { buildId: (await fs.readFile(path.join(repo, 'study-log-web/.next-build-cache/BUILD_ID'), 'utf8')).trim(), checks: [], requests: [], modelRequests: [], errors: [], root };
let phase = 'startup';
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); phase = `after ${name}`; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 20000) {
  const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(40); }
}
let streams = 0, active = 0, peak = 0, web, holdTitles = false;
const heldTitles = [];
const pending = new Map();
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); report.modelRequests.push({ stream: body.stream === true, model: body.model, messages: body.messages });
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
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, token: 'synthetic-browser-task-mcp', logRoot: data, indexRoot: path.join(root, 'index'), retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
let serverLog = '', currentPage, browser;
try {
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...environment, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
    CHAT_API_URL: `http://127.0.0.1:${model.address().port}/chat`, CHAT_API_KEY: 'synthetic-browser-model-key', CHAT_MODEL: 'synthetic-browser-model', CHAT_LIGHT_MODEL: 'synthetic-browser-model',
    STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-browser-task-mcp', WIKI_JEV_API_KEY: '', WIKI_COMPILE_TOKEN: '', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' } });
  web.stdout.on('data', value => serverLog += value); web.stderr.on('data', value => serverLog += value);
  await until(async () => fetch(base).then(r => r.ok).catch(() => false), Boolean);
  for (const [engine, launcher, theme] of [['chromium', chromium, 'light'], ['webkit', webkit, 'dark']]) {
    browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 760 }, colorScheme: theme });
    const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(20000);
    await page.addInitScript(theme => { localStorage.setItem('study-log-theme', theme); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.s36Copied = text; } } }); }, theme);
    page.on('pageerror', error => (report.browserErrors ||= []).push({ engine, phase, at: new Date().toISOString(), message: error.message, stack: error.stack }));
    page.on('requestfailed', request => (report.networkFailures ||= []).push({ engine, method: request.method(), path: new URL(request.url()).pathname, error: request.failure() }));
    page.on('request', request => { if (request.url().includes('/api/rag/tasks') && request.method() === 'POST') report.requests.push({ engine, method: request.method(), body: request.postDataJSON() }); });
    await page.goto(base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.workspace')).toBeVisible(); await page.getByRole('button', { name: '问答', exact: true }).click();
    const workspace = page.locator('.rag-workspace').filter({ visible: true });
    const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    const editor = page.getByRole('textbox', { name: '编辑问题', exact: true });
    const getSession = async () => { const id = new URL(page.url()).searchParams.get('session'); return (await (await page.request.get(`${base}/api/rag/sessions/${id}`)).json()).session; };
    const getTasks = async () => (await (await page.request.get(`${base}/api/rag/tasks`)).json()).tasks;
    const retryEdit = workspace.locator('.editor-navigation-status').getByRole('button', { name: '重试', exact: true });
    const rejectStaleEdit = async (status = 409) => {
      const before = streams;
      const rejected = page.waitForResponse(response => response.url().endsWith('/api/rag/tasks') && response.request().method() === 'POST');
      await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click();
      assert.equal((await rejected).status(), status);
      await expect(retryEdit).toBeVisible(); assert.equal(streams, before);
    };
    const start = async text => { const n = streams + 1; await input.fill(text); await page.getByRole('button', { name: '发送问题', exact: true }).click(); await until(() => streams, value => value === n); return n; };
    const settle = async n => { finish(n); await until(getSession, value => value?.messages.at(-1)?.content.includes(answer(n))); await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0); await expect(workspace.getByRole('button', { name: '编辑此问题', exact: true }).last()).toBeEnabled(); };
    await expect(input).toBeEnabled(); await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).click();
    const originalQuestion = `合成保存 [S1]\n${engine} 原始问题`;
    const first = await start(originalQuestion); await settle(first);
    await workspace.locator('.rag-user-actions').first().getByRole('button', { name: '复制问题' }).click();
    assert.equal(await page.evaluate(() => window.s36Copied), originalQuestion);
    const second = await start('合成保存的后续问题'); await settle(second);
    const canonical = await getSession(); assert.equal(canonical.messages.length, 4);
    await input.fill('独立保留的底部草稿');
    const callsBeforeEdit = streams;
    await page.evaluate(() => scrollTo(0, 0));
    await workspace.getByRole('button', { name: '编辑此问题', exact: true }).first().click();
    const revised = `合成保存：改写的首个问题 [S2]\n${engine} 保留编辑文字`;
    await editor.fill(revised);
    await editor.evaluate(element => element.setSelectionRange(2, 5)); await pause(1100);
    assert.deepEqual(await editor.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 5]);
    const editScroll = await page.evaluate(() => scrollY);
    if (editScroll !== 0 && process.argv.includes('--diagnostic')) (report.diagnostics ||= []).push({ engine, issue: 'inline-edit-scroll', expected: 0, actual: editScroll });
    else assert.equal(editScroll, 0);
    await editor.evaluate(element => { element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    assert.equal(streams, callsBeforeEdit);
    await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '随记', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
    await expect(editor).toHaveValue(revised); await expect(input).toHaveValue('独立保留的底部草稿');
    await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).click(); await input.fill('另一个会话的底部草稿');
    await page.locator(`.rag-session-item[data-session-id="${canonical.id}"] .rag-session-main`).click();
    await expect(editor).toHaveValue(revised); await expect(input).toHaveValue('独立保留的底部草稿');
    await page.locator('.rag-question-editor').getByRole('button', { name: '取消', exact: true }).click();
    await expect(workspace.locator('.rag-message')).toHaveCount(4);
    await expect(workspace.locator('.rag-message-user p').first()).toHaveText(originalQuestion);
    await workspace.getByRole('button', { name: '编辑此问题', exact: true }).first().click(); await expect(editor).toHaveValue(originalQuestion); await editor.fill(revised);
    assert.deepEqual(await getSession(), canonical);
    record(`${engine}: raw user copy, IME, cancel, module return and independent composer/edit drafts`);

    let lost = false;
    const edits = [];
    await page.route('**/api/rag/tasks', async route => {
      if (route.request().method() !== 'POST' || !route.request().postDataJSON().editMessageId) return route.continue();
      edits.push(route.request().postDataJSON());
      if (!lost) { lost = true; await route.fetch(); return route.abort('failed'); }
      return route.continue();
    });
    const cancelNumber = streams + 1;
    await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click();
    await until(() => streams, n => n === cancelNumber);
    await until(getTasks, tasks => tasks.some(task => task.submissionId === edits[0]?.submissionId)); await pause(1300);
    assert.equal(edits.length, 1); assert.equal(edits[0].editMessageId, canonical.messages[0].id);
    assert.deepEqual(await getSession(), canonical);
    await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(input).toHaveValue('独立保留的底部草稿');
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await until(() => pending.has(cancelNumber), value => !value);
    await expect(editor).toHaveValue(revised); await expect(workspace.locator('.rag-message')).toHaveCount(4); assert.deepEqual(await getSession(), canonical);
    await page.unroute('**/api/rag/tasks');
    record(`${engine}: lost edit receipt reuses one submission; cancel restores the original branch and inline draft`);

    let n = streams + 1;
    await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click(); await until(() => streams, value => value === n); finish(n, true);
    await expect(editor).toHaveValue(revised); await expect(workspace.locator('.rag-message')).toHaveCount(4); assert.deepEqual(await getSession(), canonical);
    n = streams + 1;
    await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click(); await until(() => streams, value => value === n); finish(n);
    await until(getSession, value => value?.messages.length === 2 && value.messages[0].content === revised);
    await expect(editor).toHaveCount(0); await expect(workspace.locator('.rag-message')).toHaveCount(2);
    await expect(input).toHaveValue('独立保留的底部草稿');
    const edited = await getSession(); assert.notEqual(edited.messages[0].id, canonical.messages[0].id);
    const tasks = await getTasks(); assert.ok(tasks.some(task => task.sessionId === edited.id && task.applicable === false));
    const sql = new DatabaseSync(path.join(data, 'state/rag-tasks.sqlite'), { readOnly: true });
    assert.equal(sql.prepare('PRAGMA user_version').get().user_version, 3); sql.close();
    const time = workspace.locator('.rag-time-separator time'); await expect(time).toHaveCount(1);
    const originalTask = (await getTasks()).find(task => `${task.id}:user` === edited.messages[0].id);
    assert.equal(await time.getAttribute('datetime'), new Date(originalTask.createdAt).toISOString());
    record(`${engine}: provider failure keeps the old branch; successful early edit atomically replaces it with a new question identity and real timestamp`);

    await input.fill(''); await page.reload(); await expect(workspace.locator('.rag-message')).toHaveCount(2); await expect(workspace.locator('.rag-message-user p')).toHaveText(revised);
    const follow = await start('修改后追加的合成问题'); await settle(follow);
    const beforeLast = await getSession();
    await workspace.getByRole('button', { name: '编辑此问题', exact: true }).last().click(); await editor.fill('合成保存：最后问题的改写');
    n = streams + 1; await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click(); await until(() => streams, value => value === n); finish(n);
    await until(getSession, value => value?.messages.at(-2)?.content === '合成保存：最后问题的改写');
    const afterLast = await getSession(); assert.deepEqual(afterLast.messages.slice(0, 2), beforeLast.messages.slice(0, 2)); assert.equal(afterLast.messages.length, 4);
    await expect(editor).toHaveCount(0);
    record(`${engine}: refresh never resurrects the removed branch; last-question edit retains its parent pair`);

    await workspace.getByRole('button', { name: '编辑此问题', exact: true }).last().click(); await editor.fill('合成保存：并发冲突时保留的编辑文字');
    n = streams + 1; await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click(); await until(() => streams, value => value === n);
    const beforeConflict = await getSession();
    const changed = await page.request.put(`${base}/api/rag/sessions/${beforeConflict.id}`, { data: { mutationId: randomUUID(), baseVersion: beforeConflict.version, answerMode: beforeConflict.answerMode,
      messages: [...beforeConflict.messages.slice(0, -1), { ...beforeConflict.messages.at(-1), content: '另一客户端已保存的回答' }] } }); assert.equal(changed.status(), 200);
    const concurrent = (await changed.json()).session; finish(n);
    await expect(workspace).toContainText('会话已被另一端修改'); assert.deepEqual(await getSession(), concurrent);
    await workspace.getByRole('button', { name: '放弃此结果', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃', exact: true }).click();
    await expect(editor).toHaveValue('合成保存：并发冲突时保留的编辑文字');
    await rejectStaleEdit(); await retryEdit.click();
    await expect(editor).toHaveValue('合成保存：并发冲突时保留的编辑文字');
    await page.locator('.rag-question-editor').getByRole('button', { name: '取消', exact: true }).click();
    record(`${engine}: save conflict preserves the other client and recovers the inline draft after explicit reload`);

    const row = page.locator(`.rag-session-item[data-session-id="${concurrent.id}"]`);
    const geometry = await row.evaluate(element => { const title = element.querySelector('.rag-session-main').getBoundingClientRect(), more = element.querySelector('.rag-session-menu-button').getBoundingClientRect(), time = element.querySelector('.rag-session-meta').getBoundingClientRect(); return { titleRight: title.right, moreLeft: more.left, moreRight: more.right, timeLeft: time.left }; });
    assert.ok(geometry.titleRight <= geometry.moreLeft + 1 && geometry.moreRight <= geometry.timeLeft + 1);
    const firstRow = page.locator('.rag-history-groups .rag-session-item').first();
    const rowPosition = async () => ({ row: (await firstRow.boundingBox()).y, sidebar: (await page.locator('.sidebar').boundingBox()).y, scrollY: await page.evaluate(() => scrollY),
      list: await page.locator('.rag-history-groups').evaluate(element => ({ top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height, scrollTop: element.scrollTop })) });
    const beforeFailure = await rowPosition();
    await page.route('**/api/rag/sessions?q=*', async route => { await pause(700); return route.fulfill({ status: 503, json: { error: '合成历史读取失败' } }); });
    await page.route('**/api/capabilities', route => route.fulfill({ status: 503, json: { error: '合成配置读取失败' } }));
    await page.getByRole('button', { name: '随记', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
    const availability = page.locator('.feature-availability'); await expect(availability).toBeVisible();
    assert.ok((await availability.boundingBox()).height < 140); await availability.locator('summary').click(); await expect(availability).toContainText('合成配置读取失败');
    await expect(page.getByRole('button', { name: '历史问答更新失败，重试' })).toHaveAttribute('title', '合成历史读取失败');
    const afterFailure = await rowPosition(); (report.sidebarGeometry ||= []).push({ engine, before: beforeFailure, after: afterFailure });
    assert.ok(Math.abs((afterFailure.row - afterFailure.sidebar) - (beforeFailure.row - beforeFailure.sidebar)) < 1);
    const feedback = availability;
    await expect(workspace.locator('.rag-message')).toHaveCount(4);
    await page.unroute('**/api/rag/sessions?q=*'); await page.unroute('**/api/capabilities');
    await feedback.getByRole('button', { name: '重新检查', exact: true }).click(); await page.getByRole('button', { name: '历史问答更新失败，重试' }).click();
    await expect(page.getByRole('button', { name: '历史问答更新失败，重试' })).toHaveCount(0); await expect(feedback).toHaveCount(0);
    record(`${engine}: history/configuration failures retain the conversation, use compact correct error owners and keep the sidebar top fixed`);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(workspace.getByRole('button', { name: '复制问题', exact: true }).first()).toBeVisible();
    assert.ok((await workspace.getByRole('button', { name: '复制问题', exact: true }).first().boundingBox()).height >= 32);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(root, `${engine}-inline-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/capabilities', async route => { const response = await route.fetch(), json = await response.json(); delete json.features.ragTasks.questionEditing; await route.fulfill({ response, json }); });
    await page.getByRole('button', { name: '随记', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '编辑此问题', exact: true }).first()).toBeDisabled();
    await page.unroute('**/api/capabilities');
    record(`${engine}: touch-width user actions stay visible, no overflow, old server capability never falls back to append`);
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, storageState: await context.storageState(), colorScheme: theme });
    const touchPage = await touch.newPage(); touchPage.on('pageerror', error => (report.browserErrors ||= []).push({ engine, phase: 'coarse-pointer context', at: new Date().toISOString(), message: error.message, stack: error.stack })); await touchPage.goto(`${base}?view=qa&session=${concurrent.id}`);
    const touchCopy = touchPage.getByRole('button', { name: '复制问题', exact: true }).first(); await expect(touchCopy).toBeVisible(); assert.ok((await touchCopy.boundingBox()).height >= 44);
    await touchPage.getByRole('button', { name: '编辑此问题', exact: true }).first().tap();
    await expect(touchPage.getByRole('textbox', { name: '编辑问题', exact: true })).toBeVisible();
    await touchPage.locator('.rag-question-editor').getByRole('button', { name: '取消', exact: true }).tap();
    assert.equal(await touchPage.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; }), false);
    record(`${engine}: real coarse-pointer controls are 44px; cancelling inline edit leaves no dirty draft`);
    await touch.close();
    await page.getByRole('button', { name: '随记', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
    await expect(workspace.getByRole('button', { name: '编辑此问题', exact: true }).last()).toBeEnabled();
    const editBase = await getSession();
    await workspace.getByRole('button', { name: '编辑此问题', exact: true }).last().click(); await editor.fill('合成保存：后台重读不得更换原基线');
    const backgroundNumber = streams + 1;
    const background = await page.request.post(`${base}/api/rag/tasks`, { data: { submissionId: randomUUID(), sessionId: editBase.id, baseVersion: editBase.version, question: '合成保存：其他客户端追加', mode: 'logs_only' } });
    assert.equal(background.status(), 200); await until(() => streams, value => value === backgroundNumber);
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible(); finish(backgroundNumber);
    await until(getSession, value => value.messages.length === editBase.messages.length + 2);
    await expect(editor).toHaveValue('合成保存：后台重读不得更换原基线');
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    await expect(workspace.locator('.rag-message-user').last()).toContainText('合成保存：其他客户端追加');
    const submitted = page.waitForRequest(request => request.url().endsWith('/api/rag/tasks') && request.method() === 'POST');
    await page.locator('.rag-question-editor').getByRole('button', { name: '发送', exact: true }).click();
    assert.equal((await submitted).postDataJSON().baseVersion, editBase.version);
    await expect(workspace).toContainText('会话已变化'); assert.equal(streams, backgroundNumber);
    await retryEdit.click();
    await expect(editor).toHaveValue('合成保存：后台重读不得更换原基线');
    record(`${engine}: real background task refresh cannot silently rebase an open draft; stale send is rejected before generation`);
    const latest = await getSession();
    const removedTarget = await page.request.put(`${base}/api/rag/sessions/${latest.id}`, { data: { mutationId: randomUUID(), baseVersion: latest.version, answerMode: latest.answerMode, messages: latest.messages.slice(0, 2) } }); assert.equal(removedTarget.status(), 200);
    await rejectStaleEdit(); await retryEdit.click();
    await expect(page.getByRole('textbox', { name: '保留的修改稿', exact: true })).toHaveValue('合成保存：后台重读不得更换原基线');
    await page.getByRole('button', { name: '复制修改稿', exact: true }).click(); assert.equal(await page.evaluate(() => window.s36Copied), '合成保存：后台重读不得更换原基线');
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '保留的修改稿', exact: true })).toHaveCount(0);
    await workspace.getByRole('button', { name: '编辑此问题', exact: true }).first().click(); await editor.fill('会话删除后仍需保留的草稿');
    const beforeDelete = await getSession(); const deleted = await page.request.delete(`${base}/api/rag/sessions/${beforeDelete.id}`, { data: { mutationId: randomUUID(), baseVersion: beforeDelete.version } }); assert.equal(deleted.status(), 200);
    await rejectStaleEdit(410); await retryEdit.click();
    await expect(page.getByRole('textbox', { name: '保留的修改稿', exact: true })).toHaveValue('会话删除后仍需保留的草稿');
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    record(`${engine}: removed targets and deleted sessions retain visible recoverable drafts until explicit cancellation`);
    await context.close(); await browser.close(); browser = null;
  }
  assert.equal(await fs.readFile(sourceFile, 'utf8'), source); assert.equal(peak, 1);
  assert.deepEqual(report.diagnostics || [], [], 'Recorded diagnostics must be resolved before acceptance');
  report.layoutNotices = (report.browserErrors || []).filter(error => error.message === 'ResizeObserver loop completed with undelivered notifications.');
  assert.deepEqual((report.browserErrors || []).filter(error => error.message !== 'ResizeObserver loop completed with undelivered notifications.'), [], 'Unexpected uncaught browser errors');
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
