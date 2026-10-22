import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const transform = async (input) => ({ code: ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText });

const source = await readFile(new URL('../entry/src/main/ets/common/ui/MarkdownReader.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private contentBottomInsetChanged()'), source.indexOf('  private handleInternalLink('));
const { code } = await transform(`class Reader { ${methods} }`, { loader: 'ts' });

function fixture() {
  const timers = new Map(), frames = [], scripts = [], events = [];
  let timerId = 0;
  const Reader = new Function('apiClient', 'usesWideTypography', 'FrameAction', 'setTimeout', 'clearTimeout', 'activeInstance', `${code}; return Reader;`)(
    { getToken: () => '' }, () => false, class { constructor(fn) { this.fn = fn; } },
    fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id), { origin: 'http://synthetic.test/study-log' });
  const reader = new Reader();
  Object.assign(reader, {
    content: 'first', documentKey: 'day-a', contentMode: 'document', contentTopInset: 0,
    themePreference: 'light', systemTheme: 'light', workspaceBreakpoint: 0, readingScale: 1,
    targetHeading: '', targetHeadingId: '', targetHeadingIndex: -1, targetKind: '', targetQuery: '',
    targetRevision: 0, handledTargetRevision: -1, followEnd: false, resetScrollOnContentChange: false,
    scrollToEndRequestRevision: 0, handledEndRevision: 0,
    restoreScrollOffset: 0, renderSequence: 0, lastRenderKey: '', lastRenderedContent: '', lastRenderedDocumentKey: '',
    ready: true, active: true, renderScheduled: false, renderTimer: -1, viewportSequence: 0, completedContentKey: '',
    viewportWidthPx: 700, stableViewport: false, frameBridge: {},
    contentBottomInset: 0, bottomInsetRevision: 0, bottomInsetChanging: false,
    controller: { runJavaScript: (script, callback) => { scripts.push({ script, callback }); if (script === 'window.scrollY') callback(null, '1200'); } },
    getUIContext: () => ({ postFrameCallback: frame => frames.push(frame) }),
    measureScrollRange() {}, measureActiveHeading() {}, measureTopDividerPosition() {}, onScrollPosition() {},
    onRenderReady: () => events.push('ready'), onContentRendered: (text, key) => events.push([text, key]),
    onRenderFailed: key => events.push(['failed', key]), onViewportReady: () => events.push('viewport')
  });
  reader.aboutToAppear();
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  reader.render();
  return { reader, timers, frames, scripts, events, flush };
}

test('reader rejects completion and failure of old props before the queued replacement renders', () => {
  for (const [field, value] of [['content', 'second'], ['documentKey', 'day-b'], ['themePreference', 'dark']]) {
    const { reader, events, flush } = fixture();
    const previous = reader.renderSequence;
    reader[field] = value;
    reader.requestRender();
    reader.frameBridge.onRendered(previous);
    reader.frameBridge.onFailed(previous);
    assert.deepEqual(events, [], field);
    flush();
    reader.frameBridge.onRendered(previous);
    assert.deepEqual(events, []);
    reader.frameBridge.onRendered(reader.renderSequence);
    assert.deepEqual(events, ['ready', [reader.content, reader.documentKey]]);
  }
});

test('reader inset changes preserve content and reject stale or disposed layout completions', () => {
  const { reader, scripts } = fixture();
  const offsets = [];
  reader.onScrollPosition = (offset, layoutChange) => offsets.push([offset, layoutChange]);
  const renderSequence = reader.renderSequence;
  reader.contentBottomInset = 132;
  reader.contentBottomInsetChanged();
  reader.contentBottomInset = 0;
  reader.contentBottomInsetChanged();
  assert.equal(reader.renderSequence, renderSequence, 'changing clearance must not render the conversation again');
  assert.match(scripts.at(-1).script, /setReaderBottomInset\(0, 2\)/);
  reader.frameBridge.onBottomInsetReady(1, 200);
  assert.equal(reader.bottomInsetChanging, true);
  assert.deepEqual(offsets, []);
  reader.frameBridge.onBottomInsetReady(2, 100);
  assert.equal(reader.bottomInsetChanging, false);
  assert.deepEqual(offsets, [[100, true]]);
  reader.aboutToDisappear();
  reader.frameBridge.onBottomInsetReady(2, 50);
  assert.deepEqual(offsets, [[100, true]]);
});

