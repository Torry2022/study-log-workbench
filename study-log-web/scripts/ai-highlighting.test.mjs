import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { collectHighlightSegments, applyHighlightCandidates } from '../lib/highlight-ranges.ts';
import { validateHighlightInput, highlightLogFocus } from '../lib/ai-highlighting.ts';

function select(content, text) {
  const segment = collectHighlightSegments(content).find(segment => segment.text.includes(text));
  assert.ok(segment, text);
  const start = content.indexOf(text, segment.start), end = start + text.length;
  const tokens = segment.tokens.filter(token => token.start >= start && token.end <= end);
  assert.ok(tokens.length, text);
  return { startTokenId: tokens[0].id, endTokenId: tokens.at(-1).id };
}
function restored(result) {
  let content = result.content;
  for (let index = result.ranges.length - 1; index >= 0; index--) {
    const { start, end } = result.ranges[index], shift = index * 4;
    assert.equal(content.slice(start + shift, start + shift + 2), '**');
    assert.equal(content.slice(end + shift + 2, end + shift + 4), '**');
    content = content.slice(0, end + shift + 2) + content.slice(end + shift + 4);
    content = content.slice(0, start + shift) + content.slice(start + shift + 2);
  }
  return content;
}

test('AST exposes list/table prose and excludes headings, every code form, links, images, math, HTML and existing bold', () => {
  const content = [
    '## 2026-01-15', '### 1. ProtectedHeading', 'SetextProtected\n---',
    'Normal prose `ProtectedInline` **ProtectedStrong** __ProtectedUnder__ [ProtectedLink](https://example.invalid) ![ProtectedImage](img.png)',
    '[[2026-01-15#Heading|ProtectedInternal]] [ProtectedRef][ref] ![ProtectedRefImage][ref]',
    '[[2026-01-15#ProtectedTarget|**ProtectedBoldAlias**]]',
    '[ref]: https://example.invalid "ProtectedTitle"',
    '````md\n### ProtectedFence\n```nested\nProtectedNested\n```\n````',
    '~~~txt\nProtectedTilde\n~~~', '    ProtectedIndent',
    '> ```js\n> ProtectedQuoteCode\n> ```', '- ```js\n  ProtectedListCode\n  ```',
    'Formula $ProtectedInlineMath$ and prose.', '$$\nProtectedMath\n$$',
    '<div>ProtectedHtml</div>',
    'Inline <a href="https://example.invalid">ProtectedHtmlLink</a> <strong>ProtectedHtmlStrong</strong>.',
    '1. ListAlpha ListBeta', '- [ ] TaskAlpha TaskBeta',
    '| ColumnAlpha | ColumnBeta |\n| --- | --- |\n| CellAlpha | CellBeta |',
    'Entity &amp; Escape \\* plain tail.'
  ].join('\n\n');
  const segments = collectHighlightSegments(content), sent = segments.map(segment => segment.text).join('\n');
  assert.doesNotMatch(sent, /Protected|2026-01-15|&amp;|\\\*/);
  for (const expected of ['ListAlpha', 'TaskAlpha', 'CellAlpha', 'ColumnAlpha', 'Normal prose']) assert.match(sent, new RegExp(expected));
  const result = applyHighlightCandidates(content, ['ListAlpha ListBeta', 'TaskAlpha', 'CellAlpha', 'Normal prose'].map(text => select(content, text)));
  assert.equal(result.boldCount, 4); assert.equal(result.warnings.length, 0);
  assert.match(result.content, /1\. \*\*ListAlpha ListBeta\*\*/);
  assert.match(result.content, /\| \*\*CellAlpha\*\* \|/);
  assert.equal(restored(result), content);
});

test('CRLF, Unicode offsets, nesting and existing markers survive byte-for-byte after removing only added bold', () => {
  const content = '### 原编号标题\r\n\r\n1. 中文术语与 Unicode 示例。\r\n\r\n> 引用里的观点与**已有重点**。\r\n\r\n*emphasized Alpha words* and ~~deleted Beta words~~.\r\n\r\nemoji 😀 与𠀀扩展文字。\r\n';
  const candidates = ['中文术语', 'Unicode', '引用里的观点', 'Alpha', 'Beta', '扩展文字'].map(text => select(content, text));
  const result = applyHighlightCandidates(content, candidates);
  assert.ok(result.boldCount >= 4);
  assert.equal(restored(result), content);
  assert.ok(result.content.includes('**已有重点**'));
  assert.equal(Buffer.from(restored(result)).compare(Buffer.from(content)), 0);
});

