import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const root = new URL('../entry/src/main/ets/features/logs/', import.meta.url);
const pageSource = await readFile(new URL('LogsReaderPage.ets', root), 'utf8');
const methods = ['acceptDeletedDay', 'bindNavigation', 'loadMonths'].map(name => {
  const start = pageSource.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  const end = pageSource.slice(start + 1).search(/^  (?:private |@Builder|build\()/m);
  assert.ok(start >= 0 && end >= 0);
  return pageSource.slice(start, start + end + 1);
}).join('\n');
const sources = await Promise.all(['LogNavigationController.ets', 'LogSession.ets'].map(async name =>
  (await readFile(new URL(name, root), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('@Observed', '')));
function setup(months, days, fails = false) {
  const module = { exports: {} }, notices = [], opened = [];
  runInNewContext(ts.transpileModule(sources.join('\n') + `\nexport class Page {${methods}}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, activeInstance: {namespace:'test'},
    appFeedback: {dismissScope(){}, show: message => notices.push(message)} });
  const page = new module.exports.Page(), session = new module.exports.LogSession();
  const nav = new module.exports.LogNavigationController();
  session.commitDocument({date:'2026-02-05', exists:true, version:'v1'}, 'body');
  Object.assign(page, { session, logNavigation:nav, lifecycle:1, documents:{dayLoadRevision:1},
    initialDraft:{namespace:'test', date:'2026-02-05'}, restoredDraftApplied:false,
    editor:{ready:false}, bodyFromDay:()=>'', reportDraft(){}, coverLogDocument:async()=>{},
    workspaceTransition:{finish(){}}, modules:{pendingLogDate:''}, logNavigationFailed(){},
    message:e=>e.message, showReadFailure(){},
    reads:{invalidate(){}, months:async()=>{if(fails)throw Error('offline');return {months};}, days:async()=>({days})},
    loadDay:async date=>{opened.push(date);session.commitDocument({date,exists:true,version:'v2'},'remaining');} });
  nav.month='2026-02';nav.days=[{date:'2026-02-05'}];page.bindNavigation();
  return {page,session,nav,opened,notices};
}
const deleted={date:'2026-02-05',exists:false,version:null,content:''};
test('delete clears the last log and does not reopen the restored draft date',async()=>{
  const s=setup([],[]);await s.page.acceptDeletedDay(deleted,deleted.date);
  assert.equal(s.session.day,undefined);assert.equal(s.session.isDirty(),false);
  assert.equal(s.nav.month,'');assert.equal(s.nav.days.length,0);assert.deepEqual(s.opened,[]);
});
test('delete selects a remaining day in the same or another month',async()=>{
  for(const date of ['2026-02-01','2026-01-15']){
    const s=setup([{id:date.slice(0,7)}],[{date}]);await s.page.acceptDeletedDay(deleted,deleted.date);
    assert.deepEqual(s.opened,[date]);assert.equal(s.session.selectedDate,date);
  }
});
test('refresh failure after deletion stays cleared and supports retry',async()=>{
  const s=setup([],[],true);await s.page.acceptDeletedDay(deleted,deleted.date);
  assert.equal(s.session.day,undefined);assert.equal(s.nav.days.length,0);assert.equal(s.page.errorMessage,'offline');
  s.page.reads.months=async()=>({months:[]});await s.page.retryRead();assert.equal(s.page.errorMessage,'');
});
test('late editor clearing cannot remove a newly selected document',async()=>{
  const s=setup([],[]);let release;s.page.editor={ready:true,documentKey:deleted.date,replace:()=>new Promise(r=>release=r)};
  const task=s.page.acceptDeletedDay(deleted,deleted.date);s.page.documents.dayLoadRevision++;
  s.session.commitDocument({date:'2026-02-06',exists:true,version:'v2'},'new');release();await task;
  assert.equal(s.session.selectedDate,'2026-02-06');assert.equal(s.session.text,'new');assert.deepEqual(s.notices,[]);
});
