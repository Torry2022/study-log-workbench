import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const transform = async input => ({ code: ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText });
const source = await readFile(new URL('../entry/src/main/ets/common/ui/MarkdownReader.ets', import.meta.url), 'utf8');
function method(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const methods = [
  method('  private measureScrollRange(', '  private scrollToTop('),
  method('  private updateScrollProgress(', '  private measureScrollRange('),
  method('  private javaScriptString(', '  private '),
  method('  private qaLayoutChanged(', '  private viewportRequested('),
  method('  private handleScroll(', '  private measureActiveHeading(')
].join('\n');
const { code } = await transform(`class Reader { ${methods} }`, { loader: 'ts' });
class FrameAction { constructor(callback) { this.callback = callback; } }
const Reader = new Function('FrameAction', `${code}; return Reader;`)(FrameAction);
function fixture() {
  const calls = [], frames = [], remaining = [], positions = [];
  const reader = Object.assign(new Reader(), {
    active: true, ready: true, showBackToTop: false, trackScrollProgress: true,
    renderSequence: 1, documentKey: 'current', contentMode: 'qa',
    scrollRangeRevision: 0, scrollRangeQueryPending: false, scrollRangeQueryQueued: false, scrollPositionRevision: 0,
    maxScrollOffset: 1104, scrollOffset: 1104, qaLayoutRevision: 0, qaLayoutChanging: false,
    acceptsRender(sequence) { return this.active && this.ready && sequence === this.renderSequence; },
    controller: { runJavaScript(script, callback) { calls.push({ script, callback }); } },
    getUIContext: () => ({ postFrameCallback: action => frames.push(action.callback) }),
    onScrollPosition: (offset, layout) => positions.push([offset, layout]),
    measureActiveHeading() {}, bottomInsetChanging: false, scrollToEndRequestRevision: 0, handledEndRevision: 0,
    onScrollProgress() {}, onScrollRemaining: value => remaining.push(value)
  });
  return { reader, calls, frames, remaining, positions };
}
test('disclosure completion measures actual offset and shrinking range without moving the DOM', () => {
  const { reader, calls, frames, remaining, positions } = fixture();
  reader.qaLayoutChanged('current', true, 1104);
  assert.equal(reader.qaLayoutChanging, true);
  reader.qaLayoutChanged('current', false, 1016);
  assert.equal(calls.length, 0);
  frames.shift()();
  assert.equal(reader.qaLayoutChanging, false);
  assert.match(calls[0].script, /window.scrollY/);
  assert.doesNotMatch(calls[0].script, /scrollTo|scrollBy/);
  calls[0].callback(null, JSON.stringify(JSON.stringify([1016, 1016])));
  assert.equal(reader.maxScrollOffset, 1016);
  assert.equal(reader.scrollOffset, 1016);
  assert.deepEqual(remaining, [0]);
  assert.deepEqual(positions, [[1016, true]]);
});
test('pending query coalesces latest disclosure and ignores superseded measurement', () => {
  const { reader, calls, frames, remaining } = fixture();
  reader.measureScrollRange();
  reader.qaLayoutChanged('current', false, 1016); frames.shift()();
  reader.qaLayoutChanged('current', false, 900); frames.shift()();
  assert.equal(calls.length, 1);
  calls[0].callback(null, '[1104,1104]');
  assert.deepEqual(remaining, []);
  assert.equal(calls.length, 2, 'latest request is not swallowed by pending query');
  calls[1].callback(null, '[900,900]');
  assert.deepEqual(remaining, [0]); assert.equal(reader.maxScrollOffset, 900);
});
test('old document, old render and disposed results cannot update the current reader', () => {
  for (const invalidate of [
    reader => { reader.documentKey = 'next'; },
    reader => { reader.renderSequence++; },
    reader => { reader.active = false; },
    reader => { reader.ready = false; }
  ]) {
    const { reader, calls, remaining } = fixture();
    reader.measureScrollRange(); invalidate(reader);
    calls[0].callback(null, '[0,0]');
    assert.deepEqual(remaining, []); assert.equal(reader.maxScrollOffset, 1104);
  }
});
test('a new document request survives an old pending callback', () => {
  const { reader, calls, remaining } = fixture();
  reader.measureScrollRange(); reader.documentKey = 'next'; reader.renderSequence++;
  reader.measureScrollRange(); calls[0].callback(null, '[0,0]');
  assert.equal(calls.length, 2); assert.deepEqual(remaining, []);
  calls[1].callback(null, '[120,800]'); assert.deepEqual(remaining, [680]);
});
test('outdated disclosure frames and foreign document messages are ignored', () => {
  const { reader, calls, frames } = fixture();
  reader.qaLayoutChanged('old', false, 0); assert.equal(frames.length, 0);
  reader.qaLayoutChanged('current', false, 900);
  reader.qaLayoutChanged('current', true, 950); frames.shift()();
  assert.equal(calls.length, 0); assert.equal(reader.qaLayoutChanging, true);
  reader.qaLayoutChanged('current', false, 950); reader.renderSequence++; frames.shift()();
  assert.equal(calls.length, 0);
  assert.equal(reader.qaLayoutChanging, false, 'a replaced render releases its layout owner');
});
test('a gesture after measurement dispatch wins over the delayed DOM offset', () => {
  const { reader, calls, remaining, positions } = fixture();
  reader.measureScrollRange();
  reader.handleScroll(400);
  calls[0].callback(null, '[1104,1104]');
  assert.equal(reader.scrollOffset, 400); assert.equal(remaining.at(-1), 704);
  assert.deepEqual(positions, [[400, false]]);
});
test('same-document rerender releases layout attribution before later user scrolling', () => {
  const { reader, frames, positions } = fixture();
  reader.qaLayoutChanged('current', false, 1104);
  reader.renderSequence++; frames.shift()(); reader.handleScroll(400);
  assert.equal(reader.qaLayoutChanging, false); assert.deepEqual(positions.at(-1), [400, false]);
});
test('invalid or failed measurements preserve prior range; queued latest query still executes', () => {
  for (const value of ['null', '{}', '[1]', '[1,null]', '"bad"', '[1,"2"]']) {
    const { reader, calls, remaining } = fixture();
    reader.measureScrollRange(); calls[0].callback(null, value);
    assert.deepEqual(remaining, []); assert.equal(reader.maxScrollOffset, 1104);
    assert.equal(reader.scrollRangeQueryPending, false);
  }
  const { reader, calls, remaining } = fixture();
  reader.measureScrollRange(); reader.measureScrollRange(); calls[0].callback(new Error('detached'), '');
  assert.equal(calls.length, 2); calls[1].callback(null, '[400,900]');
  assert.deepEqual(remaining, [500]);
});
test('native bridge exposes disclosure lifecycle on the actual Web entry', () => {
  assert.match(source, /qaLayoutChange\(key: string, active: boolean, offset: number\)/);
  assert.match(source, /this\.frameBridge\.onQaLayoutChange = .*this\.qaLayoutChanged/);
  assert.match(source, /methodList: \[[^\]]*'qaLayoutChange'/);
  assert.match(source, /this\.bottomInsetChanging \|\| this\.qaLayoutChanging/);
});

