import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const base = new URL('../entry/src/main/ets/', import.meta.url);
const qa = await readFile(new URL('features/qa/QaPage.ets', base), 'utf8');
const reader = await readFile(new URL('common/ui/MarkdownReader.ets', base), 'utf8');
function subject(source, names) {
  const methods = names.map(name => {
    const start = source.search(new RegExp(`^  (?:private )?${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    const next = source.slice(start + 1).search(/^  (?:private |aboutTo|@Builder|build\()/m);
    return source.slice(start, next < 0 ? source.length : start + 1 + next);
  }).join('\n');
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(`export class Subject {${methods}}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports });
  return new module.exports.Subject();
}
test('composer clearance changes do not count as upward gestures and focused input remains available', () => {
  const page = subject(qa, ['setComposerHidden', 'handleReaderScroll']);
  Object.assign(page, { composerHidden: false, questionFocused: false, lastScrollY: 0,
    scrollTravel: 0, scrollDirection: 0, topDividerOffset: 0,
    data: { question: '', sending: false }, onScrollStateChange() {} });
  page.handleReaderScroll(100); assert.equal(page.composerHidden, true);
  page.handleReaderScroll(20, true); assert.equal(page.composerHidden, true);
  assert.equal(page.lastScrollY, 20);
  page.handleReaderScroll(100, true); page.handleReaderScroll(40);
  assert.equal(page.composerHidden, false);
  page.questionFocused = true; page.handleReaderScroll(200);
  assert.equal(page.composerHidden, false);
  const body = qa.slice(qa.indexOf('MarkdownReader({'), qa.indexOf('Column({ space: 6 })'));
  assert.match(body, /contentBottomInset: this.composerHeight/);
  assert.doesNotMatch(body, /contentBottomInset: this.composerHidden/);
  assert.doesNotMatch(body, /padding\(\{ bottom: this.composerHeight \}\)/);
});
test('reader inset updates never rerender content and reject stale and disposed layout acknowledgments', () => {
  const page = subject(reader, ['contentBottomInsetChanged', 'aboutToAppear', 'aboutToDisappear']);
  const scripts = [], offsets = [];
  Object.assign(page, { active: false, ready: true, contentBottomInset: 132,
    bottomInsetRevision: 0, bottomInsetChanging: false, frameBridge: {}, renderSequence: 7,
    viewportSequence: 0, renderTimer: -1, controller: { runJavaScript: value => scripts.push(value) },
    measureScrollRange() {}, onScrollPosition: (offset, layout) => offsets.push([offset, layout]) });
  page.aboutToAppear(); page.contentBottomInsetChanged();
  page.contentBottomInset = 0; page.contentBottomInsetChanged();
  assert.equal(page.renderSequence, 7); assert.match(scripts.at(-1), /setReaderBottomInset\(0, 2\)/);
  page.frameBridge.onBottomInsetReady(1, 200);
  assert.equal(page.bottomInsetChanging, true); assert.deepEqual(offsets, []);
  page.frameBridge.onBottomInsetReady(2, 100);
  assert.equal(page.bottomInsetChanging, false); assert.deepEqual(offsets, [[100, true]]);
  page.aboutToDisappear(); page.frameBridge.onBottomInsetReady(2, 50);
  assert.deepEqual(offsets, [[100, true]]);
});

test('native reaching the end reveals the input without changing the measured footer slot', () => {
  const page = subject(qa, ['setComposerHidden', 'handleReaderProgress']);
  Object.assign(page,{composerHidden:true,composerHeight:132,readerScrollOffset:500});
  page.handleReaderProgress(0.5);assert.equal(page.composerHidden,true);
  page.handleReaderProgress(1);assert.equal(page.composerHidden,false);assert.equal(page.composerHeight,132);
});
