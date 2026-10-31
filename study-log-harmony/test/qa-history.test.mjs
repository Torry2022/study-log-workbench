import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, session, qaView, plain } from './qa-task-fixture.mjs';
import { ragHistoryPage } from '../../study-log-web/lib/rag-history.ts';

async function historyFixture(t, tasks = true) {
  const f = await fixture(), full = session(undefined, { messageCount: 110, messages: Array.from({length:55},(_,i)=>[
    {id:`q${i}`,role:'user',content:`合成问题 ${i}`}, {id:`a${i}`,role:'assistant',content:`合成回答 ${i}`,status:'complete'}]).flat() });
  f.sessions.set(full.id,full); const reads=[];
  f.transport.get=async path=>{
    const url=new URL(path,'http://synthetic.invalid'); reads.push(url);
    if(url.pathname==='/rag/sessions')return {sessions:[full]};
    assert.equal(url.pathname,`/rag/sessions/${full.id}`);
    return {session:plain(url.searchParams.get('history')==='recent'?ragHistoryPage(full,Object.fromEntries(url.searchParams)):full)};
  };
  if(tasks)await f.client.connect();
  const controller=new f.QaSessionController(f.transport,qaView(),tasks?f.client:undefined);t.after(()=>controller.dispose());
  await controller.openSession(full.id);return {...f,controller,full,reads};
}
test('native paged reads and direct target loading keep whole rounds and latest context',async t=>{
  const f=await historyFixture(t);assert.equal(f.controller.visibleAnswerMessages().length,20);
  assert.equal(f.controller.historyWindow.start,90);
  await f.controller.loadEarlier('q25');
  assert.equal(f.controller.visibleAnswerMessages()[0].id,'q20');assert.equal(f.controller.visibleAnswerMessages().at(-1).id,'a54');
  assert.equal(f.reads.filter(url=>url.searchParams.has('around')).length,1);
  await f.controller.loadEarlier();assert.equal(f.controller.visibleAnswerMessages()[0].id,'q10');
  assert.equal(f.controller.historyError,'');assert.equal(f.controller.historyLoading,false);
});
test('native complete write hydration preserves hidden prefix without expanding the reader',async t=>{
  const f=await historyFixture(t,false);assert.equal(f.controller.messages.length,20);
  assert.equal(await f.controller.completeForWrite(),true);
  assert.equal(f.controller.messages.length,110);assert.equal(f.controller.visibleAnswerMessages().length,20);
  assert.equal(f.controller.messages[0].id,'q0');assert.equal(f.controller.messages.at(-1).id,'a54');
});
test('native failed history read can retry without replacing current messages',async t=>{
  const f=await historyFixture(t), get=f.transport.get;
  f.transport.get=async()=>{throw Error('合成离线');};await f.controller.loadEarlier();
  assert.equal(f.controller.visibleAnswerMessages().length,20);assert.ok(f.controller.historyError);
  f.transport.get=get;await f.controller.loadEarlier();assert.equal(f.controller.visibleAnswerMessages().length,40);assert.equal(f.controller.historyError,'');
});
test('native late prepend cannot install after switching conversations',async t=>{
  const f=await historyFixture(t);let resolve;
  f.transport.get=async()=>new Promise(done=>{resolve=done;});
  const loading=f.controller.loadEarlier();await f.controller.newSession();
  resolve({session:ragHistoryPage(f.full,{before:'q45'})});await loading;
  assert.equal(f.controller.sessionId,'');assert.equal(f.controller.messages.length,0);assert.equal(f.controller.historyLoading,false);
});
