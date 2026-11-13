import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../../study-log-web/package.json', import.meta.url))('typescript');
const base = new URL('../entry/src/main/ets/', import.meta.url);
const read = async file => (await readFile(new URL(file + '.ets', base), 'utf8')).replace(/\r\n/g, '\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
function compile(source, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Observed: value => value, require: () => ({ ApiError: Error }), ...globals });
  return module.exports;
}
async function fixture() {
  const pageSource = await read('features/stats/StatsPage');
  const begin = pageSource.indexOf('  aboutToAppear()'), end = pageSource.indexOf('  private handlePageScroll(', begin);
  assert.ok(begin >= 0 && end > begin);
  const labelStart = pageSource.indexOf('  private selectedMonthIndex('), labelEnd = pageSource.indexOf('  private activeDomainCount(', labelStart);
  assert.ok(labelStart >= 0 && labelEnd > labelStart);
  const notices = [], requests = [], transitions = [];
  const { Page } = compile(`export class Page { ${pageSource.slice(begin, end)} ${pageSource.slice(labelStart, labelEnd)} }`, { appFeedback: { show: (...args) => notices.push(args) } });
  const motion = await read('common/ui/WorkspaceMotion'), gateStart = motion.indexOf('export class ResultChangeGate');
  assert.ok(gateStart >= 0);
  const { ResultChangeGate } = compile(motion.slice(gateStart));
  const { StatsController } = compile(await read('features/stats/StatsController'));
  const page = new Page(), shell = { statsMonth: '2026-01', statsMonthRevision: 0, closeNavigation() {} };
  let select;
  if (pageSource.includes('visitRevisionChanged')) {
    shell.modules = { statsMonth: '2026-01', statsMonthRevision: 0 }; shell.onCloseNavigation = () => {};
    const nav = await read('app/components/WorkspaceModuleNavigation');
    const body = nav.match(/onMonth: \(month: string\) => \{([\s\S]*?)\}/);
    assert.ok(body); select = compile(`export class Shell { select(month: string) { ${body[1]} } }`).Shell.prototype.select;
  } else {
    const index = await read('pages/Index'), start = index.indexOf('  private selectStatsMonth('), stop = index.indexOf('  private openStatsTaxonomy(', start);
    assert.ok(start >= 0 && stop > start);
    select = compile(`export class Shell { ${index.slice(start, stop)} }`).Shell.prototype.selectStatsMonth;
  }
  Object.assign(page, { requestedMonth: '2026-01', requestedMonthRevision: 0, visitRevision: 0,
    drilldownKind: '', drilldownValue: '', calendarDetailsOpen: false, calendarPopoverDate: '',
    scrollOffset: 0, scrollProgress: 0, topToolsHeight: 0, resultChanges: new ResultChangeGate(),
    resultSurface: { clear() {}, replace(_context, _id, update, current) { transitions.push({ update, current }); } },
    pageScroller: { scrollTo() {} }, getUIContext: () => ({}), onScrollStateChange() {} });
  page.data = new StatsController({ get(path) { const d = deferred(); requests.push({ path, ...d }); return d.promise; } }, {
    requestedMonth: () => page.requestedMonth, monthsChanged() {}, monthsLoading() {}, monthsError() {}, selectedMonthChanged() {},
    prepareResult: () => { page.resultChanges.reset(page.data.stats ? JSON.stringify(page.data.stats) : ''); page.resultSurface.clear(); },
    publishResult: (stats, commit, current) => page.publishStats(stats, commit, current)
  });
  const choose = month => {
    select.call(shell, month); const state = shell.modules || shell;
    page.requestedMonth = state.statsMonth; page.requestedMonthRevision = state.statsMonthRevision; page.requestedMonthChanged();
  };
  const finish = () => { for (const transition of transitions.splice(0)) if (transition.current()) transition.update(); };
  return { page, requests, notices, transitions, choose, finish };
}

