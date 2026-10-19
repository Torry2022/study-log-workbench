import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { logReloadInitializer, LOG_RELOAD_KEY, readLogReloadContext } from '../lib/log-reload-restore.ts';

function initialize(snapshot, type = 'reload') {
  const listeners = new Map(), timers = [];
  const root = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
  const history = { scrollRestoration: 'auto' };
  const storage = new Map([[LOG_RELOAD_KEY, JSON.stringify(snapshot)]]);
  const context = { window: { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) }, document: { documentElement: root }, history,
    location: { href: 'https://example.test/study-log?date=2024-04-03' },
    performance: { getEntriesByType: () => [{ type }] },
    sessionStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
    setTimeout: handler => timers.push(handler) };
  vm.runInNewContext(logReloadInitializer, context);
  return { ...context, root, storage, listeners, timers };
}
const snapshot = { url: 'https://example.test/study-log?date=2024-04-03', date: '2024-04-03', mode: 'preview', height: 9000, position: { windowTop: 1200, previewTop: 0, editorTop: 0 } };
test('only a matching scrolled reload reserves space; the snapshot is consumed', () => {
  const state = initialize(snapshot);
  assert.equal(state.root.dataset.logReload, 'pending');
  assert.equal(state.history.scrollRestoration, 'manual');
  assert.equal(state.storage.has(LOG_RELOAD_KEY), false);
  state.window.__studyLogReload.finish();
  state.window.__studyLogReload.finish();
  assert.equal(state.root.dataset.logReload, undefined);
  assert.equal(state.history.scrollRestoration, 'auto');
  assert.equal(state.window.__studyLogReload.active, false);
});

test('manual input and script timeout both release prepaint protection and scroll restoration', () => {
  for (const stop of [state => state.listeners.get('pointerdown')(), state => state.timers[0]()]) {
    const state = initialize(snapshot);
    assert.equal(state.root.dataset.logReload, 'pending');
    stop(state);
    assert.equal(state.root.dataset.logReload, undefined);
    assert.equal(state.history.scrollRestoration, 'auto');
    assert.equal(state.window.__studyLogReload.active, false);
    assert.equal(state.listeners.size, 0);
  }
});

test('the mounted workspace can retain manual history ownership after the prepaint guard finishes', () => {
  const state = initialize(snapshot);
  const previous = state.window.__studyLogReload.scrollRestoration;
  assert.equal(previous, 'auto');
  state.window.__studyLogReload.scrollRestoration = 'manual';
  state.window.__studyLogReload.finish();
  assert.equal(state.history.scrollRestoration, 'manual');
  assert.equal(state.root.dataset.logReload, undefined);
});

test('invalid mode, nonfinite size and nonfinite inner scroll never reserve a reload', () => {
  for (const value of [{ ...snapshot, mode: 'other' }, { ...snapshot, height: null },
    { ...snapshot, position: { ...snapshot.position, editorTop: null } }]) {
    const state = initialize(value);
    assert.equal(state.root.dataset.logReload, undefined);
    assert.equal(state.window.__studyLogReload, undefined);
  }
});
test('normal navigation, other URLs, corrupt positions and top-of-page do not cover the app', () => {
  for (const [value, type] of [[snapshot, 'navigate'], [{ ...snapshot, url: 'https://other.test' }, 'reload'], [{ ...snapshot, position: { windowTop: -1 } }, 'reload'], [{ ...snapshot, position: { windowTop: 0, previewTop: 0, editorTop: 0 } }, 'reload'], [null, 'reload']]) {
    const state = initialize(value, type);
    assert.equal(state.root.dataset.logReload, undefined);
    assert.equal(state.history.scrollRestoration, 'auto');
  }
});

test('navigation metadata is validated and also preserves a reload at the document top', () => {
  const context = { months: [{ id: '2024-04', label: '2024-04', dayCount: 1, firstDate: '2024-04-03', lastDate: '2024-04-03' }],
    days: [{ date: '2024-04-03', month: '2024-04', fileName: '2024-04.md', headings: ['合成标题'], preview: '' }],
    fileName: '2024-04.md', outline: [{ id: 'heading', text: '合成标题', level: 3, line: 1 }], activeHeadingId: 'heading' };
  assert.deepEqual(readLogReloadContext(context), context);
  assert.equal(readLogReloadContext({ ...context, days: [{ headings: [null] }] }), null);
  assert.equal(readLogReloadContext({ ...context, outline: [null] }), null);
  assert.equal(readLogReloadContext(null), null);
  const state = initialize({ ...snapshot, context, position: { windowTop: 0, previewTop: 0, editorTop: 0 } });
  assert.equal(state.root.dataset.logReload, 'pending');
});
