import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { callStudyLogTool } from '../lib/mcp-client.ts';

async function pendingRpc(t, timeoutMs, external) {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    const response = result => new Response(JSON.stringify({ jsonrpc:'2.0',id:body.id,result }),{headers:{'content-type':'application/json'}});
    if(body?.method === 'server/discover') return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'legacy'}}),{headers:{'content-type':'application/json'}});
    if(body?.method === 'initialize') return response({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'synthetic-budget',version:'1'}});
    if(body?.method === 'tools/call') return new Promise((resolve,reject) => {
      const abort=()=>reject(new DOMException('Aborted','AbortError'));
      init.signal.addEventListener('abort',abort,{once:true});
      release=()=>{init.signal.removeEventListener('abort',abort);resolve(response({content:[{type:'text',text:'{"complete":true}'}]}));};
      started();
    });
    return new Response(null,{status:body ? 202 : 405});
  });
  let settled=false;
  const pending=callStudyLogTool('retrieve_contexts',{input:'synthetic'},external,{url:'http://127.0.0.1:9/mcp',token:'synthetic-only'},timeoutMs)
    .then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
  await ready; await setImmediate();
  return {pending,release:()=>release(),settled:()=>settled};
}
test('MCP retrieval honors a caller budget beyond the former hidden cutoff',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const rpc=await pendingRpc(t,180000);
  t.mock.timers.tick(45001);await setImmediate();
  assert.equal(rpc.settled(),false);
  rpc.release();assert.deepEqual((await rpc.pending).value,{complete:true});
});
test('the same overall budget still expires while a tool is waiting',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const rpc=await pendingRpc(t,80000);
  t.mock.timers.tick(80000);
  assert.equal((await rpc.pending).error.code,'MCP_TIMEOUT');
});
test('a longer tool budget never delays explicit cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const cancellation=new AbortController(),rpc=await pendingRpc(t,180000,cancellation.signal);
  cancellation.abort();
  assert.equal((await rpc.pending).error.code,'MCP_CANCELLED');
});
