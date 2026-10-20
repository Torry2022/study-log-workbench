import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await fs.readFile(new URL('../hooks/use-smooth-rag-answer.ts', import.meta.url), 'utf8');

// Execute the actual hook with deterministic hook slots and animation frames.
// Browser checks cover DOM/layout; this checks that hidden retained views own no clock.
function fixture() {
  const slots = [], effects = [], frames = new Map(); let cursor = 0, time = 0, nextFrame = 0;
  const effect = (run, deps) => {
    const index = cursor++, old = slots[index];
    if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
  };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useEffect: effect, useLayoutEffect: effect
  };
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, require: () => react, performance: { now: () => time },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id),
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  });
  const render = (content, enabled = true, navigation = 1) => {
    cursor = 0; const value = module.exports.useSmoothRagAnswer({ id: 'answer', role: 'assistant', status: 'streaming', content }, true, navigation, 0, enabled);
    for (const run of effects.splice(0)) run(); return value;
  };
  return { render, frames, step(ms) { time += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); } };
}

test('hiding a retained QA module cancels its single frame and reopening exposes the received snapshot without replay', () => {
  const f = fixture(), baseline = '已接收的正文。', burst = '新增中文👩🏽‍💻。'.repeat(180);
  f.render(baseline); f.render(baseline);
  f.render(baseline + burst); assert.equal(f.frames.size, 1);
  f.step(60); const middle = f.render(baseline + burst);
  assert.ok(middle.content.length > baseline.length && middle.content.length < baseline.length + burst.length);
  assert.equal(f.frames.size, 1);
  assert.equal(f.render(baseline + burst, false).pending, false); assert.equal(f.frames.size, 0);
  const current = baseline + burst + '隐藏时已收到的尾部';
  f.render(current, false); assert.equal(f.frames.size, 0);
  assert.equal(f.render(current).content, current); assert.equal(f.frames.size, 0);
  f.render(current + burst); assert.equal(f.frames.size, 1);
  f.dispose(); assert.equal(f.frames.size, 0);
});

test('a new navigation identity drops a prior queue even when the restored answer ID is the same', () => {
  const f = fixture(); f.render('旧快照'); f.render('旧快照' + '新增'.repeat(400));
  assert.equal(f.frames.size, 1);
  assert.equal(f.render('当前实例快照', true, 2).content, '当前实例快照');
  assert.equal(f.frames.size, 0); f.dispose();
});
