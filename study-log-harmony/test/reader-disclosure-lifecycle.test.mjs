import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url), 'utf8');
const start = html.indexOf('    let qaDisclosureRevision ='), end = html.indexOf('    function escapeHtml(', start);
assert.ok(start >= 0 && end > start);
function fixture(reduced = false) {
  const events = [], animations = [], cancelled = [], frames = new Map(), listeners = new Set();
  let nextFrame = 0;
  const reader = { dataset: { qaDocumentKey: 'current' } };
  const window = {
    readerFrames: { qaLayoutChange: (key, active) => events.push([key, active]) },
    scrollTo() {}, addEventListener: (name, fn) => listeners.add(fn),
    removeEventListener: (name, fn) => listeners.delete(fn)
  };
  const context = vm.createContext({ reader, window, scrollY: 1000, innerHeight: 700,
    document: { documentElement: { scrollHeight: 1700 } },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id)
  });
  vm.runInContext(html.slice(start, end), context);
  const element = () => {
    const owned = [];
    return { isConnected: true, style: { overflow: 'visible' },
      getBoundingClientRect: () => ({ height: 200 }),
      getAnimations: () => owned.filter(animation => animation.playState === 'running'),
      animate() {
        const animation = { playState: 'running', cancel() {
          this.playState = 'idle'; cancelled.push(() => this.oncancel?.());
        }, finish() { this.playState = 'finished'; this.onfinish(); } };
        owned.push(animation); animations.push(animation); return animation;
      }
    };
  };
  return { reader, element, events, animations, cancelled, listeners,
    toggle: node => context.animateQaDisclosure(node, () => {}) };
}
test('rapid disclosure cancels old ownership without a stale end or overflow reset', () => {
  const f = fixture(), node = f.element();
  f.toggle(node); f.toggle(node);
  assert.deepEqual(f.events, [['current', true], ['current', true]]);
  f.cancelled.forEach(fn => fn());
  assert.deepEqual(f.events, [['current', true], ['current', true]]);
  assert.equal(node.style.overflow, 'hidden');
  f.animations[1].finish();
  assert.deepEqual(f.events, [['current', true], ['current', true], ['current', false]]);
  assert.equal(node.style.overflow, 'visible'); assert.equal(f.listeners.size, 0);
});
test('only the latest disclosure finishes layout ownership across answer cards', () => {
  const f = fixture();
  f.toggle(f.element()); f.toggle(f.element());
  f.animations[0].finish(); assert.equal(f.events.length, 2);
  f.animations[1].finish(); assert.deepEqual(f.events.at(-1), ['current', false]);
  assert.equal(f.listeners.size, 0);
});
test('old-document animation completion cannot release the new document', () => {
  const f = fixture();
  f.toggle(f.element()); f.reader.dataset.qaDocumentKey = 'next';
  f.animations[0].finish(); assert.equal(f.events.length, 1);
});
test('reduced motion retains immediate balanced layout events', () => {
  const f = fixture(true), node = f.element();
  f.toggle(node); f.toggle(node);
  assert.deepEqual(f.events.map(event => event[1]), [true, false, true, false]);
  assert.equal(f.animations.length, 0); assert.equal(node.style.overflow, 'visible');
});
test('the actual presentation entry binds and clears the native document identity', async () => {
  const from = html.indexOf('    window.renderMarkdown = async function(markdown, token, theme, mode,');
  const to = html.indexOf('    function detachQaFollow()', from);
  assert.ok(from >= 0 && to > from);
  const reader = { dataset: {} }, window = { cancelQaPresentation() {} };
  const context = vm.createContext({ reader, window, performance: { now: () => 0 },
    qaPresentation: { key: '', eligible: false, update() {} }, qaReturnFrame: 0,
    motionAllowed: () => false, cancelAnimationFrame() {}, renderReceivedMarkdown: async () => {},
    paintQaPresentation: async () => {} });
  vm.runInContext(html.slice(from, to), context);
  await window.renderMarkdown('[]', '', 'light', 'qa', 'http://synthetic.test', 'current');
  assert.equal(reader.dataset.qaDocumentKey, 'current');
  await window.renderMarkdown('', '', 'light', 'log');
  assert.equal(reader.dataset.qaDocumentKey, '');
});

