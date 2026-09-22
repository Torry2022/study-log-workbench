import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestChat, MAX_CHAT_RESPONSE_BYTES } from '../lib/ai-chat.ts';
import { generateLogDraft, normalizeGeneratedFragment, validateGenerationInput } from '../lib/ai-generation.ts';

const date = '2026-01-30';
const safeOutput = '### 技术（示例）\n\n中英文 API 空格保持。';
const completion = content => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
async function server(t, handler) {
  const app = http.createServer((req, res) => { void Promise.resolve(handler(req, res)).catch(() => { res.destroy(); }); });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  return { apiKey: 'synthetic-sensitive-key', model: 'fixture-model', baseUrl: `http://127.0.0.1:${app.address().port}/completions` };
}
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }
const json = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(value); };
function safeError(error, code) {
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /synthetic-sensitive|127\.0\.0\.1|provider-private|raw-secret/);
  return true;
}

test('shared chat sends only configured model to local HTTP and accepts non-streaming content', async t => {
  const config = await server(t, async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-sensitive-key');
    const sent = await body(req);
    assert.equal(sent.model, 'fixture-model'); assert.equal(sent.stream, false); assert.equal(sent.temperature, 0.3);
    assert.deepEqual(sent.messages, [{ role: 'user', content: '合成材料' }]);
    json(res, completion(safeOutput));
  });
  assert.equal(await requestChat(config, [{ role: 'user', content: '合成材料' }]), safeOutput);
});

test('provider statuses, redirects, malformed JSON, empty/truncated and oversized bodies have safe errors', async t => {
  let behavior = '429';
  const config = await server(t, async (req, res) => {
    await body(req);
    if (/^\d+$/.test(behavior)) { res.statusCode = Number(behavior); if (behavior === '302') res.setHeader('Location', '/raw-secret'); return res.end('provider-private synthetic-sensitive-key'); }
    if (behavior === 'bad') return json(res, '{raw-secret');
    if (behavior === 'empty') return json(res, completion(''));
    if (behavior === 'shape') return json(res, JSON.stringify({ choices: { invalid: true } }));
    if (behavior === 'truncated') return json(res, JSON.stringify({ choices: [{ message: { content: safeOutput }, finish_reason: 'length' }] }));
    if (behavior === 'large') return json(res, completion('x'.repeat(MAX_CHAT_RESPONSE_BYTES)));
  });
  for (const [mode, code] of [['429', 'AI_RATE_LIMITED'], ['401', 'AI_PROVIDER_AUTH'], ['403', 'AI_PROVIDER_AUTH'], ['500', 'AI_PROVIDER_FAILED'], ['302', 'AI_NETWORK_ERROR'], ['bad', 'AI_INVALID_RESPONSE'], ['empty', 'AI_EMPTY_RESPONSE'], ['shape', 'AI_EMPTY_RESPONSE'], ['truncated', 'AI_OUTPUT_TRUNCATED'], ['large', 'AI_RESPONSE_TOO_LARGE']]) {
    behavior = mode; await assert.rejects(requestChat(config, []), error => safeError(error, code));
  }
});

test('cancel before sending, cancel during body, deadline during body and later retry use independent requests', async t => {
  let calls = 0, finish;
  const config = await server(t, async (req, res) => {
    calls++; await body(req);
    if (calls === 3) return json(res, completion(safeOutput));
    res.setHeader('Content-Type', 'application/json'); res.write('{'); finish?.();
  });
  const early = new AbortController(); early.abort();
  await assert.rejects(requestChat(config, [], { signal: early.signal }), error => safeError(error, 'AI_CANCELLED'));
  assert.equal(calls, 0);
  const controller = new AbortController(); const started = new Promise(resolve => { finish = resolve; });
  const request = requestChat(config, [], { signal: controller.signal });
  await started; controller.abort();
  await assert.rejects(request, error => safeError(error, 'AI_CANCELLED'));
  await assert.rejects(requestChat(config, [], { timeoutMs: 30 }), error => safeError(error, 'AI_TIMEOUT'));
  assert.equal(await requestChat(config, []), safeOutput);
});

test('generation input validates actual types, dates, limits and instruction-only requests', () => {
  assert.equal(validateGenerationInput({ date, instruction: '只依据已有日志整理' }).material, '');
  for (const input of [null, [], { date: '2026-02-30', material: 'a' }, { date: '2999-01-01', material: 'a' }, { date, material: 5 }, { date, extractedText: [] }, { date, instruction: {} }, { date }, { date, material: 'x'.repeat(120001) }, { date, material: 'x', instruction: 'x'.repeat(4001) }]) {
    assert.throws(() => validateGenerationInput(input), error => error.code === 'AI_INVALID_INPUT');
  }
});