test('actual sidebar and StatsPage watchers preserve the latest month and retry the failed target', async () => {
  const f = await fixture(), p = f.page;
  p.aboutToAppear(); assert.equal(f.requests[0].path, '/logs/months');
  f.requests[0].resolve({ months: [{ id: '2026-01' }, { id: '2026-02' }, { id: '2026-03' }] }); await tick();
  const january = f.requests.at(-1); assert.match(january.path, /2026-01/);
  f.choose('2026-02'); const february = f.requests.at(-1); assert.match(february.path, /2026-02/);
  const count = f.requests.length; f.choose('2026-02'); assert.equal(f.requests.length, count, 'same pending month does not duplicate reads');
  january.resolve({ month: '2026-01' }); await tick(); assert.equal(p.data.loading, true);
  february.resolve({ month: '2026-02' }); await tick(); f.finish();
  assert.equal(p.data.stats.month, '2026-02'); assert.equal(p.data.selectedMonth, '2026-02');
  f.choose('2026-03'); f.requests.at(-1).reject(Error('isolated month failure')); await tick();
  assert.equal(p.data.stats.month, '2026-02'); assert.match(p.data.errorMessage, /isolated month failure/);
  p.refreshRevisionChanged(); const retry = f.requests.at(-1); assert.match(retry.path, /2026-03/);
  retry.resolve({ month: '2026-03' }); await tick(); f.finish();
  assert.equal(p.data.stats.month, '2026-03'); assert.equal(p.data.errorMessage, '');
  assert.deepEqual(f.notices.at(-1), ['统计数据已刷新', 'success']);
  f.choose('2026-02'); f.requests.at(-1).resolve({ month: '2026-02' }); await tick();
  const late = f.transitions.at(-1); assert.ok(late);
  p.aboutToDisappear(); assert.equal(late.current(), false, 'leaving cancels queued result presentation as well as requests');
  f.finish(); assert.equal(p.data.stats.month, '2026-03');
});

test('failed month selection keeps the displayed label and day count while retry retains its target', async () => {
  const f = await fixture(), p = f.page;
  p.aboutToAppear(); f.requests[0].resolve({ months: [
    { id: '2026-01', label: '2026-01', dayCount: 2 }, { id: '2026-02', label: '2026-02', dayCount: 1 }
  ] }); await tick();
  f.requests.at(-1).resolve({ month: '2026-01', stats: { dayCount: 2, topicCount: 4 } }); await tick(); f.finish();
  assert.equal(p.selectedMonthValue(), '2026-01 · 2 天');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0) f.choose('2026-02'); else p.refreshRevisionChanged();
    assert.match(f.requests.at(-1).path, /2026-02/);
    assert.equal(p.selectedMonthValue(), '2026-02 · 1 天', 'pending selection keeps its existing loading presentation');
    f.requests.at(-1).reject(Error('synthetic 503')); await tick();
    assert.equal(p.selectedMonthValue(), '2026-01 · 2 天', 'failed target must not label the retained old result');
    assert.equal(p.selectedMonthIndex(), 0);
    assert.equal(p.data.stats.month, '2026-01'); assert.equal(p.data.stats.stats.dayCount, 2); assert.equal(p.data.stats.stats.topicCount, 4);
    assert.equal(p.data.refreshMonth(), '2026-02');
  }
  p.refreshRevisionChanged(); assert.match(f.requests.at(-1).path, /2026-02/);
  f.requests.at(-1).resolve({ month: '2026-02', stats: { dayCount: 1, topicCount: 1 } }); await tick(); f.finish();
  assert.equal(p.selectedMonthValue(), '2026-02 · 1 天'); assert.equal(p.selectedMonthIndex(), 1);
  assert.equal(p.data.stats.month, '2026-02'); assert.equal(p.data.stats.stats.dayCount, 1);
  p.aboutToDisappear();
});

test('page disposal and actual revisit entry reject old reads without clearing newer loading state', async () => {
  const f = await fixture(), p = f.page;
  p.aboutToAppear(); const old = f.requests.at(-1); p.aboutToDisappear();
  p.aboutToAppear(); const current = f.requests.at(-1);
  old.resolve({ months: [{ id: '2025-01' }] }); await tick(); assert.equal(p.data.loading, true); assert.equal(p.data.months.length, 0);
  current.resolve({ months: [{ id: '2026-01' }] }); await tick();
  f.requests.at(-1).resolve({ month: '2026-01' }); await tick(); f.finish();
  assert.equal(p.data.stats.month, '2026-01');
  if (typeof p.visitRevisionChanged === 'function') {
    const before = f.requests.length; p.visitRevisionChanged(); assert.equal(f.requests.length, before);
    p.visitRevision = 1; p.visitRevisionChanged(); assert.equal(f.requests.at(-1).path, '/logs/months');
    f.choose('2026-02'); const latest = f.requests.at(-1);
    f.requests.at(-2).resolve({ months: [{ id: '2026-01' }] }); await tick();
    assert.equal(p.data.pendingMonth, '2026-02'); assert.equal(p.data.loading, true);
    latest.resolve({ month: '2026-02' }); await tick(); f.finish();
    assert.equal(p.data.stats.month, '2026-02');
  }
  p.aboutToDisappear();
});
