import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const ts = createRequire(new URL('../../study-log-web/package.json', import.meta.url))('typescript');
const base = new URL('../entry/src/main/ets/', import.meta.url);
const personal = false;
const read = async path => (await readFile(new URL(path + '.ets', base), 'utf8')).replace(/\r\n/g, '\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
function method(source, name) {
  const start = source.search(new RegExp('^  private (?:async )?' + name + '\\(', 'm'));
  assert.ok(start >= 0, name);
  const length = source.slice(start + 1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
  assert.ok(length >= 0, name + ' end'); return source.slice(start, start + 1 + length);
}
function compile(source, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Observed: value => value, require: () => ({}), ...globals });
  return module.exports;
}
async function fixture(from = 'source', wide = true, options = {}) {
  const frames = [], fades = [], timers = new Map(); let nextTimer = 0, captures = 0, releases = 0;
  const pixel = { release: () => { releases++; } };
  const { WorkspaceTransitionCoordinator } = compile(await read('app/WorkspaceTransitionCoordinator'), {
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id)
  });
  const transition = new WorkspaceTransitionCoordinator({
    tab: () => 0, canCapture: () => wide,
    capture: () => { captures++; return options.capture ? options.capture.promise : Promise.resolve(pixel); },
    fade: (update, finish) => { fades.push('fade'); update(); finish(); }
  });
  const pageSource = await read(personal ? 'features/logs/LogsPage' : 'features/logs/LogsReaderPage');
  const names = personal ? ['setDisplayMode', 'settleModeOnNextFrame', 'flushEditor'] : ['switchMode', 'settleModeOnNextFrame'];
  const { Page } = compile('export class Page { ' + names.map(name => method(pageSource, name)).join('\n') + ' }', {
    FrameAction: class { constructor(fn) { this.fn = fn; } }
  });
  const page = new Page(), day = { date: '2026-08-01' };
  const session = { day, selectedDate: day.date, text: '原合成正文', editorDocumentKey: 'editor:1', editorPending: false };
  const rootSource = await read('pages/Index');
  const { Root } = personal ? compile('export class Root { ' +
    ['beginLogModeTransition', 'logReaderSettled'].map(name => method(rootSource, name)).join('\n') + ' }',
    { WorkspaceTab: { LOGS: 0 } }) : { Root: class {} };
  const root = Object.assign(new Root(), { selectedTab: 0, isLargeWorkspace: () => wide, workspaceTransition: transition,
    readingTransition: { animating: false }, coverWorkspaceTransition: kind => transition.cover(kind),
    finishWorkspaceTransition: kind => transition.finish(kind) });
  Object.assign(page, {
    sourceMode: from === 'source', splitMode: from === 'split', modeRequestRevision: 0, modeLayoutRevision: 0,
    editorLifecycleRevision: 0, continuation: { continuationBusy: false }, logSession: session, session,
    documents: { loading: false, dayRequestLoading: false }, logNavigation: { daysLoading: false },
    editorReady: true, editor: { ready: true, loadedDocumentKey: day.date,
      command: async command => command === 'snapshot' ? options.snapshot ? options.snapshot() :
        { documentKey: personal ? 'editor:1' : day.date, text: session.text } : {} },
    workspaceTransition: transition, isWide: () => wide, isLargeWorkspace: () => wide, selectedTab: () => 0,
    onBeforeModeChange: () => root.beginLogModeTransition(), onReaderSettled: kind => root.logReaderSettled(kind),
    getUIContext: () => ({ postFrameCallback: action => frames.push(action.fn) }),
    updateToolbarWidth() {}, onDirtyChange() {}, isDirty: () => false, reportDraft() {},
    message: (error, fallback) => error.message || fallback, previewText: session.text, headerWidth: 1000, desktopToolbarWidth: 1000
  });
  return { page, transition, pixel, session, frames, fades, timers, captures: () => captures, releases: () => releases,
    invoke: mode => personal ? page.setDisplayMode(mode) : page.switchMode(mode === 'source', mode === 'split'),
    frame: () => frames.splice(0).forEach(fn => fn()),
    viewportReady: () => personal ? root.logReaderSettled('viewport') : transition.finish('mode'),
    async covered() { await tick(); if (transition.snapshot) transition.rendered(); await tick(); }
  };
}

test('all six mode directions keep the wide snapshot until ready and leave narrow changes uncaptured', async () => {
  for (const wide of [true, false]) for (const from of ['preview', 'source', 'split']) for (const to of ['preview', 'source', 'split']) {
    if (from === to) continue;
    const f = await fixture(from, wide), pending = f.invoke(to);
    await f.covered(); await pending;
    assert.equal(f.page.sourceMode, to === 'source'); assert.equal(f.page.splitMode, to === 'split');
    if (wide) { assert.equal(f.fades.length, 0, from + '->' + to + ': no fade before matching readiness'); assert.ok(f.transition.snapshot); }
    f.frame(); f.viewportReady();
    assert.equal(f.captures(), wide ? 1 : 0); assert.equal(f.fades.length, wide ? 1 : 0);
    assert.equal(f.transition.snapshot, undefined); assert.equal(f.transition.waitingKind, '');
  }
});

test('reselecting the unchanged mode cancels pending capture and releases its late snapshot', async () => {
  const capture = deferred(), f = await fixture('source', true, { capture });
  const pending = f.invoke('preview'); await tick(); assert.ok(f.transition.task);
  try {
    await f.invoke('source'); f.frame(); await tick();
    assert.equal(f.transition.task, undefined, 'cancelled mode capture must not hold a cover task');
    capture.resolve(f.pixel); await pending; await tick();
    assert.equal(f.transition.snapshot, undefined); assert.equal(f.releases(), 1);
    assert.equal(f.page.sourceMode, true); assert.equal(f.page.splitMode, false);
  } finally { f.transition.clear(); capture.resolve(f.pixel); await pending; }
});

test('a superseded mode snapshot cannot replace the text published by the newer mode', async () => {
  const old = deferred(); let count = 0;
  const f = await fixture('source', true, { snapshot: () => ++count === 1 ? old.promise :
    Promise.resolve({ documentKey: personal ? 'editor:1' : '2026-08-01', text: '新合成正文' }) });
  const first = f.invoke('preview'); await tick();
  const second = f.invoke('split'); await f.covered(); await second;
  f.frame(); f.viewportReady(); assert.equal(f.session.text, '新合成正文');
  old.resolve({ documentKey: personal ? 'editor:1' : '2026-08-01', text: '旧合成正文' }); await first;
  assert.equal(f.session.text, '新合成正文');
  assert.equal(f.page.splitMode, true);
});

test('a superseded snapshot failure cannot flash an error over the newer mode', async () => {
  const old = deferred(); let count = 0;
  const f = await fixture('source', true, { snapshot: () => ++count === 1 ? old.promise :
    Promise.resolve({ documentKey: personal ? 'editor:1' : '2026-08-01', text: '新合成正文' }) });
  const first = f.invoke('preview'); await tick();
  const second = f.invoke('split'); await f.covered(); await second; f.frame(); f.viewportReady();
  old.reject(Error('obsolete snapshot failure')); await first;
  assert.equal(f.session.text, '新合成正文'); assert.equal(f.page.splitMode, true);
  assert.equal(f.page.saveError, undefined); assert.equal(f.page.documents.errorMessage, undefined);
});