test('AST normalization preserves fences, blank lines, heading levels, punctuation and nesting', () => {
  const code = '### 一级素材\n\n~~~markdown\n## 2020-01-01\n\n\n# 代码示例\n~~~\n\n#### 更细的小节\n\n> ```md\n> ## 引用代码\n> ```\n\n中文（括号）与 API 空格';
  assert.equal(normalizeGeneratedFragment(code, date), code);
  assert.equal(normalizeGeneratedFragment('````markdown\n' + code + '\n````', date), code);
  assert.equal(normalizeGeneratedFragment(`## ${date}\n\n${code}`, date), code);
  assert.equal(normalizeGeneratedFragment('```js\nconst n = 3;\n```', date), '```js\nconst n = 3;\n```');
  const nested = '### 容器\n\n- 列表\n\n  ~~~md\n  ## 列表代码\n  ~~~\n\n> ~~~md\n> ## 引用代码\n> ~~~';
  assert.equal(normalizeGeneratedFragment(nested, date), nested);
  const indented = '    ## 缩进代码\n    ```\n    literal';
  assert.equal(normalizeGeneratedFragment(indented, date), indented);
  assert.equal(normalizeGeneratedFragment(`## ${date}\n\n${indented}`, date), indented);
  const crlf = '### 内容\r\n\r\n~~~md\r\n## 代码\r\n~~~\r\n\r\n正文';
  assert.equal(normalizeGeneratedFragment(crlf, date), crlf);
});

test('normalization rejects wrong/multiple dates, H1/H2/setext, trailing separators and unclosed fences instead of coercing them', () => {
  for (const output of ['', `## ${date}\n\n### Good\n\n## 2026-01-29\n\nother`, '## 2026-01-29\n\nwrong', '# 文档标题\n\n正文', '二级标题\n---\n\n正文', '### 2026-01-29\n\nother', '日期：2026-01-29\n\n正文', '### Fine\n\n---', '```js', '正文\n\n```', '正文\n\n~~~', '~~~js\nlet x = 1;', '```markdown\n### 未闭合', '<div>无关包装</div>', 'x'.repeat(60001)]) {
    assert.throws(() => normalizeGeneratedFragment(output, date), error => safeError(error, 'AI_INVALID_DRAFT'), output.slice(0, 80));
  }
});

test('generation uses editable template and bounded same-instance references, warns on truncation, and never writes logs', async t => {
  let captured;
  const config = await server(t, async (req, res) => { captured = await body(req); json(res, completion(safeOutput)); });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-ai-generation-'));
  const previous = Object.fromEntries(['LOG_ROOT', 'CHAT_API_URL', 'CHAT_API_KEY', 'CHAT_MODEL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { LOG_ROOT: root, CHAT_API_URL: config.baseUrl, CHAT_API_KEY: config.apiKey, CHAT_MODEL: config.model });
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('workbench-ai-generation-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'prompts')); await fs.writeFile(path.join(root, 'prompts/generation.md'), '独立实例自定义写作规范');
  const source = Array.from({ length: 31 }, (_, i) => `## 2026-01-${String(i + 1).padStart(2, '0')}\n\n### 标题${i + 1}\n\n${i === 29 ? '当日已保存正文'.repeat(2500) : 'OTHER_DAY_BODY_NOT_FOR_PROVIDER'}\n\n~~~md\n### 围栏假标题\n~~~\n\n---\n\n`).join('');
  const file = path.join(root, '2026-01_学习日志.md'); await fs.writeFile(file, source);
  const before = (await fs.stat(file)).mtimeMs;
  const result = await generateLogDraft({ date, material: 'm'.repeat(60010), extractedText: '提取文本', instruction: '明确要求' });
  assert.equal(result.content, safeOutput); assert.equal(result.model, config.model); assert.equal(result.warnings.length, 2);
  assert.match(captured.messages[0].content, /独立实例自定义写作规范/); assert.doesNotMatch(captured.messages[0].content, /Skill|半角英文括号/);
  const sent = JSON.parse(captured.messages[1].content);
  assert.equal(sent.material.length, 60000); assert.equal(sent.existingDay.length, 12000); assert.equal(sent.instruction, '明确要求');
  assert.equal(sent.recentHeadings.length, 30); assert.equal(sent.recentHeadings[0], '标题30');
  assert.doesNotMatch(captured.messages[1].content, /OTHER_DAY_BODY_NOT_FOR_PROVIDER|围栏假标题|标题31/);
  assert.equal(await fs.readFile(file, 'utf8'), source); assert.equal((await fs.stat(file)).mtimeMs, before);
  assert.deepEqual((await fs.readdir(root)).sort(), ['2026-01_学习日志.md', 'prompts']);
});
