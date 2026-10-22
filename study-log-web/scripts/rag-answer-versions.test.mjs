import test from 'node:test';
import assert from 'node:assert/strict';
import { ragAnswerVersions } from '../lib/rag-answer-versions.ts';
const pair = (id, content = id) => [{id, role:'user', content:'同一个问题'}, {id:id+'-a', role:'assistant', content, citations:[{sourceId:'S1',date:'2026-01-01',heading:content}]}];
const task = (id, questionId, previousAnswer, patch = {}) => ({id, sessionId:'session', questionMessageId:questionId, previousAnswer,
  question:'同一个问题', createdAt:id, revision:1, state:'succeeded', saveState:'saved', result:{answer:id,citations:[{sourceId:'S1',date:'2026-02-02',heading:id}]}, partial:'', ...patch});

test('an inapplicable old branch cannot restore removed questions or offered versions',()=>{
  const saved=pair('current'), old=task('old','removed',undefined,{applicable:false,saveState:'error'});
  const projection=ragAnswerVersions(saved,[old],new Map());
  assert.equal(projection.messages.length,2);assert.equal(projection.messages[0].id,'current');
  assert.deepEqual(projection.messages[1].versions,['current-a']);
});

test('an edit previews only its prefix while failure or cancellation restores the saved branch',()=>{
  const saved=[...pair('q1'),...pair('q2'),...pair('q3')];
  const edit=task('t4','t4:user',undefined,{editMessageId:'q2',state:'running',saveState:'pending',partial:'新回答',result:null});
  const downstream=task('t3','q3',saved[5],{createdAt:'t3'});
  const preview=ragAnswerVersions(saved,[downstream,edit],new Map());
  assert.deepEqual(preview.messages.filter(m=>m.role==='user').map(m=>m.id),['q1','t4:user']);
  assert.equal(saved.length,6);
  for(const state of ['failed','cancelled','interrupted']) {
    const restored=ragAnswerVersions(saved,[downstream,{...edit,state}],new Map());
    assert.deepEqual(restored.messages.filter(m=>m.role==='user').map(m=>m.id),['q1','q2','q3']);
  }
});

test('versions are scoped by question identity, never repeated wording; canonical content wins',()=>{
  const [q1,old] = pair('q1'), [q2,a2] = pair('q2');
  const t=task('t1','q1',old), current={...old,id:'t1:assistant',content:'authoritative edit'};
  const projection=ragAnswerVersions([q1,current,q2,a2],[t],new Map([['q1',old.id]]));
  assert.equal(projection.messages[1].content,old.content); assert.equal(projection.messages[1].versions.length,2);
  assert.equal(projection.messages[3].content,a2.content); assert.equal(projection.messages[3].versions.length,1);
  assert.equal(projection.historical,true); assert.equal(projection.messages[1].canRegenerate,false);
  const fresh=ragAnswerVersions([q1,current,q2,a2],[t],new Map());
  assert.equal(fresh.messages[1].content,'authoritative edit'); assert.equal(fresh.historical,false);
  assert.equal(fresh.messages[3].canRegenerate,true);
  assert.equal(projection.messages[1].citations[0].date,'2026-01-01');
  assert.equal(fresh.messages[1].citations[0].date,'2026-01-01');
});
test('unassociated retained legacy results stay separate and save/discard address their task',()=>{
  const saved=pair('q1'), legacy=task('old',undefined,undefined,{saveState:'error',replaceLast:true,saveError:'save failed'});
  const p=ragAnswerVersions(saved,[legacy],new Map());
  assert.equal(p.messages.length,4); assert.equal(p.messages[1].versions.length,1);
  assert.equal(p.messages[3].taskId,'old'); assert.equal(p.messages[3].canSave,true);assert.equal(p.messages[3].canDiscard,true);
});
test('partial, stopped and failed replacements retain the old answer and retry only the newest task',()=>{
  const saved=pair('q1'), cancelled=task('t1','q1',saved[1],{saveState:'pending',state:'cancelled',result:null,partial:'partial'});
  const running=task('t2','q1',saved[1],{saveState:'pending',state:'running',result:null,partial:'new partial'});
  const p=ragAnswerVersions(saved,[cancelled,running],new Map([['q1','t1:assistant']]));
  assert.equal(p.messages[1].content,'partial');assert.equal(p.messages[1].canRetry,false);assert.equal(p.messages[1].canRegenerate,false);
  const current=ragAnswerVersions(saved,[cancelled,running],new Map());assert.equal(current.messages[1].status,'streaming');assert.equal(current.messages[1].content,'new partial');
});
test('an unassociated earlier failed attempt stays before a later saved question without a text match',()=>{
  const current=pair('t2:user'); current[1].id='t2:assistant';
  const failed=task('t1',undefined,undefined,{createdAt:'1',state:'failed',saveState:'pending',result:null,partial:'earlier partial'});
  const saved=task('t2','t2:user',undefined,{createdAt:'2'});
  const p=ragAnswerVersions(current,[failed,saved],new Map());
  assert.equal(p.messages.length,4);assert.equal(p.messages[1].content,'earlier partial');
  assert.equal(p.messages[3].id,'t2:assistant');assert.equal(p.messages[3].canRegenerate,true);assert.equal(p.messages[1].canRetry,false);
});
test('a saved task stays visible while canonical reading is pending, without using the execution transcript as history',()=>{
  const old=pair('q1'), current=task('t2','q1',old[1]);
  const p=ragAnswerVersions(old,[current],new Map(),current.id);
  assert.equal(p.messages.length,2);assert.equal(p.messages[1].id,'t2:assistant');assert.equal(new Set(p.messages.map(m=>m.id)).size,2);
  const initial=ragAnswerVersions([],[current],new Map(),current.id);assert.equal(initial.messages.length,2);assert.equal(initial.messages[1].id,'t2:assistant');
});
