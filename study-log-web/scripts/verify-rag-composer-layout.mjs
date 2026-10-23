// Adapted from personal 3744917: public instance initialization, MCP API and model configuration.
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
const repo = path.resolve(import.meta.dirname, '..', '..'), root = path.join(repo, '.local', `rag-composer-layout-${Date.now()}`);
const instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.DASHSCOPE_API_KEY = ''; process.env.RERANK_ENABLED = 'false'; process.env.STUDY_LOG_INDEX_ROOT = path.join(root, 'index');
const source = '## 2026-09-01\n\n### 1. 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const sourceFile = path.join(data, '2026-09_学习日志.md'); await fs.writeFile(sourceFile, source);
const report = { checks: [], requests: [], modelRequests: [], errors: [], root };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 20000) {
  const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(40); }
}
let streams = 0, active = 0, peak = 0, web;
const pending = new Map();
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); report.modelRequests.push({ stream: body.stream === true, model: body.model });
  if (!body.stream) {
    const title = body.messages?.[0]?.content?.includes('短语式标题');
    const respond = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: title ? '合成保存问答' : JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); };
    respond(); return;
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
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); currentPage = page;
    await page.goto(base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
    await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).first().click();
    const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    await input.fill('合成保存应如何确认？'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await until(() => streams, n => pending.has(n)); const n = streams;
    const text = Array.from({length: 30}, (_,i) => `\n\n### 合成段落${i}\n\n` + '合成学习记录用于检查阅读位置与末尾操作按钮。'.repeat(7)).join('');
    pending.get(n).write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
    finish(n);
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    await expect(page.locator('.rag-answer')).toContainText('合成段落29'); await pause(500);
    const geometry = () => page.evaluate(() => {
      const form = document.querySelector('.rag-composer'), actions = document.querySelector('.rag-message-assistant:last-child .rag-answer-actions');
      const f=form.getBoundingClientRect(), a=actions.getBoundingClientRect();
      return { top:f.top,bottom:f.bottom,height:f.height,actionTop:a.top,actionBottom:a.bottom,remaining:document.documentElement.scrollHeight-scrollY-innerHeight,scrollY,documentHeight:document.documentElement.scrollHeight,position:getComputedStyle(form.parentElement).position };
    });
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await pause(200);
    const exact = await geometry(); assert.ok(exact.actionBottom <= exact.top, 'exact bottom remains separated');
    for (const offset of [100,170]) {
      await page.evaluate(offset => scrollTo(0,document.documentElement.scrollHeight-innerHeight-offset), offset); await pause(250);
      const near = await geometry();
      (report.geometry ||= []).push({engine,phase:`near bottom ${offset}px`,...near});
      if (near.actionBottom > near.top && near.actionTop < near.bottom) report.errors.push(`${engine}: near-bottom ${offset}px actions overlapped`);
      await page.screenshot({path:path.join(root,`${engine}-near-bottom-${offset}.png`)});
    }
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await pause(150);
    await input.fill(Array.from({length:25},(_,i)=>`待发送合成段落${i}`).join('\n')); await pause(250);
    const expanded = await geometry(); (report.geometry ||= []).push({engine,phase:'textarea expanded at bottom',...expanded});
    if (expanded.remaining > 2 || expanded.actionBottom > expanded.top) report.errors.push(`${engine}: textarea growth lost bottom or overlapped actions`);
    await page.screenshot({path:path.join(root,`${engine}-expanded-bottom.png`)});
    await input.fill(''); await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await pause(150);
    const stable = await geometry();
    await page.mouse.move(1000,400); await page.mouse.wheel(0,-500); await pause(200);
    const upward = await geometry();
    assert.ok(upward.scrollY < stable.scrollY-100, 'manual upward movement is retained');
    assert.ok(Math.abs(upward.documentHeight-stable.documentHeight)<=1, 'composer hiding never changes document height');
    await context.close(); await browser.close(); browser = null;
    record(`${engine}: measured near bottom, textarea growth and upward ownership`);
  }
  assert.equal(await fs.readFile(sourceFile,'utf8'),source);
  assert.equal(peak, 1, 'view updates never duplicate generation');
  assert.deepEqual(report.errors, []); report.passed=true;
} catch (error) { report.failure=error.stack; throw error; }
finally {
  if(browser) await browser.close(); if(web) { const stopped=once(web,'close'); web.kill(); await stopped; }
  for(const res of pending.values()) res.destroy();
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)); await fs.writeFile(path.join(root,'web.log'),serverLog);
  model.closeAllConnections(); await new Promise(resolve=>model.close(resolve)); await mcp.close();
  console.log(JSON.stringify({root,passed:report.passed,checks:report.checks.length}));
}
