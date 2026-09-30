import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const controller = (await readFile(new URL('../entry/src/main/ets/app/WorkspaceSearchController.ets', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('@Observed', '');
const methods = ['changeSearch', 'closeSearch', 'showSearchHistory', 'updateSearchHistory', 'selectSearchHistory', 'searchLogs', 'handleSearchKey'].map(name => {
  const start = source.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start + 1), end = rest.search(/^  (?:private |@Builder|build\()/m);
  return source.slice(start, start + 1 + end);
}).join('\n');
function workspace() {
  const module = { exports: {} }, pending = [], selected = [], scrolled = [];
  const KeyCode = { KEYCODE_ESCAPE: 2070, KEYCODE_ENTER: 2054, KEYCODE_DPAD_UP: 2012, KEYCODE_DPAD_DOWN: 2013 };
  runInNewContext(ts.transpileModule(`${controller}\nexport class Workspace { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, KeyCode, SearchHistoryStore: class { async load() { return []; } save() {} }, ScrollAlign: { AUTO: 0 },
    workspaceKey: (event, code) => event.type === 0 && event.keyCode === code });
  const page = new module.exports.Workspace();
  Object.assign(page, { searchOpen: true, calendarOpen: false,
    searchResultScroller: { scrollToIndex: index => scrolled.push(index) },
    selectSearchResult: result => selected.push(result) });
  page.search = new module.exports.WorkspaceSearchController({
    search: (...args) => new Promise(resolve => pending.push({ resolve, args }))
  }, { active: () => true, lifecycle: () => 1, open: () => page.searchOpen,
    remember: () => true, reveal: () => page.searchOpen = true, context: () => ({}), namespace: () => 'synthetic' });
  return { page, pending, selected, scrolled, key: code => page.handleSearchKey({ type: 0, keyCode: code }) };
}
test('search arrows wrap and Enter selects the actual candidate without issuing another request', () => {
  const { page, key, selected, pending, scrolled } = workspace();
  page.search.searchQuery = 'term'; page.search.searchSubmitted = true;
  page.search.searchResults = [{ date: '2026-01-15' }, { date: '2026-02-05' }];
  assert.equal(key(2012), true); assert.equal(page.search.searchActiveIndex, 1);
  key(2013); assert.equal(page.search.searchActiveIndex, 0);
  key(2054); assert.equal(selected[0].date, '2026-01-15');
  assert.equal(pending.length, 0); assert.deepEqual(scrolled, [1, 0]);
});
test('history input echo preserves an active request, while changed filters invalidate its response', async () => {
  const { page, pending } = workspace();
  page.changeSearch('term'); const first = page.searchLogs();
  const revision = page.search.searchRequestRevision; page.changeSearch('term');
  assert.equal(page.search.searchRequestRevision, revision); assert.equal(page.search.searchLoading, true);
  page.search.searchHeadingsOnly = true; page.changeSearch(page.search.searchQuery, true);
  const second = page.searchLogs();
  pending[0].resolve({ results: [{ date: 'old' }] }); await first;
  assert.equal(page.search.searchResults.length, 0); assert.equal(page.search.searchLoading, true);
  pending[1].resolve({ results: [{ date: 'new' }] }); await second;
  assert.equal(page.search.searchResults[0].date, 'new'); assert.equal(pending[1].args[1], true);
});
test('closing search invalidates late results and clears keyboard selection', async () => {
  const { page, pending, key } = workspace();
  page.changeSearch('term'); const request = page.searchLogs(); page.search.searchActiveIndex = 1;
  assert.equal(key(2070), true); assert.equal(page.search.searchActiveIndex, -1);
  pending[0].resolve({ results: [{ date: 'late' }] }); await request;
  assert.equal(page.searchOpen, false); assert.equal(page.search.searchResults.length, 0);
});
test('history keyboard selection submits the selected query and removing history resets its index', async () => {
  const { page, pending, key } = workspace();
  page.search.searchHistory = ['first', 'second']; key(2012); key(2054);
  assert.equal(pending[0].args[0], 'second'); assert.equal(page.search.searchActiveIndex, -1);
  page.search.searchActiveIndex = 1; page.updateSearchHistory([]); assert.equal(page.search.searchActiveIndex, -1);
  pending[0].resolve({ results: [] });
});

test('Enter reopens results when the focused search was previously dismissed', async () => {
  const { page, key, pending } = workspace(); page.search.searchQuery = 'term'; page.searchOpen = false;
  key(2054); assert.equal(page.searchOpen, true); assert.equal(pending.length, 1);
  pending[0].resolve({ results: [] });
});

test('late history restoration cannot replace history changed during startup', async () => {
  const { page } = workspace(); let release;
  page.search.historyStore = { load: () => new Promise(resolve => { release = resolve; }), save() {} };
  const loading = page.search.restoreSearchHistory(); page.updateSearchHistory(['current']);
  release(['old']); await loading; assert.deepEqual(page.search.searchHistory, ['current']);
});
test('disposed workspace ignores pending history restoration', async () => {
  const { page } = workspace(); let release;
  page.search.historyStore = { load: () => new Promise(resolve => { release = resolve; }), save() {} };
  const loading = page.search.restoreSearchHistory(); page.search.dispose();
  release(['old']); await loading; assert.equal(page.search.searchHistory.length, 0);
});
