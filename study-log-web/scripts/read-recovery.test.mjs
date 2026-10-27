import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../lib/client-http.ts';
const ok = () => new Response('{"value":"recovered"}');
for (const failure of [502,503,504,'network']) test(`safe GET recovers after ${failure} without caller-visible failure`, async t => {
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);let calls=0;
 globalThis.fetch=async()=>{if(++calls===1){if(failure==='network')throw new TypeError('synthetic offline');return new Response('<html>upstream unavailable</html>',{status:failure});}return ok()};
 assert.deepEqual(await requestJson('/api/stats?month=synthetic'),{value:'recovered'});assert.equal(calls,2);
});
test('persistent outage is bounded and a later read recovers',async t=>{
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('{}',{status:503})};
 await assert.rejects(requestJson('/api/favorites'),e=>e.status===503);assert.equal(calls,2);
 globalThis.fetch=async()=>ok();assert.equal((await requestJson('/api/favorites')).value,'recovered');
});
for(const status of [401,403,404,409,429])test(`HTTP ${status} is not retried`,async t=>{
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('{"error":"explicit rejection"}',{status})};
 await assert.rejects(requestJson('/api/rag/tasks'),e=>e.status===status);assert.equal(calls,1);
});
test('successful invalid JSON is classified rather than returned as an empty object',async t=>{
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('<html>bad success</html>')};
 await assert.rejects(requestJson('/api/notes'),e=>e.code==='INVALID_RESPONSE');assert.equal(calls,1);
});
for(const method of ['POST','PUT','PATCH','DELETE'])test(`${method} is never replayed by read recovery`,async t=>{
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('{}',{status:502})};
 await assert.rejects(requestJson('/api/rag/tasks',{method,body:'{}'}));assert.equal(calls,1);
});
test('cancellation during retry delay prevents the second request',async t=>{
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);let calls=0;const control=new AbortController();
 globalThis.fetch=async()=>{calls++;setTimeout(()=>control.abort(),20);return new Response('{}',{status:503})};
 await assert.rejects(requestJson('/api/logs/months',{signal:control.signal}),e=>e.name==='AbortError');assert.equal(calls,1);
});
test('a hung GET has a finite deadline and cannot publish late data',async t=>{
 const saved=globalThis.fetch;t.after(()=>globalThis.fetch=saved);t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))};
 const pending=requestJson('/api/rag/tasks');const check=assert.rejects(pending,e=>e.code==='READ_TIMEOUT');
 t.mock.timers.tick(10000);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(350);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(10000);await check;assert.equal(calls,2);
});
