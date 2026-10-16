import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceRun } from '../lib/rag-evidence.ts';
import { processRagMaterial } from '../lib/rag-material.ts';
import { createAgentModel } from '../lib/rag-agent.ts';

const config={baseUrl:'https://synthetic.invalid/chat',apiKey:'synthetic',model:'synthetic',contextWindowTokens:128000};
const options={question:'概括记录中的条件与变化',history:[],mode:'logs_only',coverage:'范围已读取',comparisonScopes:[]};
const runWith=content=>{
 const run=new EvidenceRun(new AbortController().signal);
 run.add([{date:'2026-09-01',fileName:'synthetic.md',chunkId:'one',contentHash:'original-version',content}]);
 run.coverage=[{dateFrom:'2026-09-01',dateTo:'2026-09-01',totalDays:1,readDates:['2026-09-01'],status:'complete'}];
 return run;
};
const packet=decision=>new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'material',type:'function',function:{name:'record_material',arguments:JSON.stringify(decision)}}]},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});

test('fitting material does not call a model or enter batch processing',async()=>{
 const run=runWith('已提供条件。');
 assert.equal(await processRagMaterial(run,config,createAgentModel(config,async()=>assert.fail('no batch call')),options,()=>{},true),false);
 assert.equal(run.materialCalls,0);assert.equal(run.material,undefined);
});

test('a compatibility character cap alone does not establish native context overflow',async()=>{
 const run=runWith('汉'.repeat(31000));
 assert.equal(await processRagMaterial(run,{...config,contextWindowTokens:undefined},createAgentModel(config,async()=>assert.fail('unknown native capacity')),options,()=>{},true),false);
 assert.equal(run.material,undefined);assert.equal(run.materialCalls,0);
});

test('working-memory backpressure keeps accepted notes and retries the same batch inside the original step budget',async()=>{
 const run=runWith('A'.repeat(4000)+'B'.repeat(4000)+'C'.repeat(4000)+'D'.repeat(10000)+'E'.repeat(9000));let calls=0;
 const model=createAgentModel(config,async(_url,init)=>{
  const input=JSON.parse(JSON.parse(init.body).messages.at(-1).content),part=input.parts[0];calls++;
  if(calls===1)return packet({assessment:'初批条件',notes:[0,4000,8000].map(start=>({sourceId:part.sourceId,quote:part.text.slice(start,start+4000)})),drop:[],nextBatch:1});
  if(calls===2)return packet({assessment:'继续',notes:[{sourceId:part.sourceId,quote:part.text.slice(0,4000)}],drop:[],nextBatch:null});
  if(calls===3){assert.equal(input.currentBatch,1);assert.equal(input.notes.length,3);assert.equal(input.feedback.code,'memory_limit');return packet({assessment:'移除不再需要的第一项',notes:[{sourceId:part.sourceId,quote:part.text.slice(0,4000)}],drop:[0],nextBatch:null});}
  assert.equal(input.currentBatch,2);return packet({assessment:'其余是无关背景',notes:[],drop:[],nextBatch:null});
 });
 await processRagMaterial(run,config,model,options,()=>{},true);
 assert.equal(calls,4);assert.equal(run.material.complete,true);assert.equal(run.materialCalls,4);
 assert.doesNotMatch(run.modelContexts()[0].content,/A{4000}/);assert.match(run.modelContexts()[0].content,/B{4000}/);
});

test('a truncated material tool submission cancels before another provider request and retains received usage',async()=>{
 const run=runWith('x'.repeat(31000)),usages=[];let calls=0;
 const model=createAgentModel(config,async()=>{
  calls++;
  const response=packet({assessment:'未完成',notes:[],drop:[],nextBatch:null});
  return new Response((await response.text()).replace('"finish_reason":"tool_calls"','"finish_reason":"length"'),{headers:response.headers});
 },(_call,usage)=>usages.push(usage));
 await assert.rejects(processRagMaterial(run,config,model,options,()=>{},true),error=>error.code==='AGENT_MATERIAL_INVALID');
 assert.equal(calls,1);assert.equal(run.material,undefined);assert.deepEqual(usages.at(-1),{inputTokens:10,outputTokens:5});
});

test('batches actually see the original tail, preserve prior notes and never rewrite raw evidence or range coverage',async()=>{
 const content='x'.repeat(31000)+'末尾条件：必须确认。',run=runWith(content),original=structuredClone(run.contexts),coverage=structuredClone(run.coverage);
 let calls=0;
 const model=createAgentModel(config,async(_url,init)=>{
  const body=JSON.parse(init.body),input=JSON.parse(body.messages.at(-1).content);calls++;
  const last=input.parts.at(-1),quote=last.text.slice(-15);
  return packet({assessment:'当前批已查看，仍按范围继续。',notes:[{sourceId:last.sourceId,quote}],drop:[],nextBatch:null});
 });
 assert.equal(await processRagMaterial(run,config,model,options,()=>{},true),true);
 assert.equal(calls,3);assert.equal(run.materialCalls,3);assert.equal(run.material.complete,true);
 assert.deepEqual(run.contexts,original);assert.deepEqual(run.coverage,coverage);assert.equal(run.calls,0);
 assert.match(run.modelContexts()[0].content,/末尾条件：必须确认/);assert.equal(run.modelContexts()[0].contentHash,'original-version');
 assert.equal(run.resolveModelSource('S1').content,run.modelContexts()[0].content);
 assert.doesNotMatch(run.modelContexts()[0].content,/当前批已查看/);
});