test('same log target changes reuse completed DOM but new documents rebuild it', () => {
  const { reader, scripts } = fixture();
  reader.contentMode = 'log'; reader.render();
  reader.frameBridge.onRendered(reader.renderSequence);
  reader.targetHeading = 'third'; reader.targetRevision = 1; reader.render();
  assert.match(scripts.at(-1).script, /Promise\.resolve\(\)\.then/);
  assert.doesNotMatch(scripts.at(-1).script, /window\.renderMarkdown\(/);
  assert.match(scripts.at(-1).script, /window\.scrollToHeading/);
  reader.documentKey = 'day-b'; reader.render();
  assert.match(scripts.at(-1).script, /window\.renderMarkdown\(/);
  assert.match(scripts.at(-1).script, /window\.clearLocatedHeading\(\)/);
});

test('unfinished or failed rendering never reuses an unconfirmed DOM', () => {
  const { reader, scripts } = fixture();
  reader.contentMode = 'log'; reader.render();
  reader.targetRevision = 1; reader.targetHeading = 'third'; reader.render();
  assert.match(scripts.at(-1).script, /window\.renderMarkdown\(/);
  reader.frameBridge.onRendered(reader.renderSequence);
  reader.content = 'replacement'; reader.render();
  reader.frameBridge.onFailed(reader.renderSequence);
  reader.content = 'first'; reader.render();
  assert.match(scripts.at(-1).script, /window\.renderMarkdown\(/);
});

test('an unchanged scheduled render still accepts its one real completion', () => {
  const { reader, events, flush, scripts } = fixture();
  reader.requestRender();
  reader.frameBridge.onRendered(reader.renderSequence);
  flush();
  assert.deepEqual(events, ['ready', ['first', 'day-a']]);
  assert.equal(scripts.length, 1);
});


test('old JavaScript execution errors cannot clear a newer desired document', () => {
  const { reader, scripts, events, flush } = fixture();
  reader.content = 'new'; reader.requestRender();
  scripts[0].callback(new Error('old execution'));
  assert.deepEqual(events, []);
  flush(); reader.frameBridge.onRendered(reader.renderSequence);
  assert.deepEqual(events, ['ready', ['new', 'day-a']]);
});

test('viewport readiness is tied to the latest layout request including its pending frame', () => {
  const { reader, frames, events } = fixture();
  reader.checkViewport(); const old = reader.viewportSequence;
  reader.viewportRequested();
  reader.frameBridge.onViewportReady(old);
  assert.deepEqual(events, []);
  frames.shift().fn();
  reader.frameBridge.onViewportReady(old);
  assert.deepEqual(events, []);
  reader.frameBridge.onViewportReady(reader.viewportSequence);
  assert.deepEqual(events, ['viewport']);
});

test('reader disposal cancels scheduled rendering and ignores late bridge callbacks', () => {
  const { reader, frames, timers, events, scripts, flush } = fixture();
  reader.requestRender(); reader.viewportRequested();
  reader.aboutToDisappear();
  assert.equal(timers.size, 0);
  flush(); frames.forEach(frame => frame.fn());
  reader.frameBridge.onRendered(reader.renderSequence);
  reader.frameBridge.onFailed(reader.renderSequence);
  reader.frameBridge.onViewportReady(reader.viewportSequence);
  assert.deepEqual(events, []); assert.equal(scripts.length, 1);
});


test('answer-version end requests wait for rendering and are consumed only by the current completed frame', () => {
  const { reader, scripts } = fixture();
  const positions = []; reader.onScrollPosition = (offset, layout) => positions.push([offset, layout]);
  reader.frameBridge.onRendered(reader.renderSequence);
  reader.scrollToEndRequestRevision = 1; reader.content = 'longer version'; reader.render();
  const versionSequence = reader.renderSequence;
  assert.match(scripts.at(-1).script, /renderMarkdown[\s\S]*\.then\(\(\) => \{ window.scrollTo\(0, document.body.scrollHeight\)/);
  reader.content = 'newer version'; reader.scrollToEndRequestRevision = 2; reader.render();
  reader.frameBridge.onRendered(versionSequence);
  assert.equal(reader.handledEndRevision, 0, 'obsolete frame cannot consume the current request');
  reader.frameBridge.onRendered(reader.renderSequence); assert.equal(reader.handledEndRevision, 2);
  assert.deepEqual(positions, [[1200, true]], 'the completed offset seeds native gesture detection before late scroll events');
  reader.content = 'background metadata update'; reader.render();
  assert.doesNotMatch(scripts.at(-1).script, /window.scrollTo\(0, document.body.scrollHeight\)/, 'manual reading is not pulled back after completion');
  reader.scrollToEndRequestRevision = 0; reader.documentKey = 'other-history'; reader.render();
  assert.match(scripts.at(-1).script, /window.scrollTo\(0, 0\)/);
  reader.frameBridge.onRendered(reader.renderSequence);
  reader.scrollToEndRequestRevision = 1; reader.content = 'history answer version'; reader.render();
  assert.match(scripts.at(-1).script, /window.scrollTo\(0, document.body.scrollHeight\)/);
});
