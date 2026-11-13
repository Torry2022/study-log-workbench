import test from 'node:test';
import assert from 'node:assert/strict';
import { createSplitScroll } from '../src/split-scroll.js';
function fixture(range = 1000) {
  let offset = 0, next = 0;
  const frames = new Map(), events = [], writes = [];
  const sync = createSplitScroll({ read: () => ({ offset, range }),
    write: value => { offset = value; writes.push(value); }, publish: (key, progress) => events.push({ key, progress }),
    frame: fn => { frames.set(++next, fn); return next; }, cancel: id => frames.delete(id) });
  return { sync, events, writes, frames, set: value => offset = value,
    flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); } };
}
test('split scroll coalesces user events by frame and maps proportion across unequal panes', () => {
  const a = fixture(), b = fixture(3000);
  a.sync.configure('day:1', true); b.sync.configure('day:1', true);
  a.sync.intent(); a.set(250); a.sync.scroll(); a.set(500); a.sync.scroll();
  assert.equal(a.frames.size, 1); a.flush(); assert.deepEqual(a.events, [{ key: 'day:1', progress: 0.5 }]);
  b.sync.apply(a.events[0]); assert.deepEqual(b.writes, [1500]);
  b.sync.scroll(); b.flush(); assert.deepEqual(b.events, [], 'incoming asynchronous scroll must not echo');
  b.sync.intent(); b.set(2400); b.sync.scroll(); b.flush(); a.sync.apply(b.events[0]);
  assert.deepEqual(a.writes, [800]);
});
test('disabled, replaced, queued and malformed packets cannot move a hidden or different document', () => {
  const r = fixture(); r.sync.configure('old', true); r.sync.intent(); r.sync.scroll();
  r.sync.configure('new', true); r.flush(); assert.deepEqual(r.events, []);
  r.sync.apply({ key: 'old', progress: 1 }); r.sync.apply({ key: 'new', progress: NaN });
  assert.deepEqual(r.writes, []);
  r.sync.configure('new', false); r.sync.apply({ key: 'new', progress: 1 });
  r.sync.intent(); r.sync.scroll(); r.flush(); assert.deepEqual(r.writes, []); assert.deepEqual(r.events, []);
});
test('short documents do not drive peers; incoming positions clamp to current geometry', () => {
  const r = fixture(0); r.sync.configure('day', true); r.sync.intent(); r.sync.scroll(); r.flush();
  assert.deepEqual(r.events, []);
  const scrollable = fixture(800); scrollable.sync.configure('day', true);
  scrollable.sync.apply({ key: 'day', progress: 4 }); scrollable.sync.apply({ key: 'day', progress: -1 });
  assert.deepEqual(scrollable.writes, [800, 0]);
});