test('a declared small window processes Chinese UTF-8 fragments without losing the original tail',async()=>{
 const content='汉'.repeat(11000)+'末尾：仍须确认。',run=runWith(content);let calls=0;
 const model=createAgentModel(config,async(_url,init)=>{
  calls++;const input=JSON.parse(JSON.parse(init.body).messages.at(-1).content),part=input.parts.at(-1);
  assert.ok(Buffer.byteLength(part.text,'utf8')<=15000);
  return packet({assessment:'保留各批条件',notes:[{sourceId:part.sourceId,quote:part.text.slice(-12)}],drop:[],nextBatch:null});
 });
 await processRagMaterial(run,config,model,options,()=>{},true);
 assert.equal(calls,3);assert.equal(run.material.complete,true);
 assert.match(run.modelContexts()[0].content,/末尾：仍须确认/);assert.equal(run.contexts[0].content,content);
});

test('unprovided quotes cannot be laundered from raw registry or earlier discarded material',async()=>{
 const run=runWith('前'.repeat(31000)+'尚未提供的末尾条件');
 await assert.rejects(processRagMaterial(run,config,createAgentModel(config,async()=>packet({assessment:'猜测',notes:[{sourceId:'S1',quote:'尚未提供的末尾条件'}],drop:[],nextBatch:null})),options,()=>{},true),error=>error.code==='AGENT_MATERIAL_INVALID');
 assert.equal(run.material,undefined);assert.match(run.contexts[0].content,/尚未提供/);
});

test('new short evidence joins working material without discarding notes or reprocessing already inspected batches',async()=>{
 const run=runWith('x'.repeat(31000)+'前一记录末尾：待处理。');let calls=0;
 const model=createAgentModel(config,async(_url,init)=>{
  calls++;const input=JSON.parse(JSON.parse(init.body).messages.at(-1).content),part=input.parts.at(-1);
  return packet({assessment:'保留已读条件',notes:[{sourceId:part.sourceId,quote:part.text.slice(-16)}],drop:[],nextBatch:null});
 });
 await processRagMaterial(run,config,model,options,()=>{},true);assert.equal(calls,3);
 const oldMaterial=run.modelContexts()[0].content;
 run.add([{date:'2026-09-02',fileName:'synthetic.md',chunkId:'two',contentHash:'second-version',content:'后续记录：此前事项已完成。'}]);
 await processRagMaterial(run,config,model,options,()=>{},true);
 assert.equal(calls,3);assert.equal(run.modelContexts()[0].content,oldMaterial);
 assert.equal(run.modelContexts()[1].content,'后续记录：此前事项已完成。');
 assert.equal(run.material.complete,true);assert.equal(run.contexts[0].content,'x'.repeat(31000)+'前一记录末尾：待处理。');
});

test('revisits share the run budget and pending material remains explicit rather than silently discarded',async()=>{
 const run=runWith('x'.repeat(31000)+'末尾条件。');
 let calls=0;
 const model=createAgentModel(config,async()=>{calls++;return packet({assessment:'需要复看',notes:[{sourceId:'S1',quote:'x'}],drop:[],nextBatch:0});});
 await processRagMaterial(run,config,model,options,()=>{},true);
 assert.equal(calls,4);assert.equal(run.materialCalls,4);assert.equal(run.material.complete,false);
 assert.deepEqual(run.material.processedBatches,[0]);assert.equal(run.material.totalBatches,3);
 assert.match(run.answerReport(),/仍有材料未处理/);assert.equal(run.coverage[0].status,'complete');
 await processRagMaterial(run,config,model,options,()=>{},true);assert.equal(calls,4);
});

test('oversized notes, invalid batch IDs and cancellation stop without publishing material',async()=>{
 for(const decision of [{assessment:'',notes:[],drop:[],nextBatch:99},{assessment:'',notes:[{sourceId:'S1',quote:'x'.repeat(4001)}],drop:[],nextBatch:null}]){
  const run=runWith('x'.repeat(31000));
  await assert.rejects(processRagMaterial(run,config,createAgentModel(config,async()=>packet(decision)),options,()=>{},true),error=>error.code==='AGENT_MATERIAL_INVALID');
  assert.equal(run.material,undefined);
 }
 const controller=new AbortController(),run=runWith('x'.repeat(31000));
 controller.abort();
 await assert.rejects(processRagMaterial(new EvidenceRun(controller.signal),config,createAgentModel(config,async()=>assert.fail()),options,()=>{},true));
});
