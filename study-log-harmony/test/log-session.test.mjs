import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { restoredLogDraft } from '../entry/src/main/ets/features/logs/LogDraftPolicy.ts';
const bodySource = await readFile(new URL('../entry/src/main/ets/features/logs/LogDayBody.ets', import.meta.url), 'utf8');

// Execute migrated session and real page handlers, including their async guards.
const sessionSource = await readFile(new URL('../entry/src/main/ets/features/logs/LogSession.ets', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../entry/src/main/ets/features/logs/LogDocumentController.ets', import.meta.url), 'utf8');
const handlers = ['bindDocuments', 'save', 'acceptSavedDay', 'applyRestoredDay', 'installDay', 'loadDay', 'discardDraft'].map(name => {
  const start = pageSource.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0);
  const end = pageSource.slice(start + 1).search(/^  (?:private |@Builder|build\()/m);
  assert.ok(end >= 0);
  return pageSource.slice(start, start + end + 1);
}).join('\n');
function subject() {
  const module = { exports: {} };
  class ApiError extends Error {
    constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
  }
  const source = bodySource.replace(/^import .*;\r?\n/gm, '') + sessionSource.replace(/^import .*;\r?\n/gm, '').replace('@Observed', '') + controllerSource.replace(/^import .*;\r?\n/gm, '').replace('@Observed', '') +
    `\nexport class Page { ${handlers} }`;
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { module, exports: module.exports, Error, ApiError,
    appFeedback: { show() {}, dismissScope() {} }, activeInstance: { namespace: 'synthetic' }, restoredLogDraft });
  const session = new module.exports.LogSession();
  session.commitDocument(day('v1'), 'baseline');
  const page = new module.exports.Page();
  Object.assign(page, { session, editorReady: true, lifecycle: 1, dayRevision: 1,
    outlineHeadings: () => [], reportDraft() {}, refreshNavigation() {}, cancelPendingImages() {},
    closeFavoriteFeedback() {}, coverLogDocument: async () => {}, closeNavigation() {},
    logNavigationFailed() {}, logDocumentReady() {}, isLogDocumentReady: () => false,
    message: error => error.message, showReadFailure() {},
    previewScrollOffsets: {}, workspaceTransition: { finish() {} },
    reads: { invalidate() {} }, bodyFromDay: day => day.content });
  page.writes = {};
  page.documents = new module.exports.LogDocumentController(session, page.reads, page.writes);
  Object.defineProperty(page, 'dayRevision', { get: () => page.documents.dayLoadRevision, set: value => { page.documents.dayLoadRevision = value; } });
  page.bindDocuments();
  return { session, page, ApiError };
}
function day(version, content = 'baseline', date = '2026-02-05') {
  return { date, version, content, exists: true };
}

test('server heading validation keeps the native draft and displays its message without retry reads', async () => {
  for (const [text, message] of [['# 标题', '日志正文不能使用一级标题，请改用三级至六级标题'],
    ['标题\n===', '日志正文不能使用一级标题，请改用三级至六级标题'],
    ['标题\n---', '当前日志正文不能包含二级标题；日期标题由系统维护，请改用三级标题']]) {
    const { session, page, ApiError } = subject();
    page.editor = { command: async () => ({ documentKey: session.selectedDate, text }) };
    page.writes.save = async request => {
      assert.equal(request.content, text);
      throw new ApiError(message, 400);
    };
    page.reads.day = () => assert.fail('validation rejection must not reload the saved document');
    await page.save();
    assert.equal(page.saveError, message);
    assert.equal(session.text, text);
    assert.equal(session.baseline, 'baseline');
    assert.equal(session.baseVersion, 'v1');
    assert.equal(session.isDirty(), true);
    assert.equal(page.documents.saving, false);
  }
});

test('session keeps pending editor changes dirty even before a snapshot arrives', () => {
  const { session } = subject();
  assert.equal(session.isDirty(), false);
  session.editorPending = true;
  assert.equal(session.isDirty(), true);
  session.resetEditor('baseline');
  assert.equal(session.isDirty(), false);
  session.text = 'changed';
  assert.equal(session.isDirty(), true);
});

test('save acknowledgement retains typing that arrived after the submitted snapshot', async () => {
  const { session, page } = subject();
  let release;
  page.editor = { command: async () => ({ documentKey: session.selectedDate, text: 'submitted' }) };
  page.writes.save = () => new Promise(resolve => { release = resolve; });
  const saving = page.save();
  await new Promise(resolve => setImmediate(resolve));
  session.text = 'newer typing';
  release({ day: day('v2', 'submitted') });
  await saving;
  assert.equal(session.text, 'newer typing');
  assert.equal(session.baseline, 'submitted');
  assert.equal(session.baseVersion, 'v2');
  assert.equal(session.isDirty(), true);
  assert.equal(page.previewText, 'newer typing');
});

test('restored local draft based on an older version never reaches the write API', async () => {
  const { session, page } = subject();
  session.baseVersion = 'old';
  page.editor = { command: async () => ({ documentKey: session.selectedDate, text: 'draft' }) };
  page.writes.save = () => assert.fail('must not overwrite a newer server version');
  await page.save();
  assert.match(page.saveError, /旧版本/);
  assert.equal(session.text, 'draft');
  assert.equal(session.isDirty(), true);
});

test('discarding a rejected duplicate-heading draft clears the stale save error', async () => {
  const { session, page } = subject();
  session.text = '### 1. 并发控制\n### 2. 并发控制';
  page.saveError = '同一天不能保存两个“并发控制”小节，请修改重复标题后重试';
  const replacements = [];
  page.editor = { replace: async (body, reset) => replacements.push([body, reset]) };
  await page.discardDraft();
  assert.deepEqual(replacements, [['baseline', true]]);
  assert.equal(session.text, 'baseline');
  assert.equal(session.isDirty(), false);
  assert.equal(page.saveError, '');
});

test('a save reply for a document left behind cannot overwrite the current session', async () => {
  const { session, page } = subject();
  let release;
  page.editor = { command: async () => ({ documentKey: session.selectedDate, text: 'submitted' }) };
  page.writes.save = () => new Promise(resolve => { release = resolve; });
  const saving = page.save();
  await new Promise(resolve => setImmediate(resolve));
  page.dayRevision++;
  session.commitDocument(day('other', 'other document', '2026-02-06'), 'other document');
  release({ day: day('v2', 'submitted') });
  await saving;
  assert.equal(session.selectedDate, '2026-02-06');
  assert.equal(session.text, 'other document');
  assert.equal(session.baseVersion, 'other');
});

test('same-date backup recovery explicitly replaces the mounted editor before installing the session', async () => {
  const { session, page } = subject();
  session.text = 'dirty';
  const replacements = [];
  page.editor = { ready: true, documentKey: session.selectedDate,
    replace: async (body, reset) => replacements.push([body, reset]) };
  await page.applyRestoredDay(day('v2', 'restored'));
  assert.deepEqual(replacements, [['restored', true]]);
  assert.equal(session.text, 'restored');
  assert.equal(session.editorInitialText, 'restored');
  assert.equal(session.baseline, 'restored');
  assert.equal(session.baseVersion, 'v2');
  assert.equal(session.isDirty(), false);
});

test('late editor replacement from a backup cannot install over a newly selected day', async () => {
  const { session, page } = subject();
  let release;
  page.editor = { ready: true, documentKey: session.selectedDate,
    replace: () => new Promise(resolve => { release = resolve; }) };
  const restoring = page.applyRestoredDay(day('v2', 'restored'));
  session.commitDocument(day('other', 'other document', '2026-02-06'), 'other document');
  release();
  await restoring;
  assert.equal(session.text, 'other document');
  assert.equal(session.baseVersion, 'other');
});

test('document loading preserves the local draft version separately from the server baseline', async () => {
  const { session, page } = subject();
  page.initialDraft = { namespace: 'synthetic', date: session.selectedDate, text: 'local draft', baseVersion: 'v1' };
  page.reads.day = async () => ({ day: day('v2', 'server changed') });
  await page.loadDay(session.selectedDate);
  assert.equal(session.day.version, 'v2');
  assert.equal(session.baseline, 'server changed');
  assert.equal(session.baseVersion, 'v1');
  assert.equal(session.text, 'local draft');
  assert.equal(session.editorInitialText, 'local draft');
  assert.equal(session.isDirty(), true);
  assert.match(page.saveError, /服务器版本已变化/);
});

test('late day loading cannot replace the latest requested document', async () => {
  const { session, page } = subject();
  let release;
  page.reads.day = date => date === '2026-02-05' ? new Promise(resolve => { release = resolve; }) :
    Promise.resolve({ day: day('v3', 'new date', date) });
  const older = page.loadDay('2026-02-05');
  await new Promise(resolve => setImmediate(resolve));
  await page.loadDay('2026-02-06');
  release({ day: day('v2', 'late result') });
  await older;
  assert.equal(session.selectedDate, '2026-02-06');
  assert.equal(session.text, 'new date');
  assert.equal(session.isDirty(), false);
});

test('lost save replies are reconciled only for the exact submitted content', async () => {
  for (const matches of [true, false]) {
    const { session, page } = subject();
    page.editor = { command: async () => ({ documentKey: session.selectedDate, text: 'submitted' }) };
    page.writes.save = async () => { throw new Error('lost reply'); };
    page.reads.day = async () => ({ day: day('v2', matches ? 'submitted' : 'another client') });
    await page.save();
    assert.equal(session.baseline, matches ? 'submitted' : 'baseline');
    assert.equal(session.baseVersion, matches ? 'v2' : 'v1');
    assert.equal(session.text, 'submitted');
    assert.equal(session.isDirty(), !matches);
    if (!matches) assert.match(page.saveError, /未覆盖/);
  }
});

test('repeated save while the first snapshot is pending sends only one write', async () => {
  const { session, page } = subject();
  let release;
  let writes = 0;
  page.editor = { command: () => new Promise(resolve => { release = resolve; }) };
  page.writes.save = async () => { writes++; return { day: day('v2', 'submitted') }; };
  const saving = page.save();
  await page.save();
  assert.equal(page.documents.saving, true);
  release({ documentKey: session.selectedDate, text: 'submitted' });
  await saving;
  assert.equal(writes, 1);
  assert.equal(page.documents.saving, false);
});

test('disposing the document owner rejects a late write acknowledgement', async () => {
  const { session, page } = subject();
  let release;
  let saved = 0;
  page.editor = { command: async () => ({ documentKey: session.selectedDate, text: 'submitted' }) };
  page.writes.save = () => new Promise(resolve => { release = resolve; });
  page.acceptSavedDay = () => saved++;
  const saving = page.save();
  await new Promise(resolve => setImmediate(resolve));
  page.documents.dispose();
  release({ day: day('v2', 'submitted') });
  await saving;
  assert.equal(saved, 0);
  assert.equal(session.baseVersion, 'v1');
  assert.equal(page.documents.saving, false);
});

test('failed reading retains the current document and retries the original requested date', async () => {
  const { session, page } = subject();
  let fail = true;
  const requests = [];
  page.reads.day = async date => {
    requests.push(date);
    if (fail) throw new Error('synthetic read failure');
    return { day: day('v2', 'recovered', date) };
  };
  await page.loadDay('2026-02-06', 'target', 2);
  assert.equal(session.selectedDate, '2026-02-05');
  assert.equal(session.text, 'baseline');
  assert.equal(page.readFailed, true);
  assert.equal(page.documents.dayRequestLoading, false);
  fail = false;
  await page.retryRead();
  assert.deepEqual(requests, ['2026-02-06', '2026-02-06']);
  assert.equal(session.text, 'recovered');
  assert.equal(page.targetHeading, 'target');
  assert.equal(page.targetHeadingIndex, 2);
  assert.equal(page.readFailed, false);
});

test('disposing the document owner rejects a late read installation', async () => {
  const { session, page } = subject();
  let release;
  page.reads.day = () => new Promise(resolve => { release = resolve; });
  const reading = page.loadDay('2026-02-06');
  await new Promise(resolve => setImmediate(resolve));
  page.documents.dispose();
  release({ day: day('v2', 'late result', '2026-02-06') });
  await reading;
  assert.equal(session.selectedDate, '2026-02-05');
  assert.equal(session.text, 'baseline');
  assert.equal(page.documents.dayRequestLoading, false);
});
