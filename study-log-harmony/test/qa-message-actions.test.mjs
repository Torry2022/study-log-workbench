import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const transform = async (source) => ({ code: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText });
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
async function pageMethods(start, end, dependencies = {}) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  const { code } = await transform(`class Page { ${source.slice(first, last)} }`, { loader: 'ts' });
  return new Function(...Object.keys(dependencies), `${code}; return Page;`)(...Object.values(dependencies));
}

test('copying a user question preserves original newlines and source-like tokens exactly', async () => {
  let copied, edited;
  const Page = await pageMethods('  private async answerAction(', '  private composerHorizontalInset(', {
    pasteboard: { MIMETYPE_TEXT_PLAIN: 'text/plain', createData: (_type, text) => text,
      getSystemPasteboard: () => ({ setData: async value => { copied = value; } }) },
    setTimeout() {}, appFeedback: { show() { assert.fail('copy should succeed'); } }
  });
  const question = '  原始问题\n[S1]\n不要替换引用  ';
  const page = Object.assign(new Page(), { data: { answerMessages: () => [{ id: 'user', role: 'user', content: question }], beginQuestionEdit: id => { edited = id; } } });
  await page.answerAction('user', 'copy', ''); assert.equal(copied, question);
  await page.answerAction('user', 'edit', ''); assert.equal(edited, 'user');
});

test('question date separators use only known original times, at day changes or 30 minute gaps', async () => {
  class FixedDate extends Date { static now() { return Date.parse('2026-10-30T04:00:00Z'); } }
  const Page = await pageMethods('  private questionTimeLabel(', '  private answerMarkdown(', { Date: FixedDate });
  const page = new Page(); let previous = 0;
  const label = value => page.questionTimeLabel(value, previous, time => { previous = time; });
  assert.equal(label(undefined), ''); assert.equal(label('invalid'), ''); assert.equal(previous, 0);
  assert.match(label('2026-10-22T12:00:00+08:00'), /^10月22日 12:00$/);
  assert.equal(label('2026-10-22T12:29:00+08:00'), '');
  assert.match(label('2026-10-22T12:59:00+08:00'), /12:59$/);
  assert.match(label('2026-10-22T23:59:00+08:00'), /23:59$/);
  assert.match(label('2026-10-23T00:01:00+08:00'), /^10月23日 00:01$/);
  previous=0; assert.equal(label('2026-10-29T16:05:00Z'), '今天 00:05');
  previous=0; assert.equal(label('2026-10-29T15:59:00Z'), '昨天 23:59');
  previous=0; assert.equal(label('2026-10-28T04:00:00Z'), '星期三 12:00');
  previous=0; assert.equal(label('2025-10-28T04:00:00Z'), '2025年10月28日 12:00');
});

test('orphan drafts remain actual reader content even when no canonical messages remain', async () => {
  const Page = await pageMethods('  private conversationPayload(', '  private questionTimeLabel(');
  const draft = { messageId: 'removed', content: '可复制的草稿\n[S1]', token: 'edit-token', baseVersion: '', error: '' };
  const page = Object.assign(new Page(), { workspaceActive: true, copiedAnswerId: '', data: {
    questionEdit: () => draft, questionEditRevision: 2, sessionDocumentKey: 'session-key', messages: [],
    visibleAnswerMessages: () => [], orphanQuestionEdits: () => [draft], sending: false, taskSaving: false
  } });
  const payload = JSON.parse(page.conversationPayload());
  assert.equal(payload.length, 1); assert.equal(payload[0].editOrphan, true);
  assert.equal(payload[0].editContent, draft.content); assert.equal(payload[0].editToken, draft.token);
  assert.equal(payload[0].editBusy, false); assert.equal(payload[0].documentKey, 'session-key');
  assert.equal(page.hasConversation(), true);
});

