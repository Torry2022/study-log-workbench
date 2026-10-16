import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planRagMaterial} from '../lib/rag-material-plan.ts';

const chat={baseUrl:'https://synthetic.invalid/chat',apiKey:'synthetic',model:'synthetic'};
const source=(id,content)=>Object.freeze({sourceId:`S${id}`,date:`2026-09-${String(id).padStart(2,'0')}`,fileName:'synthetic.md',heading:`合成主题${id}`,headingIndex:0,chunkId:`synthetic:${id}`,contentHash:createHash('sha256').update(content).digest('hex'),content,truncated:false});
const options={question:'概括材料中的条件及前后变化',history:[],mode:'logs_only',coverage:'已按指定范围读取，模型处理进度另行登记。',comparisonScopes:[]};

test('material that fits remains direct, including a truncated search result',()=>{
 const contexts=Object.freeze([source(1,'已经提供的条件。'),Object.freeze({...source(2,'另一段原文。'),truncated:true})]);
 const plan=planRagMaterial(contexts,chat,options);
 assert.equal(plan.kind,'direct');assert.equal(plan.batches.length,0);
 assert.deepEqual(contexts.map(s=>s.content),['已经提供的条件。','另一段原文。']);
});

test('an admitted large context does not trigger material Agent just because it exceeds the fallback character limit',()=>{
 const contexts=Object.freeze([source(1,'汉'.repeat(35000))]);
 const plan=planRagMaterial(contexts,{...chat,contextWindowTokens:220000},options);
 assert.equal(plan.kind,'direct');assert.equal(plan.unit,'utf8_bytes');
});

test('overflow partitions every source exactly once without altering identities, dates or original evidence',()=>{
 const contexts=Object.freeze([source(1,('第一段说明。\n\n').repeat(2500)+'末尾明确条件：未确认不得继续。'),source(2,'后续更新：先前问题已处理。'+('其他背景。').repeat(3500))]);
 const before=JSON.stringify(contexts),plan=planRagMaterial(contexts,chat,options);
 assert.equal(plan.kind,'batches');assert.ok(plan.batches.length>1);
 assert.equal(plan.unit,'characters');assert.equal(JSON.stringify(contexts),before);
 for(const original of contexts){
  const parts=plan.batches.flatMap(b=>b.parts).filter(part=>part.sourceId===original.sourceId);
  assert.ok(parts.length);let offset=0;
  for(const part of parts){assert.equal(part.start,offset);assert.equal(part.text,original.content.slice(part.start,part.end));assert.equal(part.date,original.date);assert.equal(part.contentHash,original.contentHash);offset=part.end;}
  assert.equal(offset,original.content.length);assert.equal(parts.map(part=>part.text).join(''),original.content);
 }
 for(const batch of plan.batches)assert.ok(batch.size<=plan.batchLimit);
 assert.ok(plan.batches.flatMap(b=>b.parts).some(part=>part.text.includes('未确认不得继续')));
});

test('UTF-8 partition boundaries never split surrogate pairs and do not silently discard batches over a run budget',()=>{
 const original=source(1,('🧭条件甲：不能自动批准。\n').repeat(9000));
 const plan=planRagMaterial(Object.freeze([original]),{...chat,contextWindowTokens:128000},options);
 assert.equal(plan.kind,'batches');assert.equal(plan.unit,'utf8_bytes');assert.ok(plan.batches.length>8);
 const parts=plan.batches.flatMap(b=>b.parts);assert.equal(parts.map(p=>p.text).join(''),original.content);
 for(const part of parts){assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part.text));assert.ok(Buffer.byteLength(part.text,'utf8')<=plan.batchLimit);}
});
