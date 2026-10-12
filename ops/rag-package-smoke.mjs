import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify, parseEnv } from "node:util";

const [payload, root] = process.argv.slice(2);
if (!payload || !root || !path.isAbsolute(payload) || !path.isAbsolute(root)) throw Error("Explicit package and NEW synthetic root required");
await fs.mkdir(root);
const { DesktopManager } = await import(pathToFileURL(path.join(payload, "ops", "desktop", "manager.mjs")));
const node = path.join(payload, "runtime", "node.exe");
const serviceNode = (await promisify(execFile)(node, ['--version'], {windowsHide:true})).stdout.trim();
assert.equal(serviceNode, 'v' + JSON.parse(await fs.readFile(path.join(payload, 'package-manifest.json'), 'utf8')).node.version);
const manager = new DesktopManager({ packageRoot: payload, node });
const password = "synthetic-rag-package-password";
let toolRequests = 0;
let modelCalls = 0;
let firstLimited = false;
const model = http.createServer(async (req, res) => {
  assert.equal(req.url, '/full/custom/endpoint');
  assert.equal(req.headers.authorization, 'Bearer synthetic');
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, "synthetic-model");
  if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({choices:[{message:{content:'合成问答'}}]})); return; }
  modelCalls++;
  const userText = body.messages.filter(message => message.role === 'user').at(-1).content;
  const firstTurn = body.tools && userText.includes('可用工具状态：');
  const state = body.tools ? firstTurn ? { ...JSON.parse(userText.split('可用工具状态：').at(-1)), question: userText.split('\n')[0] } : JSON.parse(userText) : null;
  if (state && state.question.includes('Alpha')) {
    assert.ok(!state.availableReadDates.includes('2026-09-01'));
  }
  if (state && state.question.includes('Gamma') && state.remainingDecisions === 2) {
    assert.ok(state.availableReadDates.includes('2026-09-02'));
  }
  if (firstTurn && (firstLimited || state.question.includes('Alpha'))) {
    res.setHeader('content-type','text/event-stream');
    res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:firstLimited?'内部首轮截断文本':'Alpha条件成立才适用，不适用于所有场景。[S1]'},finish_reason:firstLimited?'length':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\ndata: [DONE]\n\n'); return;
  }
  const name = state?.question.includes('Gamma') && state.remainingDecisions === 2 ? 'read' : 'finish';
  const args = name === 'read' ? {date:'2026-09-02',missingPoint:'Gamma的补充条件'} : {reason:'sufficient_evidence'};
  const provided = body.messages.map(message => message.content).join('\n');
  const gammaSource = [...provided.matchAll(/\[(S\d+)\]\n日志日期：2026-09-02(?:\n小节：[^\n]*)?\n内容：\n([\s\S]*?)\n以上为/g)].find(match => match[2].includes('先确认地址'));
  const answerAfterRead = body.tools && state?.question.includes('Gamma') && state.remainingDecisions === 1;
  if (answerAfterRead) {
    assert.ok(gammaSource, 'Second SDK turn must contain the actual reread condition');
    assert.ok(!body.tools.some(item => item.function.name === 'finish'));
  }
  const delta = body.tools && !answerAfterRead
    ? { tool_calls: [{ index: 0, id: `call-${++toolRequests}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }
    : { content: gammaSource ? `Gamma补充条件是先确认地址。[${gammaSource[1]}]` : '条件成立才适用[S1]' };
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  res.setHeader("content-type", "text/event-stream");
  res.end(frame({ id: "mock", object: "chat.completion.chunk", created: 1, model: "synthetic-model", choices: [{ index: 0, delta, finish_reason: null }] }) + frame({ choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + "data: [DONE]\n\n");
});
await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
try {
  await manager.select({ root, create: true, password });
  const envFile = path.join(root, ".env");
  const original = await fs.readFile(envFile, "utf8");
  await fs.writeFile(envFile, original.replace(/^CHAT_(?:API_URL|MODEL|API_KEY)=.*\r?\n/gm, "") + `\nCHAT_API_URL=http://127.0.0.1:${model.address().port}/full/custom/endpoint\nCHAT_MODEL=synthetic-model\nCHAT_API_KEY=synthetic\nRAG_AGENT_ENABLED=true\nRAG_AGENT_TOOL_CALLING_VERIFIED=true\nRAG_JEV_ENABLED=false\n`);
  const source = "## 2026-09-01\n\n### Alpha\nAlpha条件成立才适用，不适用于所有场景。\n\n---\n\n## 2026-09-02\n\n### Gamma\nGamma的补充条件另列如下。\n\n### 附加说明\n先确认地址。\n";
  const file = path.join(root, "data", "2026-09_学习日志.md"); await fs.writeFile(file, source);
  for (const license of ["ai/LICENSE", "@ai-sdk/openai-compatible/LICENSE", "@typesafe-ai/sdk/LICENSE"]) await fs.access(path.join(payload, "web", "node_modules", license));
  const target = { apiUrl: `http://127.0.0.1:${model.address().port}/full/custom/endpoint`, model: 'synthetic-model' };
  await manager.configure(target);
  assert.equal(parseEnv(await fs.readFile(envFile, 'utf8')).RAG_AGENT_TOOL_CALLING_VERIFIED, 'true');
  await manager.configure({ ...target, model: 'new-synthetic-model' });
  assert.equal(parseEnv(await fs.readFile(envFile, 'utf8')).RAG_AGENT_TOOL_CALLING_VERIFIED, 'false');
  await manager.configure(target);
  const checks = [];
  const unverified = await manager.start();
  const probeAuth = await (await fetch(`${unverified.url}/api/auth/app-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).json();
  const beforeProbe = modelCalls;
  const probe = await fetch(`${unverified.url}/api/rag/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${probeAuth.token}` }, body: JSON.stringify({ question: 'Alpha的适用条件是什么？', mode: 'logs_only', history: [] }) });
  assert.equal(probe.status, 200);
  const probeTerminal = (await probe.text()).trim().split('\n\n').at(-1);
  assert.match(probeTerminal, /^event: done/);
  assert.equal(JSON.parse(probeTerminal.split('\n')[1].slice(6)).diagnostics.agent, undefined);
  assert.equal(modelCalls - beforeProbe, 1);
  await manager.stop();
  checks.push({ changedTargetInvalidatesConfirmation: true, unverifiedTargetUsesOrdinaryRag: true, modelCalls: 1 });
  // Confirm only the restored target whose synthetic tool protocol is verified below.
  await fs.appendFile(envFile, '\nRAG_AGENT_TOOL_CALLING_VERIFIED=true\n');
  const status = await manager.start(); assert.equal(status.state, "running");
  assert.equal((await fetch(status.url)).status, 200);
  const auth = await (await fetch(`${status.url}/api/auth/app-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })).json();
  assert.equal(typeof auth.token, "string");
  for (const [question, calls, date] of [["总结2026年9月",1,"2026-09-02"], ["Alpha为什么只在条件成立时适用？",1,"2026-09-01"], ["Gamma的补充条件是什么？",2,"2026-09-02"]]) {
    const before = modelCalls;
    const response = await fetch(`${status.url}/api/rag/query`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question, mode: "logs_only", history: [] }) });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n\n").map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n")[1].slice(6)) }));
    assert.equal(events.at(-1).event, "done", JSON.stringify(events.at(-1)));
    assert.equal(events.at(-1).data.citations[0].date, date);
    assert.equal(modelCalls-before,calls);
    checks.push({ question, modelCalls:modelCalls-before, diagnostics: events.at(-1).data.diagnostics });
  }
  const beforeConflict = modelCalls;
  const conflict = await fetch(`${status.url}/api/rag/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question: '刚才第一条来源，只看2026年十月的记录。', mode: 'logs_only', history: [{ role: 'assistant', content: '合成旧回答', sourceRefs: [{ date: '2026-09-01', fileName: '2026-09_学习日志.md', heading: 'Alpha', contentHash: 'a'.repeat(64) }] }] }) });
  assert.equal(conflict.status, 200);
  const conflictTerminal = (await conflict.text()).trim().split('\n\n').at(-1);
  assert.match(conflictTerminal, /^event: done/);
  const clarification = JSON.parse(conflictTerminal.split('\n')[1].slice(6));
  assert.match(clarification.answer, /指定.*日期范围/);
  assert.deepEqual(clarification.citations, []);
  assert.equal(modelCalls, beforeConflict);
  checks.push({ sourceDateConflict: true, modelCalls: 0 });
  firstLimited = true;
  const before = modelCalls;
  const interrupted = await fetch(`${status.url}/api/rag/query`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify({question:'Alpha的条件是什么？',mode:'logs_only',history:[]}) });
  assert.equal(interrupted.status,200);
  const interruptedRaw=await interrupted.text();assert.ok(!interruptedRaw.includes('内部首轮截断文本'));
  const terminal=interruptedRaw.trim().split('\n\n').at(-1);assert.match(terminal,/^event: done/);
  const recovered=JSON.parse(terminal.split('\n')[1].slice(6));
  assert.equal(recovered.diagnostics.agent.stopReason,'decision_output_limit');
  assert.equal(recovered.diagnostics.agent.usage.inputTokens,10);
  assert.equal(recovered.citations[0].date,'2026-09-01');assert.equal(modelCalls-before,2);
  checks.push({firstDecisionLength:true,modelCalls:modelCalls-before,diagnostics:recovered.diagnostics});firstLimited=false;
  assert.ok(toolRequests >= 1); assert.equal(await fs.readFile(file, "utf8"), source);
  const result = await promisify(execFile)(node, ["ops/browser-rag.mjs", root, status.url], { cwd: path.resolve(import.meta.dirname, ".."), windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
  console.log(result.stdout);
  // Browser source-jump verification creates its own synthetic target day.
  const beforeInvalidSource = await fs.readFile(file, 'utf8');
  await manager.stop();
  await fs.appendFile(envFile, '\nRAG_DEEPSEEK_THINKING=synthetic-invalid\n');
  const invalid = await manager.start();
  const invalidAuth = await (await fetch(`${invalid.url}/api/auth/app-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).json();
  const invalidHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${invalidAuth.token}` };
  const capabilityResponse = await fetch(`${invalid.url}/api/capabilities`, { headers: invalidHeaders });
  assert.equal(capabilityResponse.status, 200);
  const capabilities = await capabilityResponse.json();
  assert.equal(capabilities.aiConfiguration.provider.configured, true);
  assert.equal(capabilities.features.rag.configured, false);
  assert.equal(capabilities.features.rag.issues[0].field, 'RAG_DEEPSEEK_THINKING');
  const beforeInvalid = modelCalls;
  const rejected = await fetch(`${invalid.url}/api/rag/query`, { method: 'POST', headers: invalidHeaders, body: JSON.stringify({ question: '合成配置错误不得调用模型', mode: 'logs_only', history: [] }) });
  assert.equal(rejected.status, 503); assert.equal((await rejected.json()).code, 'AI_CONFIGURATION_INVALID');
  assert.equal(modelCalls, beforeInvalid);
  checks.push({ invalidThinkingReadiness: true, invalidThinkingRejectsBeforeModel: true, modelCalls: 0 });
  assert.equal(await fs.readFile(file, 'utf8'), beforeInvalidSource);
  await fs.writeFile(path.join(root, "package-check.json"), JSON.stringify({ driverNode: process.version, serviceNode, checks, toolRequests }, null, 2));
  console.log("Packaged Node/Web/MCP, bearer-auth SSE, AI SDK exact URL and browser RAG checks passed.");
} finally {
  await manager.shutdown(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
}