test('reader edit bridge rejects old documents, hidden/disposed readers and malformed payloads', async () => {
  const reader = await readFile(new URL('../entry/src/main/ets/common/ui/MarkdownReader.ets', import.meta.url), 'utf8');
  const start = reader.indexOf('    this.frameBridge.onQaQuestionEdit = '), end = reader.indexOf('    this.frameBridge.onBottomInsetReady = ', start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transform(`class Reader { bind() { ${reader.slice(start, end)} } }`, { loader: 'ts' });
  const Reader = new Function(`${code}; return Reader;`)(), calls = [];
  const r = Object.assign(new Reader(), { frameBridge: {}, active: true, ready: true, contentMode: 'qa', documentKey: 'current', onQaQuestionEdit: (...args) => calls.push(args) });
  r.bind();
  r.frameBridge.onQaQuestionEdit('old', 'q', 'token', 'change', 'old text');
  r.frameBridge.onQaQuestionEdit('current', 'q', 'token', 'change', 'draft');
  assert.deepEqual(calls, [['q', 'token', 'change', 'draft']]);
  for (const [field, value] of [['active', false], ['ready', false], ['contentMode', 'log']]) {
    const prior = r[field]; r[field] = value;
    r.frameBridge.onQaQuestionEdit('current', 'q', 'token', 'send', 'draft'); r[field] = prior;
  }
  r.frameBridge.onQaQuestionEdit('current', 'q', '', 'send', 'draft');
  r.frameBridge.onQaQuestionEdit('current', 'q', 'token', 'unknown', 'draft');
  r.frameBridge.onQaQuestionEdit('current', 'q', 'token', 'send', 'x'.repeat(2001));
  assert.equal(calls.length, 1);
});

test('page rejects events from a cancelled editor token and from a hidden module before changing the draft', async () => {
  const start = source.indexOf('                onQaQuestionEdit: '), end = source.indexOf('                onQaAttemptAction: ', start);
  assert.ok(start >= 0 && end > start);
  const callback = source.slice(start, end).replace(/^\s*onQaQuestionEdit:\s*/, '').trim().replace(/,$/, '');
  const { code } = await transform(`function bind() { return ${callback}; }`, { loader: 'ts' });
  const calls = [], page = { workspaceActive: true, data: { questionEdit: () => ({ token: 'new-token' }),
    changeQuestionEdit: (...args) => calls.push(['change', ...args]), submitQuestionEdit: id => calls.push(['send', id]),
    cancelQuestionEdit: id => calls.push(['cancel', id]) } };
  const action = new Function(`${code}; return bind;`)().call(page);
  action('q', 'old-token', 'change', 'stale'); assert.deepEqual(calls, []);
  page.workspaceActive = false; action('q', 'new-token', 'send', 'hidden'); assert.deepEqual(calls, []);
  page.workspaceActive = true; action('q', 'new-token', 'send', 'current');
  assert.deepEqual(calls, [['change', 'q', 'current'], ['send', 'q']]);
});

test('an older streaming render cannot scroll an inline editor to the bottom after its images finish', async () => {
  const reader = await readFile(new URL('../entry/src/main/ets/common/ui/MarkdownReader.ets', import.meta.url), 'utf8');
  const start = reader.indexOf('  private render(): void {'), end = reader.indexOf('  private handleTargetResult(', start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transform(`class Reader { ${reader.slice(start, end)} }`, { loader: 'ts' });
  const Reader = new Function('apiClient', 'usesWideTypography', 'activeInstance', `${code}; return Reader;`)({ getToken: () => '' }, () => false, { origin: 'http://synthetic-instance.invalid' });
  let finishOld, request = 0; const scrolls = [], completed = [], historyReady = [];
  const context = { document: { documentElement: { style: { setProperty() {} }, dataset: {} }, body: { scrollHeight: 3000 } },
    window: { setQaHistory() {}, qaHistoryReady() { historyReady.push(context.window.readerActionRevision); }, clearLocatedHeading() {}, renderMarkdown: () => ++request === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(),
      scrollTo: (...args) => scrolls.push(args), readerFrames: { rendered: value => completed.push(value), failed() { assert.fail('render should succeed'); } } },
    requestAnimationFrame: callback => callback() };
  const r = Object.assign(new Reader(), { active: true, ready: true, content: 'streaming', contentMode: 'qa',
    contentTopInset: 0, themePreference: 'light', targetRevision: 0, restoreScrollOffset: 0, followEnd: true,
    scrollToEndRequestRevision: 0, handledEndRevision: 0, documentKey: 'session', lastRenderedDocumentKey: 'session',
    resetScrollOnContentChange: false, renderSequence: 0, readingScale: 1,
    desiredRenderKey() { return this.content; }, desiredContentKey() { return this.content; },
    controller: { runJavaScript: script => runInNewContext(script, context) } });
  r.render(); r.content = 'inline editor'; r.followEnd = false; r.render();
  await Promise.resolve(); finishOld(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(scrolls, []); assert.deepEqual(completed, [2]);
  assert.deepEqual(historyReady, [2], 'only the current completed render enables history loading');
});
