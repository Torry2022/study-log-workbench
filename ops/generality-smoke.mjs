// Synthetic end-to-end check: current production Web + keyword MCP + local model double.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { DesktopManager } from './desktop/manager.mjs';

const root = path.resolve('.local', `generality-rag-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
let calls = 0, modelError;
const model = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++;
    assert.doesNotMatch(body.messages[0].content, /技术学习日志|通用技术知识/);
    if (!body.stream) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ strategy: 'relevance', dateFrom: null, dateTo: null }) } }] }));
    } else {
      assert.match(JSON.stringify(body.messages), /叙述者的判断不等于作者的立场/);
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '记录指出：叙述者的判断不等于作者的立场。[S1]' }, finish_reason: null }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    }
  } catch (error) { modelError = error; res.statusCode = 500; res.end('Synthetic model assertion failed'); }
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const manager = new DesktopManager({ packageRoot: path.join(root, 'program'), webRoot: path.resolve('study-log-web'), mcpRoot: path.resolve('study-log-mcp'), webPort: port });
const password = 'SyntheticGeneralityOnly2026', instance = path.join(root, 'instance');
try {
  await manager.select({ root: instance, create: true, password });
  await manager.configure({ apiUrl: `http://127.0.0.1:${model.address().port}/chat`, model: 'synthetic', apiKey: 'synthetic' });
  await fs.writeFile(path.join(instance, 'data/2026-10_学习日志.md'), '## 2026-10-08\n\n### 阅读笔记\n\n叙述者的判断不等于作者的立场。仅在上下文支持时，才能将两者联系起来。\n\n---\n');
  await manager.start();
  const base = manager.status().url;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const mode of ['logs_only', 'logs_and_general']) {
    const response = await fetch(base + '/api/rag/query', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '叙述者', mode }), signal: AbortSignal.timeout(45000) });
    assert.equal(response.status, 200); const raw = await response.text();
    assert.doesNotMatch(raw, /event: error/); assert.match(raw, /event: done/);
    const frame = raw.split('\n\n').find(value => value.startsWith('event: done\n'));
    const done = JSON.parse(frame.split('\ndata: ')[1]);
    assert.match(done.answer, /叙述者/); assert.ok(done.citations.length > 0);
    assert.equal(done.citations[0].date, '2026-10-08');
    console.log(`PASS ${mode}: real keyword retrieval, source citation and event: done`);
  }
  assert.ifError(modelError); assert.ok(calls >= 4);
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: true, modelCalls: calls, paidCalls: 0, evidence: 'protocol only; not model quality' }, null, 2));
  console.log(root);
} finally { await manager.shutdown(); await new Promise(resolve => { model.close(resolve); model.closeAllConnections(); }); }
