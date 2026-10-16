// Actual production route and UI, actual MCP, synthetic model/data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { startHttpServer } from '../study-log-mcp/src/http-server.mjs';
import { agentAssessmentFixture } from '../study-log-web/scripts/rag-model-fixture.mjs';
const repository = path.resolve(import.meta.dirname, '..');
const root = path.join(repository, '.local', `rag-entry-production-${Date.now()}`);
const data = path.join(root, 'data');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(path.join(root, 'backups'));
const source = '## 2026-09-01\n\n### Alpha\nAlpha条件成立才适用，不适用于所有场景。\n';
const file = path.join(data, '2026-09_学习日志.md');
await fs.writeFile(file, source, { flag: 'wx' });
const octoberFile = path.join(data, '2026-10_学习日志.md');
const octoberSource = '## 2026-10-01\n\n### 合成学习\n十月合成学习记录。\n';
await fs.writeFile(octoberFile, octoberSource, { flag: 'wx' });
const previousYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date())) - 1;
const relativeFile = path.join(data, `${previousYear}_学习日志.md`);
const relativeSource = `## ${previousYear}-09-02\n\n### RelativeYearProbe\nRelativeYearProbe synthetic temporal fixture.\n`;
await fs.writeFile(relativeFile, relativeSource, { flag: 'wx' });
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: 'b0250000-0000-4000-8000-000000000001' }), { flag: 'wx' });
const tools = [], checks = [], calls = [], agentScopes = [], mcpCalls = []; let decisionLimited = false, firstLimited = false, contextSelection = null, filtered = false, mutateCursor = false, directReply = false;
const model = http.createServer(async (req, res) => {
  assert.equal(req.url, '/full/custom/endpoint');
  assert.equal(req.headers.authorization, 'Bearer synthetic');
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (body.stream) calls.push({ tools: Boolean(body.tools) });
  if (body.tools) {
    assert.equal(body.max_tokens, undefined, 'Tool decisions inherit the model output default');
    const state = JSON.parse(body.messages.at(-1).content.split('可用工具状态：').at(-1));
    agentScopes.push(state.constraints);
    assert.equal(state.remainingDecisions, 2);
    assert.ok(body.messages.at(-1).content.includes('Alpha条件成立才适用'));
    assert.deepEqual(state.availableReadDates, []);
    assert.ok(!body.tools.some(item => item.function.name === 'read'));
    if (decisionLimited || firstLimited) tools.push(state);
  }
  const answer = body.messages.at(-1).content.includes('比较2026年9月和2026年10月1日')
    ? '九月与十月的合成学习记录不同。[S1][S2]' : 'Alpha条件成立才适用，不适用于所有场景。[s1]';
  if (!body.stream) {
    const content = body.messages[0].content.includes('scopeSource') ? JSON.stringify({ query: 'Alpha的适用条件是什么？', scopeSource: contextSelection, strategy: 'relevance' }) : 'Alpha适用条件';
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })); return;
  }
  res.setHeader('content-type', 'text/event-stream');
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  const limited = body.tools && (decisionLimited || firstLimited);
  if(body.tools && directReply){
    res.end(frame({choices:[{index:0,delta:{tool_calls:[{index:0,id:'reply',type:'function',function:{name:'reply',arguments:JSON.stringify({answer,evidence:[{point:'合成适用条件',sourceId:'S1',quote:'Alpha条件成立才适用'}]})}}]},finish_reason:null}]})+
      frame({choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}})+'data: [DONE]\n\n');return;
  }
  if (body.tools && !limited && !filtered) { res.end(await agentAssessmentFixture(answer, body).text()); return; }
  const delta = limited ? { content: firstLimited ? '内部首轮截断文本' : '内部草稿不可发布', reasoning_content: '内部思考不可发布' } : { content: answer };
  res.end(frame({ id: 'synthetic', object: 'chat.completion.chunk', model: 'synthetic', choices: [{ index: 0, delta, finish_reason: null }] }) + frame({ choices: [{ index: 0, delta: {}, finish_reason: filtered ? 'content_filter' : limited ? 'length' : 'stop' }], usage: filtered ? { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } : { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + 'data: [DONE]\n\n');
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const mcp = await startHttpServer({ logRoot: data, indexRoot: path.join(root, 'index'), port: 0, token: 'synthetic', retrieval: { embedding: { apiKey: '' }, reranker: { apiKey: '' }, rerankEnabled: false } });
const proxy = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    if (body?.method === 'tools/call') {
      mcpCalls.push(body.params);
      if (mutateCursor && body.params.arguments.cursor) await fs.appendFile(octoberFile, '\n合成版本已改变。');
    }
    const response = await fetch(`http://127.0.0.1:${mcp.address.port}/mcp`, { method: req.method, headers: {
      authorization: req.headers.authorization || '', accept: req.headers.accept || 'application/json', 'content-type': 'application/json',
      ...(req.headers['mcp-protocol-version'] ? { 'mcp-protocol-version': req.headers['mcp-protocol-version'] } : {})
    }, ...(raw ? { body: raw } : {}) });
    res.writeHead(response.status, {'content-type': response.headers.get('content-type') || 'application/json'});
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.destroy(); }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const safe = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const port = 3371, base = `http://127.0.0.1:${port}/study-log`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)], { cwd: path.join(repository,'study-log-web'), windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...safe, LOG_ROOT: data, BACKUP_ROOT: path.join(root,'backups'), APP_PASSWORD: 'synthetic-entry-password', SESSION_SECRET: 'synthetic-entry-session-secret-20261011-for-isolated-verification', COOKIE_SECURE: 'false', CHAT_API_URL: `http://127.0.0.1:${model.address().port}/full/custom/endpoint`, CHAT_MODEL: 'synthetic', CHAT_API_KEY: 'synthetic', STUDY_LOG_MCP_URL: `http://127.0.0.1:${proxy.address().port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic', RAG_AGENT_ENABLED: 'true', RAG_AGENT_TOOL_CALLING_VERIFIED: 'true', RAG_JEV_ENABLED: 'false', RAG_CONTEXT_WINDOW_TOKENS: '1000000' } });
let log = ''; server.stdout.on('data', value => log += value); server.stderr.on('data', value => log += value);
try {
  let ready = false; for (let i=0;i<120;i++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; if (server.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve,250)); }
  assert.ok(ready, log);
  const auth = await (await fetch(`${base}/api/auth/app-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'synthetic-entry-password' }) })).json();
  assert.equal(typeof auth.token, 'string');
  const ask = async question => {
    const response = await fetch(`${base}/api/rag/query`, {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth.token}`},body:JSON.stringify({question,history:[],mode:'logs_only'})});
    assert.equal(response.status,200);
    return (await response.text()).trim().split('\n\n').map(block=>({event:block.split('\n')[0].slice(7),data:JSON.parse(block.split('\n')[1].slice(6))}));
  };
  const mixedStart = mcpCalls.length;
  const mixed = await ask('比较2026年9月和2026年10月1日的学习内容');
  assert.equal(mixed.at(-1).event,'done');
  assert.deepEqual(mcpCalls.slice(mixedStart).map(call=>[call.name,call.arguments.dateFrom,call.arguments.dateTo]),[
    ['read_log_range','2026-09-01','2026-09-30'],['read_log_range','2026-10-01','2026-10-01']]);
  assert.deepEqual(mixed.at(-1).data.citations.map(item=>item.date),['2026-09-01','2026-10-01']);
  checks.push({mixedMonthAndDay:true,actualMcpScopes:true});
  const invalidCalls = [mcpCalls.length,calls.length];
  const invalidMonth = await ask('比较2026年9月和2026年13月的学习内容');
  assert.equal(invalidMonth.at(-1).event,'done');assert.match(invalidMonth.at(-1).data.answer,/日期.*有误/);
  assert.deepEqual([mcpCalls.length,calls.length],invalidCalls);checks.push({invalidMonth:true,noServiceCalls:true});
  mutateCursor = true;await fs.writeFile(octoberFile,'## 2026-10-01\n\n### 合成学习\n'+ '分页合成记录。'.repeat(5000));
  const changedStart=[mcpCalls.length,calls.length];
  const changed = await ask('比较2026年9月和2026年10月的学习内容');
  assert.equal(changed.at(-1).event,'error');assert.equal(changed.at(-1).data.code,'MCP_SOURCE_CHANGED');
  assert.equal(mcpCalls.length-changedStart[0],3);assert.equal(calls.length,changedStart[1]);
  assert.ok(!changed.some(item=>['delta','sources','done'].includes(item.event)));checks.push({cursorSourceChanged:true,noAnswerOrDone:true});
  mutateCursor=false;await fs.writeFile(octoberFile,octoberSource);
  filtered=true;const filteredResult=await ask('Alpha的适用条件是什么？');filtered=false;
  assert.equal(filteredResult.at(-1).event,'error');assert.equal(filteredResult.at(-1).data.code,'AI_STREAM_INTERRUPTED');
  assert.deepEqual(filteredResult.at(-1).data.diagnostics.usage,[{model:'synthetic',inputTokens:123,outputTokens:45}]);
  assert.ok(!filteredResult.some(item=>item.event==='done'));checks.push({sdkFilteredUsage:true,noDone:true});
  directReply=true;
  const directStart=calls.length,directResult=await ask('Alpha的适用条件是什么？');directReply=false;
  assert.equal(directResult.at(-1).event,'done');assert.equal(calls.length-directStart,1);
  assert.equal(directResult.at(-1).data.diagnostics.agent.entered,false);
  assert.equal(directResult.at(-1).data.citations[0].date,'2026-09-01');
  checks.push({directReply:true,oneModelCall:true,noSupplementaryAgent:true});
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
    assert.equal(calls.length - callsBefore, 1, 'A checked first-step reply and bypass paths each use one model call');
    if (agent) {
      assert.equal(done.diagnostics.agent.entered, false);
      assert.equal(done.diagnostics.agent.assessed, false);
      assert.equal(done.diagnostics.agent.stopReason, 'direct_answer');
    }
    checks.push({ question, agent, done: true, modelCalls: calls.length - callsBefore });
  }
  for (const question of ['去年9月哪里提到`RelativeYearProbe`？', '哪里提到`RelativeYearProbe`，这是今年发布的模型？']) {
    const response = await fetch(`${base}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question, mode: 'logs_only', history: [] }) });
    const block = (await response.text()).trim().split('\n\n').at(-1);
    assert.match(block, /^event: done/);
    const done = JSON.parse(block.split('\n')[1].slice(6));
    assert.equal(done.citations[0].date, `${previousYear}-09-02`);
    assert.equal(done.citations[0].fileName, `${previousYear}_学习日志.md`);
    checks.push({ relativeYear: true, publicationNotLogFilter: question.includes('发布'), done: true });
  }
  for (const [selection, historyQuestion, expectedFrom] of [[0, '只看2026年9月，Alpha的条件是什么？', '2026-09-01'], [null, '只看2026年10月，旧主题是什么？', undefined]]) {
    contextSelection = selection;
    const before = agentScopes.length;
    const response = await fetch(`${base}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question: 'Alpha的适用条件是什么？', history: [{ role: 'user', content: historyQuestion }], mode: 'logs_only' }) });
    const raw = await response.text(), block = raw.trim().split('\n\n').at(-1);
    assert.match(block, /^event: done/);
    const done = JSON.parse(block.split('\n')[1].slice(6));
    assert.equal(agentScopes.length, before + 1); assert.equal(agentScopes.at(-1).dateFrom, expectedFrom);
    assert.equal(done.citations[0].date, '2026-09-01');
    checks.push({ followupScope: selection === null ? 'new_topic' : 'inherited', done: true, actualSdkScope: true });
  }
  contextSelection = 'uncertain';
  const before = calls.length;
  const uncertain = await fetch(`${base}/api/rag/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question: '它呢？', history: [{ role: 'user', content: '只看2026年9月' }], mode: 'logs_only' }) });
  const uncertainBlock = (await uncertain.text()).trim().split('\n\n').at(-1);
  assert.match(uncertainBlock, /^event: error/); assert.equal(JSON.parse(uncertainBlock.split('\n')[1].slice(6)).code, 'RAG_CONTEXT_UNCERTAIN');
  assert.equal(calls.length, before); checks.push({ uncertainScope: true, stoppedBeforeGeneration: true });
  contextSelection = null;
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
      contextSelection = 'uncertain';
      await page.getByRole('textbox', { name: '输入知识库问题', exact: true }).fill('它呢？');
      await page.getByRole('button', { name: '发送问题', exact: true }).click();
      await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText('无法确定追问沿用的范围，请补充日期或完整问题后重试');
      await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
      await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText('Alpha条件成立才适用');
      await page.screenshot({ path: path.join(root, `${engine}-${theme}${suffix}-scope-clarification.png`) });
      contextSelection = null;
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
      checks.push({engine,theme,width,answer:true,savePendingLayout:true,saveErrorLayout:true,retry:true,scopeClarification:true,configurationIssue:true,historyPreserved:true}); await page.close();
    }} finally {await browser.close();}
  }
  assert.equal(await fs.readFile(file,'utf8'),source);
  assert.equal(await fs.readFile(octoberFile,'utf8'),octoberSource);
  assert.equal(await fs.readFile(relativeFile, 'utf8'), relativeSource);
  await fs.writeFile(path.join(root,'results.json'),JSON.stringify({checks,toolRequests:tools.length,sourceUnchanged:true},null,2));
  console.log(JSON.stringify({root,checks:checks.length,sourceUnchanged:true}));
} finally {
  server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit',resolve));
  proxy.closeAllConnections(); await new Promise(resolve=>proxy.close(resolve)); await mcp.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await fs.writeFile(path.join(root,'server.log'),log);
}
