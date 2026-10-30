import test from 'node:test';
import assert from 'node:assert/strict';
import { originalRagMessageTimes, ragTimeSeparators, ragTimeLabel } from '../lib/rag-message-time.ts';

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
 const result=ragTimeSeparators(['legacy','a','b','unknown','c','d'],times,new Date("2026-10-30T04:00:00Z"));
 assert.deepEqual([...result.keys()],['a','c','d']);
 assert.equal(result.get('a').label,'10月1日 23:00');assert.equal(result.get('c').label,'23:59');
 assert.equal(result.get('d').label,'10月2日 00:00');assert.equal(result.has('legacy'),false);
});

test('relative labels use Shanghai calendar days, keep the year across years and never call a future date a weekday', () => {
  const now = new Date('2026-01-05T16:05:00Z'); // Jan 6, 00:05 in Shanghai.
  for (const [input, expected] of [
    ['2026-01-05T16:00:00Z', '今天 00:00'],
    ['2026-01-05T15:59:00Z', '昨天 23:59'],
    ['2026-01-04T04:00:00Z', '星期日 12:00'],
    ['2025-12-30T04:00:00Z', '2025年12月30日 12:00'],
    ['2026-01-07T04:00:00Z', '1月7日 12:00']
  ]) assert.equal(ragTimeLabel(new Date(input), now), expected);
});
