import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const methods = ['setDesktopNavigationCollapsed', 'resetSidebarMotion'].map(name => {
 const start = source.indexOf(`  private ${name}(`); assert.ok(start >= 0);
 const end = source.slice(start + 1).search(/^  private /m);
 return source.slice(start, start + end + 1);
}).join('\n');
const code = ts.transpileModule(`export class Root {${methods}}`, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function fixture() {
 const module={exports:{}},frames=[],writes=[],progress=[],sections=[];let now=0,finished=0;
 runInNewContext(code,{module,exports:module.exports,Date:{now:()=>now},Math,WorkspaceBreakpoint:{EXTRA_LARGE:'xl'},
  workspacePreferences:{set:(...args)=>{writes.push(args);return Promise.resolve();}},
  FrameAction:class {constructor(action){this.action=action;}}});
 const root=new module.exports.Root();
 Object.assign(root,{sidebar:{collapsedModules:[false,false,false,false,false],sidebarExpansion:1,sidebarAnimating:false,sidebarMotionRevision:0},
  selectedModule:0,workspaceTransition:{},workspaceBreakpoint:'large',
  workspaceNavigationView:{canMoveSidebar:()=>true,closeNavigation(){},beginSidebarMotion:()=>[[100],[40]],
   advanceSidebarMotion:(_widths,value)=>progress.push(value),finishSidebarMotion:()=>finished++,scrollSidebar:value=>sections.push(value)},
  getUIContext:()=>({postFrameCallback:frame=>frames.push(frame.action)})});
 return {root,frames,writes,progress,sections,finishCount:()=>finished,at:value=>now=value};
}
test('sidebar capture and reveal guards prevent layout changes and preference writes',()=>{
 for(const key of ['task','snapshot']) {
  const {root,frames,writes}=fixture();root.workspaceTransition[key]={};root.setDesktopNavigationCollapsed(true);
  assert.equal(root.sidebar.collapsedModules[0],false);assert.equal(root.sidebar.sidebarAnimating,false);
  assert.equal(frames.length,0);assert.equal(writes.length,0);
 }
});
test('sidebar preserves original 240ms smoothstep and synchronizes the log toolbar with every frame',()=>{
 const f=fixture();f.root.setDesktopNavigationCollapsed(true);f.at(120);f.frames.shift()();
 assert.equal(f.root.sidebar.sidebarExpansion,.5);assert.deepEqual(f.progress,[.5]);
 f.at(240);f.frames.shift()();assert.equal(f.root.sidebar.sidebarExpansion,0);assert.equal(f.root.sidebar.sidebarAnimating,false);
 f.frames.shift()();assert.equal(f.finishCount(),1);assert.deepEqual(f.writes,[['sidebarCollapsed0',true]]);
 f.root.setDesktopNavigationCollapsed(false,2);f.at(480);f.frames.shift()();f.frames.shift()();
 assert.equal(f.root.sidebar.sidebarExpansion,1);assert.deepEqual(f.sections,[2]);
});
test('cancelled or rebound sidebar frames cannot affect the new workspace',()=>{
 for(const cancel of [f=>f.root.resetSidebarMotion(),f=>f.root.workspaceNavigationView={}]) {
  const f=fixture();f.root.setDesktopNavigationCollapsed(true);cancel(f);f.at(240);f.frames.shift()();
  assert.equal(f.progress.length,0);assert.equal(f.finishCount(),0);
 }
});
test('the final sidebar cleanup frame cannot change toolbar state after a module reset',()=>{
 const f=fixture();f.root.setDesktopNavigationCollapsed(true);f.at(240);f.frames.shift()();
 f.root.resetSidebarMotion();f.frames.shift()();assert.equal(f.finishCount(),0);
});
