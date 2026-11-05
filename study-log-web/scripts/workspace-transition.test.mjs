import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source=await fs.readFile(new URL('../hooks/use-workspace-transition.ts',import.meta.url),'utf8');
function setup(reduced=false, overrides={}){
  const callbacks=[], transitions=[], frames=[], cleanups=[];
  const document={documentElement:{dataset:{},style:{setProperty(){}}},querySelector:()=>null,querySelectorAll:()=>[],
    createElement:()=>({style:{},setAttribute(){},classList:{add(){}},isConnected:false,
      append(child){this.child=child;},remove(){this.isConnected=false;}}),
    startViewTransition(callback){
      callbacks.push(callback);let finish;const transition={finished:new Promise(resolve=>finish=resolve),skipTransition:()=>finish()};
      transitions.push(transition);return transition;
    }};
  Object.assign(document,overrides);
  const module={exports:{}};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
    exports:module.exports,require(name){
      if(name==='react')return {useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>cleanups.push(fn())};
      if(name==='react-dom')return {flushSync:fn=>fn()};throw Error(name);
    },document,navigator:{userAgent:'Chrome'},window:{innerWidth:1440,innerHeight:900,matchMedia:()=>({matches:reduced})},
    getComputedStyle:()=>({transform:'none',width:'0',height:'0'}),requestAnimationFrame:fn=>frames.push(fn),cancelAnimationFrame(){},setTimeout,clearTimeout
  });
  return {hook:module.exports.useWorkspaceTransition(),callbacks,transitions,frames,document,cleanups};
}

test('module changes keep old snapshot dimensions and cancel superseded presentation without native geometry',async()=>{
  const classes={add(){},remove(){},contains:()=>false};
  const copies=[];
  const surface=(width,height)=>({style:{viewTransitionName:''},classList:classes,querySelectorAll:()=>[],scrollTop:0,scrollLeft:0,
    getBoundingClientRect:()=>({left:260,top:146,right:260+width,bottom:146+height,width,height}),
    cloneNode:()=>{const copy={style:{},classList:classes,scrollTop:0,scrollLeft:0,querySelectorAll:()=>[],removeAttribute(){},setAttribute(){},isConnected:false,remove(){this.isConnected=false;}};copies.push(copy);return copy;}});
  const old=surface(1180,2000),next=surface(800,754);let current=old;
  const overlays=[];
  const {hook,callbacks}=setup(false,{body:{append:n=>{n.isConnected=true;overlays.push(n);}},querySelector:selector=>selector==='[data-workspace-transition-shell]'?null:current});
  assert.equal(await hook.runTransition('workspace',()=>current=next,{waitForReady:true}),true);
  assert.equal(overlays[0].style.width,'1180px');assert.equal(overlays[0].style.height,'2000px');
  assert.equal(overlays[0].child,copies[0]);assert.equal(copies[0].style.width,'100%');
  assert.equal(callbacks.length,0);assert.equal(current.style.viewTransitionName,'');
  assert.equal(await hook.runTransition('workspace',()=>current=old,{waitForReady:true}),true);
  assert.equal(overlays[0].isConnected,false);assert.equal(overlays[1].style.width,'800px');assert.equal(overlays[1].style.height,'754px');
  hook.cancelTransition();assert.equal(overlays[1].isConnected,false);
});

test('retained CSS snapshot updates its clipping boundary when sticky toolbar moves',()=>{
  let toolbarBottom=80;
  const classList={add(){},remove(){},contains:()=>false};
  const snapshot={style:{},classList,isConnected:false,removeAttribute(){},querySelectorAll:()=>[],setAttribute(){},remove(){this.isConnected=false;}};
  const surface={classList,querySelectorAll:()=>[],cloneNode:()=>snapshot,getBoundingClientRect:()=>({top:-400,left:260,right:1440,bottom:2400,width:1180,height:2800})};
  const shell={getBoundingClientRect:()=>({top:-480,left:260,right:1440}),querySelector:()=>({getBoundingClientRect:()=>({bottom:toolbarBottom})})};
  let overlay;
  const {hook,frames}=setup(false,{startViewTransition:undefined,body:{append(element){element.isConnected=true;overlay=element;}},
    querySelector:selector=>selector==='[data-workspace-transition-shell]'?shell:surface});
  void hook.runTransition('log-document',()=>{}, {waitForReady:true});
  assert.equal(overlay.style.clipPath,'inset(480px 0px 1500px 0px)');
  toolbarBottom=146;frames.shift()();
  assert.equal(overlay.style.clipPath,'inset(546px 0px 1500px 0px)');
  // Superseding the waiting transition removes its retained surface.
  void hook.runTransition('log-mode',()=>{});
  assert.equal(overlay.isConnected,false);
});

test('document and mode transitions apply live updates without native reading snapshots',async()=>{
  const {hook,callbacks}=setup();const updates=[];
  assert.equal(await hook.runTransition('log-document',()=>updates.push('date'),{waitForReady:true}),true);
  assert.equal(await hook.runTransition('log-mode',()=>updates.push('mode')),true);
  assert.equal(callbacks.length,0);assert.deepEqual(updates,['date','mode']);
});

test('reduced motion clears pending transition presentation while committing navigation',async()=>{
  const {hook,document}=setup(true);document.documentElement.dataset.workspaceTransition='workspace';let applied=false;
  assert.equal(await hook.runTransition('log-document',()=>applied=true,{waitForReady:true}),true);
  assert.equal(applied,true);assert.equal(document.documentElement.dataset.workspaceTransition,undefined);
});

test('reading mode can cancel retained content presentation before applying its own transition',async()=>{
  const removed=[];
  const surface={classList:{remove:(...names)=>removed.push(...names)}};
  const {hook,document}=setup(false,{querySelectorAll:()=>[surface]});
  document.documentElement.dataset.workspaceTransition='log-mode';
  hook.cancelTransition();
  assert.equal(document.documentElement.dataset.workspaceTransition,undefined);
  assert.deepEqual(removed,['workspace-content-waiting','workspace-content-revealing']);
});

test('position restoration keeps nested editor scrolling in its retained snapshot',async()=>{
  const classList={add(){},remove(){},contains:()=>false};
  const child={scrollTop:360,scrollLeft:12},copy={scrollTop:0,scrollLeft:0};
  const snapshot={style:{},classList,isConnected:false,removeAttribute(){},setAttribute(){},
    querySelectorAll:selector=>selector==='*'?[copy]:[],remove(){this.isConnected=false;}};
  const surface={classList,scrollTop:20,scrollLeft:2,querySelectorAll:()=>[child],cloneNode:()=>snapshot,
    getBoundingClientRect:()=>({top:80,left:260,right:1440,bottom:900,width:1180,height:820})};
  let overlay;
  const {hook}=setup(false,{startViewTransition:undefined,body:{append(element){element.isConnected=true;overlay=element;}},
    querySelector:selector=>selector==='[data-workspace-transition-shell]'?null:surface});
  assert.equal(await hook.runTransition('log-mode',()=>{}, {waitForReady:true}),true);
  assert.equal(snapshot.scrollTop,20);assert.equal(snapshot.scrollLeft,2);
  assert.equal(copy.scrollTop,360);assert.equal(copy.scrollLeft,12);
  hook.cancelTransition();assert.equal(overlay.isConnected,false);
});
