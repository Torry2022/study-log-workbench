// Adapted from personal 918a05c: public instance initialization, MCP API and model configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { initialize } from '../../ops/instance.mjs';
import { parseEnv } from 'node:util';

// Current production UI/API, real local MCP and SQLite/JSON; only the model is a loopback substitute.
const repo = path.resolve(import.meta.dirname, '..', '..'), root = path.join(repo, '.local', `rag-live-follow-${Date.now()}`);
const instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.DASHSCOPE_API_KEY = ''; process.env.RERANK_ENABLED = 'false'; process.env.STUDY_LOG_INDEX_ROOT = path.join(root, 'index');
const source = '## 2026-09-01\n\n### 1. 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n' +
  Array.from({ length: 35 }, (_, index) => `\n\n合成日志段落${index}：离开问答后，当前日志的阅读位置由日志页面拥有。`).join('');
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
const finish = n => {
  const res = pending.get(n); assert.ok(res, `model ${n} is waiting`);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
};
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-browser-task-mcp', retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
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
  for (const [engine, launcher, mobile] of [['chromium', chromium, false], ['chromium', chromium, true], ['webkit', webkit, false], ['webkit', webkit, true]]) {
    const label = `${engine}-${mobile ? 'phone' : 'desktop'}`;
    if (process.env.RAG_LIVE_ONLY && process.env.RAG_LIVE_ONLY !== label) continue;
    browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => {
      window.followCalls = 0;
      window.followTrace = [];
      addEventListener('scroll', () => { window.followTrace.push({ y: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight, calls: window.followCalls }); window.followTrace = window.followTrace.slice(-30); }, { passive: true });
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(...args) { if (this.classList.contains('rag-scroll-anchor')) window.followCalls++; window.followTrace.push({ type: 'scrollIntoView', className: this.className, stack: new Error().stack }); return original.apply(this, args); };
    });
    const page = await context.newPage(); currentPage = page;
    const navigations = [], unhandled = [];
    const navigate = async url => {
      const entry = { startedAt: Date.now(), endedAt: null }; navigations.push(entry);
      try { return await (url ? page.goto(url) : page.reload()); } finally { entry.endedAt = Date.now(); }
    };
    await page.exposeFunction('captureLiveFollowUnhandled', value => unhandled.push(value));
    await page.addInitScript(() => addEventListener('unhandledrejection', event => { void window.captureLiveFollowUnhandled({ message: String(event.reason), stack: event.reason?.stack }); }));
    const cdp = mobile && engine === 'chromium' ? await context.newCDPSession(page) : null;
    const gesture = async delta => {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
        for (let step = 1; step <= 4; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400 - delta * step / 4 }] }); await pause(20);
        }
        await pause(80); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      else if (mobile) await page.evaluate(delta => {
        // Match the non-editable reading surface receiving a touch gesture.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const emit = (name, y) => { const event = new Event(name); Object.defineProperty(event, 'touches', { value: [{ clientY: y }] }); window.dispatchEvent(event); };
        emit('touchstart', 400); emit('touchmove', 400 - delta); window.scrollBy(0, delta); emit('touchend', 400 - delta);
      }, delta);
      else await page.mouse.wheel(0, delta);
    };
    (report.inputCoverage ||= []).push({ label, input: cdp ? 'Chromium CDP native touch gesture' : mobile ? 'WebKit synthetic touch events plus scrollBy (not native touch)' : 'browser wheel input' });
    let eventConnections = 0;
    const openEvents = new Set();
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.includes('/api/rag/')) report.requests.push({ label, path: url.pathname, method: request.method(), after: url.searchParams.get('after') });
      if (url.pathname.endsWith('/events')) { eventConnections++; openEvents.add(request); }
    });
    page.on('requestfinished', request => openEvents.delete(request));
    page.on('requestfailed', request => openEvents.delete(request));
    const pageErrors = []; page.on('pageerror', error => pageErrors.push({ at: Date.now(), message: error.message, stack: error.stack }));
    await navigate(base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '问答', exact: true }).click();
    const workspace = page.locator('.rag-workspace').filter({ visible: true });
    const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    await expect(input).toBeEnabled();
    const fresh = async () => {
      if (mobile && !await page.locator('.sidebar.mobile-open').count()) await page.getByRole('button', { name: '打开问答历史', exact: true }).click();
      await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).first().click();
    };
    await fresh();
    await expect(workspace.locator('.rag-message')).toHaveCount(0);
    const run = async (name, work) => {
      try { await work(); record(`${label}: ${name}`); }
      catch (error) { report.errors.push({ engine: label, name, error: error.stack, scrollTrace: await page.evaluate(() => window.followTrace) }); console.error(`FAIL ${label}: ${name}: ${error.message}`); throw error; }
    };
    await input.fill('合成保存时如何确认内容？');
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await until(() => streams, n => pending.has(n)); const n = streams;
    const write = text => pending.get(n).write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
    await run('a real unfinished model fragment is visible before the next one-second reconciliation', async () => {
      await expect(workspace.locator('.rag-answer')).toContainText(`第${n}次合成回答`, { timeout: 700 });
      assert.ok(eventConnections > 0, 'visible updates must subscribe to the existing event stream');
    });
    write('\n\n' + Array.from({ length: 45 }, (_, i) => `第${i + 1}段：${'合成保存需要先确认内容，再保存。'.repeat(5)}`).join('\n\n'));
    await expect(workspace.locator('.rag-answer')).toContainText('第45段');
    await pause(300);
    await run('first submission follows long real output without a manual scroll', async () => {
      const geometry = await page.evaluate(() => ({ remaining: document.documentElement.scrollHeight - innerHeight - scrollY, composerTop: document.querySelector('.rag-composer').getBoundingClientRect().top, anchorBottom: document.querySelector('.rag-scroll-anchor').getBoundingClientRect().bottom }));
      (report.followGeometry ||= []).push({ label, ...geometry }); assert.ok(geometry.remaining < 40, JSON.stringify(geometry));
    });
    await page.screenshot({ path: path.join(root, `${label}-streaming.png`) });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pause(120);
    await page.mouse.move(mobile ? 200 : 900, 450); await gesture(-80); await pause(100);
    const pausedY = await page.evaluate(() => scrollY);
    write('\n\n第二个真实分片：继续确认内容。');
    await run('small upward user scroll suspends following even near the bottom', async () => {
      await expect(workspace.locator('.rag-answer')).toContainText('第二个真实分片', { timeout: 700 }); await pause(300);
      const after = await page.evaluate(() => scrollY); assert.ok(Math.abs(after - pausedY) < 3, JSON.stringify({ pausedY, after }));
    });
    await page.screenshot({ path: path.join(root, `${label}-paused.png`) });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pause(100);
    write('\n\n第三个真实分片：' + '确认内容后再保存。'.repeat(100));
    await run('returning to the bottom resumes live following', async () => {
      await expect(workspace.locator('.rag-answer')).toContainText('第三个真实分片'); await pause(250);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY) < 40);
    });
    await gesture(-80); await pause(100);
    const beforeDone = await page.evaluate(() => scrollY);
    (report.focusGeometry ||= []).push({ label, phase: 'before-done', active: await page.evaluate(() => ({ tag: document.activeElement.tagName, className: document.activeElement.className, anchor: getComputedStyle(document.querySelector('.rag-workspace')).overflowAnchor })) });
    holdTitles = true; finish(n);
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    (report.completionGeometry ||= []).push({ label, phase: 'before-draft', beforeDone, y: await page.evaluate(() => scrollY), calls: await page.evaluate(() => window.followCalls) });
    await run('completion and later draft/title rerenders never reclaim user scrolling', async () => {
      await input.fill('保留的合成草稿'); await pause(1400);
      (report.completionGeometry ||= []).push({ label, phase: 'after-draft', y: await page.evaluate(() => scrollY), calls: await page.evaluate(() => window.followCalls) });
      const after = await page.evaluate(() => scrollY); assert.ok(Math.abs(after - beforeDone) < 3, JSON.stringify({ beforeDone, after }));
      await until(() => heldTitles.length, count => count > 0);
      holdTitles = false; for (const respond of heldTitles.splice(0)) respond(); await pause(300);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - beforeDone) < 3);
      await input.fill('');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pause(150);
      await gesture(-80); await pause(100); const y = await page.evaluate(() => scrollY);
      await input.fill('再次合成草稿'); await pause(1200);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - y) < 3);
      await input.fill('');
    });
    holdTitles = false; for (const respond of heldTitles.splice(0)) respond();
    await input.fill(''); await input.blur();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pause(300);
    await run('bottom repeated downward and bidirectional input does not change height or oscillate the composer', async () => {
      const baseline = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, y: scrollY }));
      const calls = await page.evaluate(() => window.followCalls);
      await page.evaluate(() => {
        window.bottomFrames = []; window.captureBottomFrames = true;
        const frame = () => { window.bottomFrames.push({ height: document.documentElement.scrollHeight, y: scrollY, composer: document.querySelector('.rag-composer').getBoundingClientRect().top }); if (window.captureBottomFrames) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      });
      for (let i = 0; i < 8; i++) { await gesture(80); await pause(75); }
      const frames = await page.evaluate(() => { window.captureBottomFrames = false; return window.bottomFrames; });
      assert.ok(frames.length > 1);
      assert.ok(frames.every(frame => frame.height === baseline.height && Math.abs(frame.y - baseline.y) < 2));
      assert.ok(Math.max(...frames.map(frame => frame.composer)) - Math.min(...frames.map(frame => frame.composer)) < 2);
      (report.bottomFrames ||= []).push({ label, frames });
      const after = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, y: scrollY }));
      assert.deepEqual(after, baseline);
      for (let i = 0; i < 4; i++) { await gesture(-60); await pause(100); await gesture(60); await pause(100); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), baseline.height);
      assert.equal(await page.evaluate(() => window.followCalls), calls, 'settled wheel scrolling cannot call the live output follower');
    });
    await run('expanding a completed answer source never invokes live following', async () => {
      const calls = await page.evaluate(() => window.followCalls);
      await workspace.locator('.rag-citation').first().click(); await expect(workspace.locator('.rag-citation-detail').first()).toBeVisible();
      await pause(250); assert.equal(await page.evaluate(() => window.followCalls), calls);
      await workspace.locator('.rag-citation').first().click();
    });
    await run('middle-of-answer scrolling and composer hide/show keep document height stable', async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2)); await pause(250);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await gesture(-70); await pause(250);
      const y = await page.evaluate(() => scrollY); await pause(500);
      assert.equal(await page.evaluate(() => scrollY), y);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height);
      await gesture(70); await pause(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height);
    });
    await page.screenshot({ path: path.join(root, `${label}-settled.png`) });
    await run('regeneration follows new output; switching and reopening start at the top without another generation', async () => {
      await workspace.getByRole('button', { name: '重新生成', exact: true }).last().click();
      await until(() => streams, count => count === n + 1);
      await expect(workspace.locator('.rag-answer')).toContainText(`第${n + 1}次合成回答`, { timeout: 700 });
      const id = new URL(page.url()).searchParams.get('session');
      await fresh();
      await expect(workspace.locator('.rag-message')).toHaveCount(0);
      assert.ok(pending.has(n + 1), 'leaving never cancels the server task');
      await navigate(`${base}?view=qa&session=${id}`);
      await expect(workspace.locator('.rag-answer')).toContainText(`第${n + 1}次合成回答`);
      assert.equal(await page.evaluate(() => scrollY), 0);
      finish(n + 1); await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
      await navigate(); await expect(workspace.locator('.rag-message')).toHaveCount(2);
      assert.equal(await page.evaluate(() => scrollY), 0); assert.equal(streams, n + 1);
    });
    await run('leaving QA disconnects only its viewing stream and cannot scroll or focus the log page', async () => {
      await fresh(); await input.fill('合成保存的模块切换检查');
      await page.getByRole('button', { name: '发送问题', exact: true }).click();
      await until(() => streams, count => count === n + 2);
      const held = streams, id = new URL(page.url()).searchParams.get('session');
      const tasks = await page.request.get(`${base}/api/rag/tasks?sessionId=${id}`).then(r => r.json());
      const taskId = tasks.tasks[0].id;
      pending.get(held).write(`data: ${JSON.stringify({ choices: [{ delta: { content: '离开前的大块中文👩🏽‍💻。'.repeat(180) }, finish_reason: null }] })}\n\n`);
      await until(() => page.request.get(`${base}/api/rag/tasks/${taskId}`).then(r => r.json()), value => value.task.partial.includes('离开前的大块'));
      await page.getByRole('button', { name: '日志', exact: true }).filter({ visible: true }).last().click();
      await expect(page.locator('.app-shell.view-log')).toBeVisible();
      if (mobile) await page.getByRole('button', { name: '打开日志导航', exact: true }).click();
      await page.locator('.month-list .nav-item').filter({ hasText: '2026-09' }).click();
      await expect(page.locator('.workspace-view:not([hidden]) .markdown-preview')).toContainText('合成日志段落34');
      if (mobile) await page.keyboard.press('Escape');
      await expect.poll(() => page.locator('html').getAttribute('data-workspace-transition')).toBeNull();
      await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0);
      await until(() => openEvents.size, size => size === 0);
      await page.evaluate(() => scrollTo({ top: 420, behavior: 'instant' })); await pause(250);
      const before = await page.evaluate(() => ({ y: scrollY, calls: window.followCalls }));
      assert.ok(before.y > 100, 'use a genuinely scrollable synthetic log');
      const tail = '后台新增但不应干扰日志的片段。';
      pending.get(held).write(`data: ${JSON.stringify({ choices: [{ delta: { content: tail }, finish_reason: null }] })}\n\n`);
      await until(() => page.request.get(`${base}/api/rag/tasks/${taskId}`).then(r => r.json()), value => value.task.partial.includes(tail));
      // Reopening must not replay material already received by this workspace;
      // the server accepting a delta does not mean hidden polling received it yet.
      await expect(page.locator('.rag-workspace[hidden] .rag-answer')).toContainText(tail);
      await pause(350);
      assert.deepEqual(await page.evaluate(() => ({ y: scrollY, calls: window.followCalls })), before);
      assert.equal(await page.evaluate(() => document.activeElement?.closest('.rag-composer') !== null), false);
      assert.ok(pending.has(held)); assert.equal(streams, held);
      report.moduleTask = { held, id, taskId, tail, connections: eventConnections };
    });
    await run('returning to a mounted QA page shows its current snapshot without replay and resumes SSE', async () => {
      const saved = report.moduleTask; assert.ok(saved);
      const snapshot = await page.request.get(`${base}/api/rag/tasks/${saved.taskId}`).then(r => r.json());
      await page.evaluate(() => {
        window.moduleFrames = []; let count = 0;
        const sample = () => {
          const qa = document.querySelector('.rag-workspace');
          if (qa?.getClientRects().length) window.moduleFrames.push(qa.querySelector('.rag-answer .markdown-preview')?.textContent || '');
          if (++count < 40) requestAnimationFrame(sample);
        }; requestAnimationFrame(sample);
      });
      await page.getByRole('button', { name: '问答', exact: true }).filter({ visible: true }).last().click();
      await expect(workspace).toBeVisible(); await expect(workspace.locator('.rag-answer')).toContainText(saved.tail);
      await until(() => eventConnections, count => count > saved.connections); await pause(300);
      const frames = await page.evaluate(() => window.moduleFrames.filter(Boolean));
      (report.moduleFrames ||= []).push({ label, frames, receivedTail: saved.tail });
      assert.ok(frames.length > 0); assert.ok(frames.every(text => text.includes(saved.tail)), 'the prior presentation queue cannot replay after module return');
      assert.ok(snapshot.task.partial.includes(saved.tail)); assert.equal(streams, saved.held);
      finish(saved.held); await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    });
    // Same narrow diagnostic as verify-rag-task-browser: WebKit emits caught
    // fetch cancellation as pageerror during document teardown. Keep all evidence.
    const teardownErrors = pageErrors.filter(error => engine === 'webkit' && /^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/study-log\/api\/.*due to access control checks\./.test(error.stack || '') && navigations.some(item => error.at >= item.startedAt && error.at <= (item.endedAt || item.startedAt) + 500));
    (report.navigationTransportDiagnostics ||= []).push(...teardownErrors); (report.navigations ||= []).push({ label, navigations });
    assert.deepEqual(unhandled, []); assert.deepEqual(pageErrors.filter(error => !teardownErrors.includes(error)), []);
    await context.close(); await browser.close(); browser = null;
  }
  assert.equal(await fs.readFile(sourceFile, 'utf8'), source);
  assert.equal(peak, 1, 'view updates and reconnection never execute another model concurrently');
  assert.equal(report.errors.length, 0, 'all live-follow checks must pass'); report.passed = true;
} catch (error) { report.failure = error.stack; if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error; }
finally {
  if (browser) await browser.close(); if (web) { web.kill(); await once(web, 'exit').catch(() => {}); }
  for (const res of pending.values()) res.destroy(); for (const respond of heldTitles.splice(0)) respond();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog);
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await mcp.close(); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}
