import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source=await fs.readFile(new URL('../hooks/use-workspace-transition.ts',import.meta.url),'utf8');
function setup(reduced=false, overrides={}){
  const callbacks=[], transitions=[], frames=[], cleanups=[];
  const document={documentElement:{dataset:{},style:{setProperty(){}}},querySelector:()=>null,
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

test('superseded native updates resolve false and cannot execute an obsolete navigation',async()=>{
  const {hook,callbacks}=setup();const updates=[];
  const first=hook.runTransition('workspace',()=>updates.push('old'));
  const second=hook.runTransition('workspace',()=>updates.push('new'));
  await callbacks[0]();await callbacks[1]();
  assert.equal(await first,false);assert.equal(await second,true);assert.deepEqual(updates,['new']);
});

test('native module changes name both visible bodies and restore each original name',async()=>{
  const surface=name=>({style:{viewTransitionName:name},getBoundingClientRect:()=>({left:260,top:146,width:1180,height:754})});
  const old=surface(''),next=surface('original-next');let current=old;
  const {hook,callbacks,transitions}=setup(false,{querySelector:selector=>selector==='[data-workspace-transition-shell]'?null:current});
  const applied=hook.runTransition('workspace',()=>current=next);
  assert.equal(old.style.viewTransitionName,'workspace-content');
  await callbacks[0]();assert.equal(await applied,true);assert.equal(next.style.viewTransitionName,'workspace-content');
  transitions[0].skipTransition();await Promise.resolve();await Promise.resolve();
  assert.equal(old.style.viewTransitionName,'');assert.equal(next.style.viewTransitionName,'original-next');
});

test('retained CSS snapshot updates its clipping boundary when sticky toolbar moves',()=>{
  let toolbarBottom=80;
  const classList={add(){},remove(){}};
  const snapshot={style:{},classList,isConnected:false,removeAttribute(){},querySelectorAll:()=>[],setAttribute(){},remove(){this.isConnected=false;}};
  const surface={classList,cloneNode:()=>snapshot,getBoundingClientRect:()=>({top:-400,left:260,right:1440,bottom:2400,width:1180,height:2800})};
  const shell={getBoundingClientRect:()=>({top:-480,left:260,right:1440}),querySelector:()=>({getBoundingClientRect:()=>({bottom:toolbarBottom})})};
  const {hook,frames}=setup(false,{startViewTransition:undefined,body:{append(element){element.isConnected=true;}},
    querySelector:selector=>selector==='[data-workspace-transition-shell]'?shell:surface});
  void hook.runTransition('log-document',()=>{}, {waitForReady:true});
  assert.equal(snapshot.style.clipPath,'inset(480px 0px 1500px 0px)');
  toolbarBottom=146;frames.shift()();
  assert.equal(snapshot.style.clipPath,'inset(546px 0px 1500px 0px)');
  // Superseding the waiting transition removes its retained surface.
  void hook.runTransition('log-mode',()=>{});
  assert.equal(snapshot.isConnected,false);
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
