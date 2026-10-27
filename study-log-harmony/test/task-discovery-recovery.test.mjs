import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './qa-task-fixture.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('native idle discovery is idempotent, sleeps in background and resumes immediately',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();t.after(()=>f.client.stop());f.client.start();f.client.start();await flush();
 const reads=()=>f.requests.filter(x=>x.path==='/rag/tasks').length;
 assert.equal(reads(),1);t.mock.timers.tick(1000);await flush();assert.equal(reads(),1);t.mock.timers.tick(14000);await flush();assert.equal(reads(),2);
 f.client.setForeground(false);t.mock.timers.tick(60000);await flush();assert.equal(reads(),2);f.client.setForeground(true);await flush();assert.equal(reads(),3);
 f.client.stop();t.mock.timers.tick(60000);await flush();assert.equal(reads(),3);assert.equal(f.requests.filter(x=>x.method!=='GET').length,0);
});
test('native persistent discovery errors are visible and backoff resets on recovery',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();t.after(()=>f.client.stop());await f.client.connect();let offline=true,calls=0;const get=f.transport.getForInstance;
 f.transport.getForInstance=async(...args)=>{if(args[0]==='/rag/tasks'){calls++;if(offline)throw Error('synthetic offline')}return get(...args)};
 f.client.start();await flush();assert.ok(f.client.error);assert.equal(calls,1);t.mock.timers.tick(1000);await flush();assert.equal(calls,1);t.mock.timers.tick(1000);await flush();assert.equal(calls,2);
 offline=false;t.mock.timers.tick(4000);await flush();assert.equal(calls,3);assert.equal(f.client.error,'');
});
