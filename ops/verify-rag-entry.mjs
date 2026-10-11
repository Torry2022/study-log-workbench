// Actual production route and UI, actual MCP, synthetic model/data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { startHttpServer } from '../study-log-mcp/src/http-server.mjs';
const repository = path.resolve(import.meta.dirname, '..');
const root = path.join(repository, '.local', `rag-entry-production-${Date.now()}`);
const data = path.join(root, 'data');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(path.join(root, 'backups'));
const source = '## 2026-09-01\n\n### Alpha\nAlpha条件成立才适用，不适用于所有场景。\n';
const file = path.join(data, '2026-09_学习日志.md');
await fs.writeFile(file, source, { flag: 'wx' });
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: 'b0250000-0000-4000-8000-000000000001' }), { flag: 'wx' });
const tools = [], checks = [], calls = [];
const model = http.createServer(async (req, res) => {
  assert.equal(req.url, '/full/custom/endpoint');
  assert.equal(req.headers.authorization, 'Bearer synthetic');
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (body.stream) calls.push({ tools: Boolean(body.tools) });
  if (body.tools) {
    const state = JSON.parse(body.messages.find(message => message.role === 'user').content);
    assert.equal(state.remainingDecisions, 2);
    assert.equal(state.evidence[0].truncated, false);
    assert.deepEqual(state.availableReadDates, ['2026-09-01']);
    assert.ok(body.tools.some(item => item.function.name === 'read'));
    tools.push(state);
  }
  const answer = 'Alpha条件成立才适用，不适用于所有场景。[S1]';
  if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Alpha适用条件' } }] })); return; }
  res.setHeader('content-type', 'text/event-stream');
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  const delta = body.tools ? { tool_calls: [{ index: 0, id: 'synthetic-finish', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ reason: 'sufficient_evidence', answer }) } }] } : { content: answer };
  res.end(frame({ id: 'synthetic', object: 'chat.completion.chunk', model: 'synthetic', choices: [{ index: 0, delta, finish_reason: null }] }) + frame({ choices: [{ index: 0, delta: {}, finish_reason: body.tools ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + 'data: [DONE]\n\n');
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const mcp = await startHttpServer({ logRoot: data, indexRoot: path.join(root, 'index'), port: 0, token: 'synthetic', retrieval: { embedding: { apiKey: '' }, reranker: { apiKey: '' }, rerankEnabled: false } });
const safe = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const port = 3371, base = `http://127.0.0.1:${port}/study-log`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)], { cwd: path.join(repository,'study-log-web'), windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...safe, LOG_ROOT: data, BACKUP_ROOT: path.join(root,'backups'), APP_PASSWORD: 'synthetic-entry-password', SESSION_SECRET: 'synthetic-entry-session-secret-20261011-for-isolated-verification', COOKIE_SECURE: 'false', CHAT_API_URL: `http://127.0.0.1:${model.address().port}/full/custom/endpoint`, CHAT_MODEL: 'synthetic', CHAT_API_KEY: 'synthetic', STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic', RAG_AGENT_ENABLED: 'true', RAG_AGENT_TOOL_CALLING_VERIFIED: 'true', RAG_JEV_ENABLED: 'false' } });
let log = ''; server.stdout.on('data', value => log += value); server.stderr.on('data', value => log += value);
try {
  let ready = false; for (let i=0;i<120;i++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; if (server.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve,250)); }
  assert.ok(ready, log);
  const auth = await (await fetch(`${base}/api/auth/app-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'synthetic-entry-password' }) })).json();
  assert.equal(typeof auth.token, 'string');
  for (const [question, agent] of [['Alpha的适用条件是什么？',true],['哪里提到过`Alpha`？',false],['总结2026年9月',false]]) {
    const before = tools.length;
    const callsBefore = calls.length;
    const response = await fetch(`${base}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question, mode: 'logs_only', history: [] }) });
    assert.equal(response.status,200);
    const raw = await response.text(), blocks = raw.trim().split('\n\n');
    assert.match(blocks.at(-1),/^event: done/);
    const done = JSON.parse(blocks.at(-1).split('\n')[1].slice(6));
    assert.equal(done.citations[0].date,'2026-09-01'); assert.equal(tools.length > before,agent);
    assert.equal(calls.length - callsBefore, 1, 'Sufficient evidence must need only one generating-model call');
    checks.push({ question, agent, done: true, modelCalls: calls.length - callsBefore });
  }
  const require = createRequire(new URL('../study-log-web/package.json',import.meta.url));
  const { chromium, webkit, expect } = require('@playwright/test');
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch();
    try { for (const theme of ['light','dark']) {
      const page = await browser.newPage({ viewport: { width:1440,height:900 },colorScheme:theme });
      await page.goto(base); await page.getByLabel('访问密码').fill('synthetic-entry-password'); await page.getByRole('button',{name:'登录',exact:true}).click();
      await page.getByRole('button',{name:'问答',exact:true}).click();
      await page.getByRole('textbox',{name:'输入知识库问题',exact:true}).fill('Alpha的适用条件是什么？');
      await page.getByRole('button',{name:'发送问题',exact:true}).click();
      await expect(page.locator('.rag-workspace').filter({visible:true})).toContainText('Alpha条件成立才适用，不适用于所有场景。');
      await expect(page.getByText('正在保存问答历史...', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/session=/);
      await page.screenshot({path:path.join(root,`${engine}-${theme}.png`)});
      checks.push({engine,theme,answer:true}); await page.close();
    }} finally {await browser.close();}
  }
  assert.equal(await fs.readFile(file,'utf8'),source);
  await fs.writeFile(path.join(root,'results.json'),JSON.stringify({checks,toolRequests:tools.length,sourceUnchanged:true},null,2));
  console.log(JSON.stringify({root,checks:checks.length,sourceUnchanged:true}));
} finally {
  server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit',resolve));
  await mcp.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await fs.writeFile(path.join(root,'server.log'),log);
}
