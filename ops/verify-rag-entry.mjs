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
const tools = [], checks = [], calls = []; let decisionLimited = false, firstLimited = false;
const model = http.createServer(async (req, res) => {
  assert.equal(req.url, '/full/custom/endpoint');
  assert.equal(req.headers.authorization, 'Bearer synthetic');
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (body.stream) calls.push({ tools: Boolean(body.tools) });
  if (body.tools) {
    assert.equal(body.max_tokens, undefined, 'Tool decisions inherit the model output default');
    const state = JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    assert.equal(state.remainingDecisions, 2);
    assert.ok(body.messages.at(-1).content.includes('Alpha条件成立才适用'));
    assert.deepEqual(state.availableReadDates, []);
    assert.ok(!body.tools.some(item => item.function.name === 'read'));
    if (decisionLimited || firstLimited) tools.push(state);
  }
  const answer = 'Alpha条件成立才适用，不适用于所有场景。[s1]';
  if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Alpha适用条件' } }] })); return; }
  res.setHeader('content-type', 'text/event-stream');
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  const limited = body.tools && (decisionLimited || firstLimited);
  const delta = limited ? { content: firstLimited ? '内部首轮截断文本' : '内部草稿不可发布', reasoning_content: '内部思考不可发布' } : { content: answer };
  res.end(frame({ id: 'synthetic', object: 'chat.completion.chunk', model: 'synthetic', choices: [{ index: 0, delta, finish_reason: null }] }) + frame({ choices: [{ index: 0, delta: {}, finish_reason: limited ? 'length' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + 'data: [DONE]\n\n');
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
    assert.match(done.answer,/\[S1\]/); assert.ok(!done.answer.includes('[s1]'));
    assert.equal(done.citations[0].date,'2026-09-01'); assert.equal(Boolean(done.diagnostics.agent?.enabled),agent);assert.equal(tools.length,before);
    assert.equal(calls.length - callsBefore, 1, 'Sufficient evidence must need only one generating-model call');
    checks.push({ question, agent, done: true, modelCalls: calls.length - callsBefore });
  }
  decisionLimited = true;
  const limitCalls = calls.length, limitTools = tools.length;
  const limitResponse = await fetch(`${base}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question: 'Alpha的适用条件是什么？', mode: 'logs_only', history: [] }) });
  assert.equal(limitResponse.status, 200);
  const limitRaw = await limitResponse.text(), limitDone = JSON.parse(limitRaw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.match(limitRaw.trim().split('\n\n').at(-1), /^event: done/);
  assert.equal(limitDone.diagnostics.agent.stopReason, 'decision_output_limit');
  assert.equal(limitDone.diagnostics.toolCalls, 1); assert.equal(limitDone.citations[0].date, '2026-09-01');
  assert.equal(calls.length - limitCalls, 2); assert.equal(tools.length - limitTools, 1);
  assert.ok(!limitRaw.includes('内部草稿') && !limitRaw.includes('内部思考'));
  checks.push({ decisionOutputLimit: true, finalAnswer: true, internalMessagesHidden: true }); decisionLimited = false;
  firstLimited = true;
  const firstCalls = calls.length;
  const firstResponse = await fetch(`${base}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question: 'Alpha的适用条件是什么？', mode: 'logs_only', history: [] }) });
  assert.equal(firstResponse.status, 200);
  const firstRaw = await firstResponse.text(); assert.match(firstRaw.trim().split('\n\n').at(-1), /^event: done/);
  const firstDone = JSON.parse(firstRaw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
  assert.equal(firstDone.diagnostics.agent.stopReason, 'decision_output_limit');
  assert.equal(firstDone.diagnostics.agent.usage.inputTokens, 10);
  assert.equal(firstDone.citations[0].date, '2026-09-01'); assert.equal(calls.length - firstCalls, 2);
  assert.ok(!firstRaw.includes('内部首轮截断文本'));
  checks.push({ firstOutputLimit: true, noExtraReads: true, finalAnswer: true }); firstLimited = false;
  const require = createRequire(new URL('../study-log-web/package.json',import.meta.url));
  const { chromium, webkit, expect } = require('@playwright/test');
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch();
    try { for (const theme of ['light','dark']) for (const width of [1440,390]) {
      const suffix = width === 1440 ? '' : '-mobile';
      const page = await browser.newPage({ viewport: { width,height:width === 1440 ? 900 : 844 },colorScheme:theme });
      await page.goto(base); await page.getByLabel('访问密码').fill('synthetic-entry-password'); await page.getByRole('button',{name:'登录',exact:true}).click();
      await page.getByRole('button',{name:'问答',exact:true}).click();
      const toolbar = page.locator(width === 1440 ? '.reader-toolbar-qa' : '.mobile-topbar');
      const beforeSave = await toolbar.boundingBox();
      let releaseSave, rejectFirstSave = true;
      await page.route('**/api/rag/sessions', async route => {
        if (route.request().method() !== 'POST' || !rejectFirstSave) return route.continue();
        await new Promise(resolve => { releaseSave = resolve; });
        rejectFirstSave = false;
        await route.fulfill({ status: 500, json: { error: '合成历史保存失败' } });
      });
      await page.getByRole('textbox',{name:'输入知识库问题',exact:true}).fill('Alpha的适用条件是什么？');
      await page.getByRole('button',{name:'发送问题',exact:true}).click();
      await expect(page.locator('.rag-workspace').filter({visible:true})).toContainText('Alpha条件成立才适用，不适用于所有场景。');
      const saving = page.getByText('正在保存问答历史…', { exact: true });
      await expect(saving).toBeVisible();
      await expect(page.getByRole('button',{name:'查看来源 S1',exact:true})).toBeVisible();
      const duringSave = await toolbar.boundingBox();
      assert.ok(Math.abs(duringSave.y - beforeSave.y) <= 1 && Math.abs(duringSave.height - beforeSave.height) <= 1, 'Saving must not move or stretch the module toolbar');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:path.join(root,`${engine}-${theme}${suffix}-saving.png`)});
      releaseSave();
      await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
      const failedSave = await toolbar.boundingBox();
      assert.ok(Math.abs(failedSave.y - beforeSave.y) <= 1 && Math.abs(failedSave.height - beforeSave.height) <= 1, 'Save failure must not move or stretch the module toolbar');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:path.join(root,`${engine}-${theme}${suffix}-save-error.png`)});
      await page.getByRole('button', { name: '重试保存', exact: true }).click();
      await expect(saving).toHaveCount(0);
      await expect(page.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/session=/);
      await page.screenshot({path:path.join(root,`${engine}-${theme}${suffix}.png`)});
      const configurationIssue = 'RAG_DEEPSEEK_THINKING 仅支持官方 DeepSeek Flash/Pro 的 disabled 或 low';
      await page.route('**/api/capabilities', async route => {
        const response = await route.fetch(), body = await response.json();
        body.features.rag = { ...body.features.rag, configured: false, issues: [{ field: 'RAG_DEEPSEEK_THINKING', reason: 'invalid', message: configurationIssue }] };
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      const availability = page.getByRole('complementary', { name: '暂时无法提问', exact: true });
      await expect(availability).toBeVisible();
      await availability.getByText('检查说明', { exact: true }).click();
      await expect(availability.getByText(configurationIssue, { exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: '输入知识库问题', exact: true }).fill('合成配置错误不得提交');
      await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeDisabled();
      await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText('Alpha条件成立才适用');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(root, `${engine}-${theme}${suffix}-configuration-error.png`) });
      checks.push({engine,theme,width,answer:true,savePendingLayout:true,saveErrorLayout:true,retry:true,configurationIssue:true,historyPreserved:true}); await page.close();
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
