import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RagTaskClient } from '../lib/rag-task-client.ts';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const storage={getItem(){return null},setItem(){},removeItem(){}};
function make(request){return new RagTaskClient(randomUUID(),storage,{task(){},pending(){},rejected(){},missing(){},error:message=>errors.push(message)},request)}
let errors=[];
test('idle task discovery is idempotent, pauses while hidden and reconciles on foreground/online',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const savedDoc=globalThis.document,savedWindow=globalThis.window;
 const doc=new EventTarget();doc.hidden=false;globalThis.document=doc;globalThis.window=new EventTarget();
 t.after(()=>{globalThis.document=savedDoc;globalThis.window=savedWindow});let calls=0;errors=[];
 const client=make(async()=>{calls++;return{tasks:[]}});t.after(()=>client.stop());client.start();client.start();await flush();assert.equal(calls,1);
 t.mock.timers.tick(1000);await flush();assert.equal(calls,1);t.mock.timers.tick(14000);await flush();assert.equal(calls,2);
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(60000);await flush();assert.equal(calls,2);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls,3);
 window.dispatchEvent(new Event('online'));await flush();assert.equal(calls,4);client.stop();window.dispatchEvent(new Event('online'));t.mock.timers.tick(60000);await flush();assert.equal(calls,4);
});
test('persistent discovery failures remain visible, back off, and clear only after a successful read',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,offline=true;errors=[];
 const client=make(async()=>{calls++;if(offline)throw Error('synthetic unavailable');return{tasks:[]}});t.after(()=>client.stop());client.start();await flush();assert.match(errors.at(-1),/unavailable/);
 t.mock.timers.tick(1000);await flush();assert.equal(calls,1);t.mock.timers.tick(1000);await flush();assert.equal(calls,2);
 t.mock.timers.tick(3000);await flush();assert.equal(calls,2);offline=false;t.mock.timers.tick(1000);await flush();assert.equal(calls,3);assert.equal(errors.at(-1),'');
});

test('streaming tasks retain a timely fallback while healthy events reduce polling',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let listReads=0,emit;
 const value={id:randomUUID(),sessionId:randomUUID(),submissionId:randomUUID(),revision:1,state:'running',saveState:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),question:'synthetic',partial:'first',stage:'reading',error:'',saveError:'',replaceLast:false,mode:'logs_only',result:null};
 const client=new RagTaskClient(randomUUID(),storage,{task(){},pending(){},rejected(){},missing(){},error(){}},async url=>{if(url==='/api/rag/tasks'){listReads++;return{tasks:[value]}}return{task:value}},async(_url,init,accept)=>{emit=accept;return new Promise(resolve=>init.signal.addEventListener('abort',resolve,{once:true}))});
 t.after(()=>client.stop());client.viewSession(value.sessionId);client.start();await flush();assert.equal(listReads,1);assert.ok(emit);
 await emit({...value,revision:2,partial:'second'});t.mock.timers.tick(1000);await flush();assert.equal(listReads,2);
 t.mock.timers.tick(1000);await flush();assert.equal(listReads,2);t.mock.timers.tick(2000);await flush();assert.equal(listReads,3);
});
