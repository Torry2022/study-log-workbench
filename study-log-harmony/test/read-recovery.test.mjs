import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const ts=createRequire(new URL('../../study-log-web/package.json',import.meta.url))('typescript');
const base=new URL('../entry/src/main/ets/common/network/',import.meta.url);
async function compile(name){return ts.transpileModule(await readFile(new URL(name+'.ets',base),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}
const api=await compile('ApiClient'),cancelCode=await compile('ReadCancellation');let reasonCode='';try{reasonCode=await compile('ReadFailure')}catch{}
function harness(results){
 let calls=0,closed=0,binding=0;const logs=[];class ApiError extends Error{constructor(message,statusCode,code=''){super(message);this.statusCode=statusCode;this.code=code}}
 const reasons={exports:{}};runInNewContext(reasonCode,{module:reasons,exports:reasons.exports});const cancellation={exports:{}};runInNewContext(cancelCode,{module:cancellation,exports:cancellation.exports,Error});
 const m={exports:{}};
 runInNewContext(api,{module:m,exports:m.exports,Error,SyntaxError,JSON,Date,setTimeout,clearTimeout,require(name){
  if(name==='./ApiError')return{ApiError};if(name==='./ReadCancellation')return cancellation.exports;if(name==='./ReadFailure')return reasons.exports;
  if(name==='./InstanceConfig')return{activeInstance:{revision:binding,apiUrl:p=>'https://synthetic.invalid'+p}};
  if(name==='../AppConfig')return{API_BASE_URL:'https://synthetic.invalid',API_MODE:'production'};
  if(name==='./RequestPolicy')return{ApiMode:{PRODUCTION:'production'},RequestPolicy:{mode:x=>x,assertNetworkAllowed(){}},RequestPolicyError:class extends Error{}};
  if(name==='@kit.PerformanceAnalysisKit')return{hilog:{error:(...x)=>logs.push(x)}};
  if(name==='@kit.RemoteCommunicationKit')return{rcp:{Request:class{},createSession:()=>{let reject;return{fetch:async()=>{calls++;const r=results.shift();if(r.hang)return new Promise((_resolve,fail)=>reject=fail);if(r.error)throw r.error;return{statusCode:r.status||200,toString:()=>r.body||'{}'}},close(){closed++},cancel(){reject?.({code:1007900042})}}}}};
  return{};
 }});
 return{client:new m.exports.ApiClient(),ApiError:m.exports.ApiError||ApiError,ReadCancellation:cancellation.exports.ReadCancellation,calls:()=>calls,closed:()=>closed,logs};
}
for(const failure of [502,503,504,1007900035,1007900028,1007900007])test(`native GET recovers after ${failure}`,async()=>{
 const first=failure<1000?{status:failure}:{error:{code:failure}};const h=harness([first,{body:'{"value":"recovered"}'}]);
 assert.equal((await h.client.get('/stats?month=private-date')).value,'recovered');assert.equal(h.calls(),2);assert.equal(h.closed(),2);assert.ok(!JSON.stringify(h.logs).includes('private-date'));
});
test('native instance-bound reads use the same recovery budget',async()=>{
 const h=harness([{status:502},{body:'{"tasks":[]}'}]);assert.equal((await h.client.getForInstance('/rag/tasks','synthetic')).tasks.length,0);assert.equal(h.calls(),2);
});
for(const code of [1007900060,999])test(`native code ${code} is not automatically retried`,async()=>{
 const h=harness([{error:{code}}]);await assert.rejects(h.client.get('/favorites'));assert.equal(h.calls(),1);
});
for(const status of [401,403,409,429])test(`native HTTP ${status} is not retried`,async()=>{
 const h=harness([{status}]);await assert.rejects(h.client.get('/notes'));assert.equal(h.calls(),1);
});
test('native persistent outage remains visible and the next explicit read can recover',async()=>{
 const h=harness([{status:503},{status:503},{body:'{"value":1}'}]);await assert.rejects(h.client.get('/favorites'));assert.equal(h.calls(),2);assert.equal((await h.client.get('/favorites')).value,1);
});
for(const method of ['post','put','patch','delete'])test(`native ${method} never retries`,async()=>{
 const h=harness([{status:502}]);await assert.rejects(h.client[method]('/notes',{}));assert.equal(h.calls(),1);
});
test('native cancellation during backoff prevents another network request',async()=>{
 const h=harness([{status:503},{body:'{}'}]),c=new h.ReadCancellation();const work=h.client.get('/favorites',c);setTimeout(()=>c.cancel(),20);await assert.rejects(work,/取消/);assert.equal(h.calls(),1);
});
test('native token change during backoff cannot read into the new session',async()=>{
 const h=harness([{status:503},{body:'{}'}]);const work=h.client.get('/favorites');setTimeout(()=>h.client.setToken('synthetic-new-session'),20);await assert.rejects(work,/切换/);assert.equal(h.calls(),1);
});

test('native hung GETs respect the two-attempt deadline instead of waiting for the old minute timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness([{hang:true},{hang:true}]);
 const work=h.client.get('/favorites');const check=assert.rejects(work,/超时/);
 t.mock.timers.tick(10000);await new Promise(r=>setImmediate(r));t.mock.timers.tick(350);await new Promise(r=>setImmediate(r));t.mock.timers.tick(10000);await check;assert.equal(h.calls(),2);assert.equal(h.closed(),2);
});