test('cross-segment, nonexistent, malformed, overlapping and syntax-unsafe ranges cannot become rewrites', () => {
  const content = 'Alpha first. **Existing** Beta second.\n\nGamma third.';
  const alpha = select(content, 'Alpha'), beta = select(content, 'Beta'), gamma = select(content, 'Gamma');
  const result = applyHighlightCandidates(content, [
    { startTokenId: alpha.startTokenId, endTokenId: beta.endTokenId },
    { startTokenId: 'S999T99', endTokenId: 'S999T100' },
    { startTokenId: 42 }, null, 'rewrite all content',
    alpha, alpha, gamma
  ]);
  assert.equal(result.boldCount, 2); assert.match(result.warnings.join(' '), /5 组/);
  assert.equal(restored(result), content);
  const empty = applyHighlightCandidates(content, []);
  assert.equal(empty.content, content); assert.equal(empty.boldCount, 0); assert.match(empty.warnings.join(' '), /原文保持不变/);
  const noToken = applyHighlightCandidates(content, [{ startTokenId: 'prefix S1T1 suffix' }]);
  assert.equal(noToken.content, content);
  const repeated = applyHighlightCandidates(content, Array(205).fill(alpha));
  assert.equal(repeated.boldCount, 1); assert.match(repeated.warnings.join(' '), /5 组/);
});

test('invalid input cannot be coerced into a model request', () => {
  for (const value of [null, [], {}, { date: '2026-02-30', content: 'x' }, { date: '2999-01-01', content: 'x' }, { date: '2026-01-15', content: {} }, { date: '2026-01-15', content: ' ' }, { date: '2026-01-15', content: 'x'.repeat(60001) }]) {
    assert.throws(() => validateHighlightInput(value), error => error.code === 'AI_INVALID_HIGHLIGHT_INPUT');
  }
});

test('local model selects IDs only; no candidates and invalid cross-segment selection preserve original; templates control preferences', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-highlighting-'));
  const previous = Object.fromEntries(['LOG_ROOT', 'CHAT_API_KEY', 'CHAT_API_URL', 'CHAT_MODEL'].map(key => [key, process.env[key]]));
  let calls = 0, captured, mode = 'valid';
  const input = { date: '2026-01-15', content: '### HeadingNeverSend\n\nAlpha content. **StrongNeverSend** Beta content.' };
  const selected = select(input.content, 'Alpha');
  const app = http.createServer(async (req, res) => {
    calls++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
    captured = JSON.parse(Buffer.concat(chunks).toString());
    let response;
    if (mode === 'valid') response = JSON.stringify({ highlights: [selected], content: 'MODEL_REWRITE_NEVER_APPLY' });
    if (mode === 'none') response = JSON.stringify({ highlights: [] });
    if (mode === 'invalidRange') response = JSON.stringify({ highlights: [{ startTokenId: 'S1T1', endTokenId: 'S2T1' }] });
    if (mode === 'rewrite') response = JSON.stringify({ content: 'MODEL_REWRITE_NEVER_APPLY' });
    if (mode === 'bad') response = 'sensitive-model-body';
    if (mode === '429') { res.statusCode = 429; return res.end('sensitive-model-body'); }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: response } }] }));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { LOG_ROOT: root, CHAT_API_KEY: 'synthetic-highlight-key', CHAT_API_URL: `http://127.0.0.1:${app.address().port}/chat`, CHAT_MODEL: 'highlight-fixture' });
  t.after(async () => {
    app.closeAllConnections(); await new Promise(resolve => app.close(resolve));
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('workbench-highlighting-')); await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'prompts')); await fs.writeFile(path.join(root, 'prompts/highlighting.md'), '重点选择以用户实例的独立学科材料为准。');
  const result = await highlightLogFocus(input);
  assert.equal(result.content, input.content.replace('Alpha', '**Alpha**')); assert.equal(result.boldCount, 1); assert.equal(result.model, 'highlight-fixture');
  assert.deepEqual(Object.keys(result).sort(), ['boldCount', 'content', 'model', 'warnings']);
  assert.match(captured.messages[0].content, /独立学科/); assert.doesNotMatch(captured.messages[0].content, /KV Cache|通常选择|计算机/);
  assert.doesNotMatch(captured.messages[1].content, /HeadingNeverSend|StrongNeverSend/); assert.equal(captured.temperature, 0);
  for (const behavior of ['none', 'invalidRange']) { mode = behavior; const unchanged = await highlightLogFocus(input); assert.equal(unchanged.content, input.content); assert.equal(unchanged.boldCount, 0); assert.ok(unchanged.warnings.length); }
  for (const behavior of ['rewrite', 'bad', '429']) { mode = behavior; await assert.rejects(highlightLogFocus(input), error => { assert.ok(error.code.startsWith('AI_')); assert.doesNotMatch(error.message, /sensitive-model-body|synthetic-highlight-key|127\.0\.0\.1/); return true; }); }
  const before = calls;
  const protectedOnly = await highlightLogFocus({ date: input.date, content: '### Header\n\n```md\ncode\n```\n\n**already bold**' });
  assert.equal(protectedOnly.boldCount, 0); assert.equal(calls, before);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(highlightLogFocus(input, abort.signal), error => error.code === 'AI_CANCELLED'); assert.equal(calls, before);
  assert.deepEqual(await fs.readdir(root), ['prompts']);
});
