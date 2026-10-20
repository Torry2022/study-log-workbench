// Adapted from the personal edition: isolated public instance and model configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { initialize } from '../../ops/instance.mjs';
import { parseEnv } from 'node:util';

// Current production UI/API, real local MCP and SQLite/JSON; only the model is a loopback substitute.
const repo = path.resolve(import.meta.dirname, '..', '..'), root = path.join(repo, '.local', `mermaid-rendering-${Date.now()}`);
const instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.DASHSCOPE_API_KEY = ''; process.env.RERANK_ENABLED = 'false'; process.env.STUDY_LOG_INDEX_ROOT = path.join(root, 'index');
let source = '## 2026-09-01\n\n### 1. 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
source += "\n\n```mermaid\nflowchart TD\nA[unfinished\n```\n\n---\n\n## 2026-09-02\n\n### 1. 合法图表\n\n```mermaid\nflowchart TD\nA[Start] --> B[Done]\n```\n";
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
  for (const theme of ['light', 'dark']) for (const [engine, launcher, mobile] of [['chromium', chromium, false], ['chromium', chromium, true], ['webkit', webkit, false], ['webkit', webkit, true]]) {
    const label = `${engine}-${mobile ? 'phone' : 'desktop'}-${theme}`;
    if (process.env.RAG_LIVE_ONLY && process.env.RAG_LIVE_ONLY !== label) continue;
    browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(theme => localStorage.setItem('study-log-theme',theme),theme);
    const page = await context.newPage(); currentPage = page;
    const navigations = [], unhandled = [];
    const navigate = async url => {
      const entry = { startedAt: Date.now(), endedAt: null }; navigations.push(entry);
      try { return await (url ? page.goto(url) : page.reload()); } finally { entry.endedAt = Date.now(); }
    };
    await page.exposeFunction('captureLiveFollowUnhandled', value => unhandled.push(value));
    await page.addInitScript(() => addEventListener('unhandledrejection', event => { void window.captureLiveFollowUnhandled({ message: String(event.reason), stack: event.reason?.stack }); }));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.includes('/api/rag/')) report.requests.push({ label, path: url.pathname, method: request.method(), after: url.searchParams.get('after') });
    });
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
      catch (error) { report.errors.push({ engine: label, name, error: error.stack }); console.error(`FAIL ${label}: ${name}: ${error.message}`); }
    };
    await input.fill('合成保存时如何确认内容？');
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await until(() => streams, n => pending.has(n)); const n = streams;
    const write = text => pending.get(n).write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);

    const outside=()=>page.evaluate(()=>[...document.querySelectorAll('body > div[id^="dmermaid"],body > svg[id^="mermaid"],body > iframe[id^="imermaid"],[data-mermaid-render-host]')].map(el=>({id:el.id,height:el.getBoundingClientRect().height})));
    const assertClean=async phase=>{await pause(100);const nodes=await outside();(report.temporaryDom ||= []).push({label,phase,nodes});assert.deepEqual(nodes,[],'Mermaid must release renderer-owned temporary DOM');};
    await run('malformed diagram in a real streamed answer falls back without body artifacts',async()=>{
      write("\n\n```mermaid\nflowchart TD\nA[unfinished\n```\n\n");
      await expect(workspace.locator('pre.code-block')).toContainText('A[unfinished');
      await assertClean('invalid-answer');
    });
    finish(n);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    await run('a later valid diagram renders after the malformed answer and leaves no body artifacts',async()=>{
      await fresh();await input.fill('合成合法图表');await page.getByRole('button',{name:'发送问题',exact:true}).click();await until(()=>streams,value=>pending.has(value));const task=streams;
      pending.get(task).write('data: '+JSON.stringify({choices:[{delta:{content:"\n\n```mermaid\nflowchart TD\nA["},finish_reason:null}]})+'\n\n');
      await expect(workspace.locator('pre.code-block')).toContainText('A[');await assertClean('unfinished-answer');
      pending.get(task).write('data: '+JSON.stringify({choices:[{delta:{content:"Start] --> B[Done]\n```\n\n"},finish_reason:null}]})+'\n\n');
      try{await expect(workspace.locator('svg[data-mermaid-rendered]')).toBeVisible();await assertClean('valid-answer');}finally{finish(task);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);}
    });
    // Public URLs identify saved sessions explicitly; a bare QA URL starts a new conversation.
    const completedAnswerUrl = page.url();
    assert.ok(new URL(completedAnswerUrl).searchParams.get('session'), 'completed answer has a public session route');
    await run('log preview keeps its own code fallback and no external Mermaid error diagram',async()=>{
      await navigate(base+'?view=log&date=2026-09-01');
      await expect(page.locator('.reader-content .markdown-preview pre.code-block').filter({visible:true})).toContainText('A[unfinished');
      await assertClean('log-preview');
    });
    await run('log preview recovers to a valid diagram without external Mermaid DOM',async()=>{
      await navigate(base+'?view=log&date=2026-09-02');
      await expect(page.locator('.reader-content .markdown-preview svg[data-mermaid-rendered]').filter({visible:true})).toBeVisible();
      await assertClean('valid-log-preview');
    });
    await run('switching back to the completed answer preserves its valid diagram without external DOM',async()=>{
      await navigate(completedAnswerUrl);await expect(workspace.locator('svg[data-mermaid-rendered]')).toBeVisible();await assertClean('return-to-answer');
    });
    await page.screenshot({path:path.join(root,label+'-settled.png')});
    // Same narrow diagnostic as verify-rag-task-browser: WebKit emits caught
    // fetch cancellation as pageerror during document teardown. Keep all evidence.
    const teardownErrors = pageErrors.filter(error => engine === 'webkit' && /^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/study-log\/api\/.*due to access control checks\./.test(error.stack || '') && navigations.some(item => error.at >= item.startedAt && error.at <= (item.endedAt || item.startedAt) + 500));
    (report.navigationTransportDiagnostics ||= []).push(...teardownErrors); (report.navigations ||= []).push({ label, navigations });
    assert.deepEqual(unhandled, []); assert.deepEqual(pageErrors.filter(error => !teardownErrors.includes(error)), []);
    await context.close(); await browser.close(); browser = null;
  }
  assert.equal(await fs.readFile(sourceFile, 'utf8'), source);
  assert.equal(peak, 1, 'view updates and reconnection never execute another model concurrently');
  assert.equal(report.errors.length, 0, 'all Mermaid rendering checks must pass'); report.passed = true;
} catch (error) { report.failure = error.stack; if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error; }
finally {
  if (browser) await browser.close(); if (web) { web.kill(); await once(web, 'exit').catch(() => {}); }
  for (const res of pending.values()) res.destroy(); for (const respond of heldTitles.splice(0)) respond();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog);
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await mcp.close(); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}
