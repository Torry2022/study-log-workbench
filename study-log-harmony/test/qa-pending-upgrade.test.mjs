import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { fixture, submission, task } from './qa-task-fixture.mjs';

function load(source, dependencies) {
 const module={exports:{}};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,Error,Date,JSON,Map,Set,setTimeout,clearTimeout,require:name=>{if(!(name in dependencies))throw Error(name);return dependencies[name];}});
 return module.exports;
}

test('an unaccepted edit is invisible to the actual old app pending reader and sender',async t=>{
 const f=await fixture(),values=new Map(),store={get:async(k,d)=>values.get(k)??d,put:async(k,v)=>values.set(k,v),flush:async()=>{}};
 const deps={'@kit.ArkData':{preferences:{getPreferences:async()=>store}},'@kit.ArkTS':{util:{}},'../network/InstanceConfig':{activeInstance:{}}};
 const current=load(await readFile(new URL('../entry/src/main/ets/common/storage/InstanceStore.ets',import.meta.url),'utf8'),deps);
 const settings=new current.InstanceStore();await settings.initialize({});
 const get=f.transport.getForInstance;f.transport.getForInstance=async(...args)=>args[0]==='/capabilities'?{instanceId:f.instanceId,features:{ragTasks:{supported:true,configured:true,protocolVersion:1,questionEditing:true}}}:get(...args);
 let posts=0;f.transport.postForInstance=async()=>{posts++;throw Error('synthetic request never accepted');};
 const client=new f.QaTaskClient(f.transport,{read:()=>settings.readQaPending('synthetic'),write:raw=>settings.writeQaPending('synthetic',raw)},f.instanceId);t.after(()=>client.stop());
 await client.connect();const input={...submission(),baseVersion:'a'.repeat(64),editMessageId:'old-user'};
 await client.submit(input);assert.equal(posts,1);assert.equal(f.tasks.size,0);client.stop();
 assert.equal(JSON.parse(values.get('rag-pending-v2:synthetic'))[0].editMessageId,'old-user');
 const oldStoreSource=execFileSync('git',['show','b3c2152d538f10542aaa93f1b1abad30decf167f:study-log-harmony/entry/src/main/ets/common/storage/InstanceStore.ets'],{encoding:'utf8'});
 const oldSettings=new (load(oldStoreSource,deps).InstanceStore)();await oldSettings.initialize({});
 assert.equal(await oldSettings.readQaPending('synthetic'),'[]');
 const oldSource=execFileSync('git',['show','b3c2152d538f10542aaa93f1b1abad30decf167f:study-log-harmony/entry/src/main/ets/features/qa/QaTaskClient.ets'],{encoding:'utf8'});
 const legacy=new (load(oldSource,{'../../common/network/ApiClient':{ApiError:f.ApiError},'./QaTaskModels':f}).QaTaskClient)(f.transport,
  {read:()=>oldSettings.readQaPending('synthetic'),write:raw=>oldSettings.writeQaPending('synthetic',raw)},f.instanceId);t.after(()=>legacy.stop());
 await legacy.connect();assert.equal(posts,1,'old app must not turn the edit into an append');assert.equal(legacy.pending.length,0);
});

test('legacy ordinary submissions migrate only after the v2 flush; a failed flush cannot lose or replay them',async t=>{
 const f=await fixture(),input=submission();let legacy=JSON.stringify([input]),clears=0;const events=[];
 const storage={read:()=>f.local.read(),write:async raw=>{events.push('v2');await f.local.write(raw);},readLegacy:async()=>legacy,
  clearLegacy:async()=>{events.push('clear');clears++;legacy='[]';}};
 const client=new f.QaTaskClient(f.transport,storage,f.instanceId);t.after(()=>client.stop());
 f.local.fail=true;await client.connect();assert.equal(clears,0);assert.equal(JSON.parse(legacy)[0].submissionId,input.submissionId);
 assert.equal(f.requests.some(r=>r.method==='POST'),false);
 events.length=0;f.local.fail=false;await client.connect();assert.deepEqual(events.slice(0,2),['v2','clear']);
 assert.equal(legacy,'[]');assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
 assert.equal(f.requests.find(r=>r.method==='POST').body.submissionId,input.submissionId);
});

test('legacy records carrying edit semantics fail closed without migration or a request',async t=>{
 const f=await fixture(),legacy=JSON.stringify([{...submission(),baseVersion:'a'.repeat(64),editMessageId:'old-user'}]);let cleared=false;
 const client=new f.QaTaskClient(f.transport,{...f.local,readLegacy:async()=>legacy,clearLegacy:async()=>{cleared=true;}},f.instanceId);t.after(()=>client.stop());
 await client.connect();assert.equal(client.ready,false);assert.equal(cleared,false);assert.equal(f.local.raw,'[]');assert.equal(f.requests.length,0);
});

test('same-revision applicability changes are refreshed and cannot hide an earlier applicable task',async t=>{
 const f=await fixture(),old=task(),newer=task(old.sessionId,{createdAt:'2026-10-19T00:00:00Z'});
 f.tasks.set(old.id,old);f.tasks.set(newer.id,newer);await f.client.connect();t.after(()=>f.client.stop());
 newer.applicable=false;await f.client.readSessionTasks(old.sessionId);
 assert.equal(f.client.tasks.find(t=>t.id===newer.id).applicable,false);assert.equal(f.latestTask(f.client.tasks,old.sessionId).id,old.id);
});

test('a late old native GET cannot reverse an already superseded same-revision summary',async t=>{
 const f=await fixture(),original=task();f.tasks.set(original.id,original);await f.client.connect();t.after(()=>f.client.stop());
 const get=f.transport.getForInstance;let release;
 const pending=new Promise(resolve=>{release=resolve;});let delay=true;
 f.transport.getForInstance=async(path,...args)=>path.endsWith(original.id)&&delay?pending:get(path,...args);
 const oldRead=f.client.read(original.id);original.applicable=false;
 await f.client.refresh();assert.equal(f.client.tasks.find(t=>t.id===original.id).applicable,false);
 delay=false;release({task:{...original,applicable:true}});await oldRead;
 assert.equal(f.client.tasks.find(t=>t.id===original.id).applicable,false);
 assert.equal(f.latestTask(f.client.tasks,original.sessionId),undefined);
});
