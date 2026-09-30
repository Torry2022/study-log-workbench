import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = (await readFile(new URL('../entry/src/main/ets/features/logs/LogNavigationController.ets', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('@Observed', '');
const pageSource = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const start = pageSource.indexOf('  private bindNavigation('), end = pageSource.indexOf('\n  }', start) + 4;
const module = { exports: {} };
runInNewContext(ts.transpileModule(source + `\nexport class Page { ${pageSource.slice(start, end)} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module, exports: module.exports, Error, activeInstance: { namespace: 'synthetic' }, appFeedback: { dismissScope() {} } });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function subject(reads = {}) {
  const page = new module.exports.Page(), opened = [], notices = [];
  const nav = new module.exports.LogNavigationController();
  Object.assign(page, { logNavigation: nav, reads, modules: { pendingLogDate: '' }, lifecycle: 1, errorMessage: '', readFailed: false,
    documents: { dayLoadRevision: 0 }, coverLogDocument: async () => {},
    session: { day: { date: '2026-02-05' }, clearDocument() { this.day = undefined; } },
    readerReady: true, renderedPreviewDate: '2026-02-05', workspaceTransition: { finish() {} },
    logNavigationFailed() {}, message: error => error.message, showReadFailure: () => notices.push(page.errorMessage),
    loadDay: async date => { opened.push(date); page.session.day = { date }; page.errorMessage = ''; } });
  nav.month = '2026-02'; nav.days = [{ date: '2026-02-05' }]; nav.monthsLoading = false;
  page.bindNavigation(); return { page, nav, opened, notices };
}
test('month initialization restores only the matching instance draft date through the real view binding', async () => {
  const { page, nav, opened } = subject({ months: async () => ({ months: [{ id:'2026-02' }] }), days: async () => ({ days: [{ date:'2026-01-15' }] }) });
  page.initialDraft = { namespace:'synthetic', date:'2026-01-15' }; await nav.loadMonths();
  assert.equal(nav.month,'2026-01'); assert.deepEqual(opened,['2026-01-15']); assert.equal(nav.monthsLoading,false);
});
test('failed cross-month list keeps previous selection and its retry targets the original requested day', async () => {
  let fail=true; const { page, nav, opened, notices } = subject({ days: async () => { if(fail)throw new Error('offline'); return { days:[{date:'2026-01-15'}] }; } });
  const previous=nav.days; await nav.loadDays('2026-01','2026-01-15');
  assert.equal(nav.month,'2026-02'); assert.equal(nav.days,previous); assert.deepEqual(notices,['offline']); assert.equal(nav.daysLoading,false);
  fail=false; await page.retryRead(); assert.equal(nav.month,'2026-01'); assert.deepEqual(opened,['2026-01-15']);
});
test('day-read failure after a successful list rolls back both month and dates and retries the full target', async () => {
  const { page, nav } = subject({ days: async () => ({days:[{date:'2026-01-15'}]}) }); const previous=nav.days;
  page.loadDay=async () => { page.errorMessage='day offline'; }; await nav.loadDays('2026-01','2026-01-15');
  assert.equal(nav.month,'2026-02'); assert.equal(nav.days,previous);
  page.loadDay=async date => {page.errorMessage='';page.session.day={date};}; await page.retryRead();
  assert.equal(nav.month,'2026-01'); assert.equal(page.session.day.date,'2026-01-15');
});
test('late date list cannot replace a newer selection or open its day', async () => {
  const a=deferred(), b=deferred(); const { nav, opened }=subject({days: month => month==='2026-01'?a.promise:b.promise});
  const first=nav.loadDays('2026-01'); await Promise.resolve(); const second=nav.loadDays('2026-02'); await Promise.resolve();
  b.resolve({days:[{date:'2026-02-05'}]}); await second; a.resolve({days:[{date:'2026-01-15'}]}); await first;
  assert.equal(nav.month,'2026-02'); assert.deepEqual(opened,['2026-02-05']); assert.equal(nav.daysLoading,false);
});
test('superseded snapshot preparation does not start an obsolete list request', async () => {
  const cover=deferred(), calls=[]; const { page, nav }=subject({days:async month => {calls.push(month);return {days:[]};}});
  page.coverLogDocument=()=>cover.promise; const first=nav.loadDays('2026-01');
  page.coverLogDocument=async()=>{}; await nav.loadDays('2026-02'); cover.resolve(); await first;
  assert.deepEqual(calls,['2026-02']); assert.equal(nav.month,'2026-02');
});
test('disposed navigation ignores pending month and calendar results', async () => {
  const months=deferred(), days=deferred(); const { nav, opened }=subject({months:()=>months.promise,days:()=>days.promise});
  const a=nav.loadMonths(); nav.calendarMonth='2026-01'; const b=nav.loadCalendar(); nav.dispose();
  months.resolve({months:[{id:'2026-01'}]});days.resolve({days:[{date:'2026-01-15'}]});await Promise.all([a,b]);
  assert.equal(nav.months.length,0);assert.equal(nav.calendarDates.length,0);assert.equal(opened.length,0);assert.equal(nav.calendarLoading,false);
});
test('calendar month races preserve only the latest month dates', async () => {
  const a=deferred(),b=deferred();const {nav}=subject({days:month=>month==='2026-01'?a.promise:b.promise});
  nav.calendarMonth='2026-01';const first=nav.loadCalendar();nav.calendarMonth='2026-02';const second=nav.loadCalendar();
  b.resolve({days:[{date:'2026-02-05'}]});await second;a.resolve({days:[{date:'2026-01-15'}]});await first;
  assert.equal(nav.calendarDates[0],'2026-02-05');assert.equal(nav.calendarLoading,false);
});

test('a late month refresh cannot override a date list selected after it started', async () => {
  const refresh=deferred();const {nav,opened}=subject({months:()=>refresh.promise,days:async month=>({days:[{date:month+'-15'}]})});
  const old=nav.loadMonths();await nav.loadDays('2026-01');refresh.resolve({months:[{id:'2026-02'}]});await old;
  assert.equal(nav.month,'2026-01');assert.deepEqual(opened,['2026-01-15']);assert.equal(nav.monthsLoading,false);
});
