import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const compile = async source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const main = new URL('../entry/src/main/', import.meta.url);
const motionSource = await fs.readFile(new URL('ets/app/components/LaunchMotion.ets', main), 'utf8');
const introSource = await fs.readFile(new URL('ets/app/components/LaunchIntro.ets', main), 'utf8');
const motionModule = { exports: {} };
runInNewContext(await compile(motionSource), { module: motionModule, exports: motionModule.exports });
const { LaunchMotion } = motionModule.exports;

test('phone, tablet and PC keep the logo gathering, contact compression and settled rebound', () => {
  for (const [width, height] of [[390, 844], [820, 1180], [1440, 900], [2560, 1440]]) {
    for (const rate of [30, 60, 120]) {
      const motion = new LaunchMotion(width / 2 + 48, height / 2 + 48);
      const frames = [];
      for (let time = 0; time <= 1100; time += 1000 / rate) {
        motion.advance(time); frames.push({ time, x: motion.x, scale: motion.scale });
        if (time < 520) assert.equal(motion.scale, 1, 'no impact before the layers meet');
      }
      assert.ok(frames[0].x > width / 2, 'gather begins outside the viewport');
      assert.ok(frames.some(frame => frame.x < 0), 'gather retains its spring overshoot');
      assert.ok(frames.some(frame => frame.scale < .98), 'contact compresses the logo');
      assert.ok(frames.some(frame => frame.scale > 1.02), 'compression is followed by a rebound');
      motion.advance(1100);
      assert.equal(motion.offset, 0); assert.equal(motion.x, 0); assert.equal(motion.y, 0); assert.equal(motion.scale, 1);
    }
  }
});

test('a skipped animation leaves a complete logo without a late impact', () => {
  const motion = new LaunchMotion(243, 470);
  motion.advance(1100);
  assert.equal(motion.offset, 0); assert.equal(motion.scale, 1);
});

async function host() {
  let source = introSource.replace(/^import .*;\r?\n/gm, '').replace('@Component\nexport struct LaunchIntro', 'export class LaunchIntro');
  const start = source.indexOf('  @Builder'), end = source.indexOf('  aboutToAppear()', start);
  source = source.slice(0, start) + source.slice(end);
  source = source.replace(/@Watch\('[^']+'\)/g, '').replace(/@(State|Prop)\s*/g, '');
  const module = { exports: {} }, timers = new Map(), animators = [];
  let next = 0;
  runInNewContext(await compile(source), { module, exports: module.exports, LaunchMotion,
    display: { getDefaultDisplaySync: () => ({ width: 390, height: 844, densityPixels: 1 }) },
    Curve: { EaseOut: 'ease-out' },
    curves: { springMotion: () => 'spring' },
    setTimeout: (callback, delay) => { timers.set(++next, { callback, delay }); return next; }, clearTimeout: id => timers.delete(id) });
  const intro = new module.exports.LaunchIntro();
  let dismissed = 0;
  intro.onDismissed = () => dismissed++;
  intro.getUIContext = () => ({
    animateTo: (options, change) => { change(); options.onFinish?.(); },
    createAnimator: options => {
      const animator = { options, play() {}, finish() { this.onFrame(1100); } };
      animators.push(animator); return animator;
    }
  });
  const fire = delay => { for (const [id, item] of timers) if (item.delay === delay) { timers.delete(id); item.callback(); return; } assert.fail('missing timer ' + delay); };
  return { intro, timers, animators, fire, dismissed: () => dismissed };
}

test('native intro keeps the logo motion and exits when ready', async () => {
  const h = await host(); h.intro.ready = true; h.intro.aboutToAppear(); h.fire(32);
  const animator = h.animators[0];
  let overshot = false;
  for (let t = 0; t <= 650; t += 5) { animator.onFrame(t); overshot ||= h.intro.gatherX < 0; }
  assert.ok(overshot, 'SVG layers retain their rebound');
  assert.doesNotMatch(introSource, /Canvas\(|drawDrops|LaunchDrop/);
  h.fire(410); h.fire(470); assert.equal(h.dismissed(), 0);
  animator.onFrame(700); assert.equal(h.dismissed(), 1);
  h.intro.aboutToDisappear(); animator.onFrame(1100);
  assert.equal(h.intro.animator, undefined); assert.equal(h.timers.size, 0); assert.equal(h.dismissed(), 1);
});

test('waiting for data, early removal and warm re-entry keep their lifecycle boundaries', async () => {
  const early = await host(); early.intro.aboutToAppear(); early.intro.aboutToDisappear();
  assert.equal(early.timers.size, 0); assert.equal(early.animators.length, 0);
  const h = await host(); h.intro.aboutToAppear(); h.fire(32); h.fire(410); h.fire(470);
  h.animators[0].onFrame(1100); assert.equal(h.dismissed(), 0); assert.equal(h.intro.loadingVisible, true);
  h.intro.ready = true; h.intro.readyChanged(); assert.equal(h.dismissed(), 1);
  h.intro.aboutToDisappear(); assert.equal(h.timers.size, 0);
});
