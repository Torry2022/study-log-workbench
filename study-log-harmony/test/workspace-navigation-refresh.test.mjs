import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url),'utf8');
const start=source.indexOf('  private async refreshNavigationLists(');
const end=start+1+source.slice(start+1).search(/^  private /m);
const method=source.slice(start,end);
const controller=(await readFile(new URL('../entry/src/main/ets/app/NavigationRefreshController.ets',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
function workspace(tab=0) {
 const module={exports:{}}, pending=[], instance={revision:1};
 runInNewContext(ts.transpileModule(`${controller}\nexport class Root { ${method} }`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,activeInstance:instance});
 const root=new module.exports.Root();let date='2026-02-05';
 Object.assign(root,{selectedModule:tab,workspaceNavigationView:{currentLogDate:()=>date},
  logNavigation:{month:'2026-02',months:[],days:[],navigationError:'old'},
  modules:{noteYears:[],noteTags:[],noteCount:0,statsMonths:[],statsMonthsError:'old'},
  favoritesData:{favorites:[],groups:[],loading:false,groupSaving:false,groupUpdating:false,groupActionBusy:false},
  qaNavigation:{qaSessions:[],qaNavigationLoading:false,acceptQaNavigation(value){this.qaSessions=value;}}});
 root.navigationRefresh=new module.exports.NavigationRefreshController({get:path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject}))});
 return {root,pending,instance,setDate:value=>date=value};
}
test('workspace refresh publishes only navigation for each actual module entrypoint',async()=>{
 for(const tab of [0,1,2,3,4]){
  const {root,pending}=workspace(tab);const view=root.workspaceNavigationView;const task=root.refreshNavigationLists();
  const payload={months:['new month'],days:['new day'],years:['new year'],tags:['new tag'],notes:[{}],favorites:['new favorite'],groups:['new group'],sessions:['new session']};
  for(const request of pending)request.resolve(payload);await task;
  assert.equal(root.workspaceNavigationView,view);assert.equal(view.currentLogDate(),'2026-02-05');assert.equal(root.selectedModule,tab);
  if(tab===0){assert.deepEqual(root.logNavigation.months,payload.months);assert.deepEqual(root.logNavigation.days,payload.days);}
  if(tab===1){assert.deepEqual(root.modules.noteYears,payload.years);assert.equal(root.modules.noteCount,1);}
  if(tab===2)assert.deepEqual(root.favoritesData.favorites,payload.favorites);
  if(tab===3)assert.deepEqual(root.qaNavigation.qaSessions,payload.sessions);
  if(tab===4)assert.deepEqual(root.modules.statsMonths,payload.months);
 }
});
test('navigation refresh rejects changed binding, instance, module, date, month and newer list',async()=>{
 for(const change of [w=>w.root.workspaceNavigationView=undefined,w=>w.instance.revision++,w=>w.root.selectedModule=1,
  w=>w.setDate('2026-02-06'),w=>w.root.logNavigation.month='2026-01']){
  const w=workspace();const old=w.root.logNavigation.months;const task=w.root.refreshNavigationLists();change(w);
  for(const request of w.pending)request.resolve({months:['stale'],days:['stale']});await task;
  assert.equal(w.root.logNavigation.months,old);
 }
});
test('a concurrent day reload does not discard the newer month count',async()=>{
 const {root,pending}=workspace();const task=root.refreshNavigationLists();
 root.logNavigation.days=['newer day'];
 for(const request of pending)request.resolve({months:['two days'],days:['stale day']});
 await task;
 assert.deepEqual(root.logNavigation.months,['two days']);
 assert.deepEqual(root.logNavigation.days,['newer day']);
});
test('late refresh failure after unbinding is silent and active failures remain visible',async()=>{
 for(const unbound of [false,true]){
  const {root,pending}=workspace(1);const task=root.refreshNavigationLists();
  if(unbound)root.workspaceNavigationView=undefined;
  pending[0].reject(new Error('network'));
  if(unbound)await task;else await assert.rejects(task,/导航刷新失败/);
 }
});
test('favorites and QA refresh cannot overwrite concurrent writes or newer navigation loads',async()=>{
 for(const [tab,change] of [[2,r=>r.favoritesData.groupSaving=true],[2,r=>r.favoritesData.favorites=['newer']],
  [3,r=>r.qaNavigation.qaNavigationLoading=true],[3,r=>r.qaNavigation.qaSessions=['newer']]]){
  const {root,pending}=workspace(tab);const task=root.refreshNavigationLists();change(root);
  const expected=tab===2?root.favoritesData.favorites:root.qaNavigation.qaSessions;
  pending[0].resolve({favorites:['stale'],groups:[],sessions:['stale']});await task;
  assert.equal(tab===2?root.favoritesData.favorites:root.qaNavigation.qaSessions,expected);
 }
});
