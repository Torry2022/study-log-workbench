import test from 'node:test';
import assert from 'node:assert/strict';
import { originalRagMessageTimes, ragTimeSeparators } from '../lib/rag-message-time.ts';

test('only the creating task timestamps a question; missing originals remain unknown',()=>{
 const original={id:'t1',createdAt:'2026-10-01T00:00:00Z',questionMessageId:'t1:user',replaceLast:false};
 const retry={...original,id:'retry',createdAt:'2026-10-02T00:00:00Z'};
 const regen={...original,id:'regen',replaceLast:true,createdAt:'2026-10-03T00:00:00Z'};
 assert.deepEqual([...originalRagMessageTimes([original,retry,regen])],[['t1:user',original.createdAt]]);
 assert.equal(originalRagMessageTimes([retry,regen]).size,0);
 assert.equal(originalRagMessageTimes([{...original,createdAt:'invalid'}]).size,0);
});
test('time separators mark the first known, exact thirty-minute gap and Shanghai date boundary',()=>{
 const times=new Map([['a','2026-10-01T15:00:00Z'],['b','2026-10-01T15:29:00Z'],['c','2026-10-01T15:59:00Z'],['d','2026-10-01T16:00:00Z']]);
 const result=ragTimeSeparators(['legacy','a','b','unknown','c','d'],times);
 assert.deepEqual([...result.keys()],['a','c','d']);
 assert.equal(result.get('a').label,'2026-10-01 23:00');assert.equal(result.get('c').label,'23:59');
 assert.equal(result.get('d').label,'2026-10-02 00:00');assert.equal(result.has('legacy'),false);
});
