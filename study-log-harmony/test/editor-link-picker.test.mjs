import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const core = new URL('../entry/src/main/ets/', import.meta.url);
const source = await readFile(new URL('common/editor/EditorLinkPicker.ets', core), 'utf8');
const start = source.indexOf('  aboutToAppear()');
const end = source.indexOf('  @Builder', start);
assert.ok(start >= 0 && end > start, 'picker method boundaries missing');
const methods = ts.transpileModule(`class Host { ${source.slice(start, end)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const cancellationSource = await readFile(new URL('common/network/ReadCancellation.ets', core), 'utf8');
const cancellationCode = ts.transpileModule(cancellationSource.replace('export class', 'class'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const ReadCancellation = new Function(`${cancellationCode}; return ReadCancellation;`)();
const linksSource = await readFile(new URL('common/editor/EditorLinks.ets', core), 'utf8');
const linksCode = ts.transpileModule(linksSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022 } }).outputText;
const linksModule = { exports: {} };
new Function('module', 'exports', `${linksCode}`)(linksModule, linksModule.exports);

const candidate = (number, headingId = `section-${number}`) => ({ kind: 'heading', date: '2026-10-15',
  heading: `合成 ${number}`, headingId, preview: '' });

function setup() {
  const timers = new Map(), pending = [];
  let sequence = 0;
  const api = { get(path, read) { return new Promise((resolve, reject) => pending.push({ path, read, resolve, reject })); } };
  const Host = new Function('apiClient', 'ReadCancellation', 'setTimeout', 'clearTimeout', 'focusControl',
    'editorLinkMarkup', 'editorLinkSearchPath', 'KeyType', `${methods}; return Host;`)(api, ReadCancellation,
    callback => { timers.set(++sequence, callback); return sequence; }, id => timers.delete(id),
    { requestFocus() {} }, linksModule.exports.editorLinkMarkup, linksModule.exports.editorLinkSearchPath, { Down: 0 });
  const host = Object.assign(new Host(), { query: '', alias: '', initialAlias: '', results: [], loading: false,
    loadingMore: false, inserting: false, error: '', moreError: '', hasMore: false, headingsOnly: false,
    caseSensitive: false, date: '', resultsKey: '', nextOffset: 0, revision: 0, lifecycleRevision: 0,
    timer: -1, focusTimer: -1, activeIndex: -1, scroller: { scrollToIndex() {} }, onInsert: async () => {} });
  return { host, pending, run() {
    const callbacks = [...timers.values()]; timers.clear(); return Promise.all(callbacks.map(callback => callback()));
  } };
}

async function first(harness, rows = Array.from({ length: 40 }, (_, index) => candidate(index)), hasMore = true) {
  harness.host.search(true);
  const work = harness.run();
  harness.pending.at(-1).resolve({ results: rows, hasMore });
  await work;
}

test('actual picker method sends public filters and cancels initial and paging reads when conditions change', async () => {
  const harness = setup();
  harness.host.query = 'Agent 路由'; harness.host.date = '2026-10-16';
  harness.host.headingsOnly = true; harness.host.caseSensitive = true;
  harness.host.search(true);
  const initial = harness.run();
  const old = harness.pending.at(-1);
  assert.equal(old.path, '/links?query=Agent%20%E8%B7%AF%E7%94%B1&limit=40&offset=0&ignoreCase=false&scope=heading&date=2026-10-16');
  harness.host.query = '新条件'; harness.host.search(true);
  assert.equal(old.read.cancelled, true);
  const replacement = harness.run();
  old.resolve({ results: [candidate(99)], hasMore: false }); await initial;
  const fresh = harness.pending.at(-1);
  fresh.resolve({ results: Array.from({ length: 40 }, (_, index) => candidate(index)), hasMore: true });
  await replacement;
  const page = harness.host.loadMore(); const pageRead = harness.pending.at(-1);
  harness.host.caseSensitive = false; harness.host.search(true);
  assert.equal(pageRead.read.cancelled, true);
  const latest = harness.run();
  pageRead.resolve({ results: [candidate(40)], hasMore: false }); await page;
  harness.pending.at(-1).resolve({ results: [candidate(8)], hasMore: false }); await latest;
  assert.deepEqual(harness.host.results, [candidate(8)]);
});

test('paging failure waits for explicit retry, keeps the raw offset and preserves distinct heading ids', async () => {
  const harness = setup(); await first(harness);
  const failed = harness.host.loadMore();
  assert.match(harness.pending[1].path, /offset=40/);
  harness.pending[1].reject(new Error('合成分页失败')); await failed;
  assert.equal(harness.host.moreError, '合成分页失败');
  await harness.host.loadMore();
  assert.equal(harness.pending.length, 2, 'onReachEnd must not automatically retry a failed page');
  const retry = harness.host.loadMore(true);
  assert.match(harness.pending[2].path, /offset=40/);
  harness.pending[2].resolve({ results: [candidate(39), candidate(40, 'same-title-a'),
    candidate(40, 'same-title-b')], hasMore: true });
  await retry;
  assert.equal(harness.host.results.length, 42);
  assert.equal(harness.host.nextOffset, 43);
  const next = harness.host.loadMore();
  assert.match(harness.pending[3].path, /offset=43/);
  harness.pending[3].resolve({ results: [], hasMore: true }); await next;
  assert.equal(harness.host.hasMore, false);
});

test('closing cancels owned reads and a closed date picker callback cannot search or change state', async () => {
  const harness = setup(); await first(harness);
  const page = harness.host.loadMore(); const pageRead = harness.pending.at(-1);
  const dialogs = [];
  harness.host.getUIContext = () => ({ showDatePickerDialog: options => dialogs.push(options) });
  harness.host.chooseDate();
  harness.host.aboutToDisappear();
  assert.equal(pageRead.read.cancelled, true);
  const requestCount = harness.pending.length;
  dialogs[0].onDateAccept(new Date(2026, 9, 16));
  assert.equal(harness.host.date, '');
  await harness.run();
  assert.equal(harness.pending.length, requestCount);
  pageRead.resolve({ results: [candidate(41)], hasMore: false }); await page;
  assert.equal(harness.host.results.length, 40);
});

test('picker UI routes automatic and explicit pagination separately without duplicating an empty footer', () => {
  assert.match(source, /onReachEnd\(\(\) => this\.loadMore\(\)\)/);
  assert.match(source, /onClick\(\(\) => this\.loadMore\(true\)\)/);
  assert.match(source, /if \(this\.results\.length > 0 && \(this\.breakpoint !== WorkspaceBreakpoint\.COMPACT \|\| this\.loadingMore \|\| this\.moreError\)\)/);
  assert.match(source, /showDateToggle: true/);
  assert.match(source, /!this\.query\.trim\(\) && !this\.date \? '最近的日志与小节'/);
  assert.match(source, /Column\(\{ space: 8 \}\) \{\s*this\.searchInput\(\)\s*this\.dateFilter\(\)/);
  const searchSection = source.slice(source.indexOf('  build()'), source.indexOf(".id('editor_link_results')"));
  assert.match(searchSection, /if \(this\.breakpoint === WorkspaceBreakpoint\.COMPACT\) \{ this\.resultFooter\(\) \}/);
  assert.match(source, /if \(this\.breakpoint !== WorkspaceBreakpoint\.COMPACT\) \{ this\.resultFooter\(\) \}/);
});
