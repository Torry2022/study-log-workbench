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

test('phone, tablet and PC frames eject two unequal drops only at each actual contact', () => {
  for (const [width, height] of [[390, 844], [820, 1180], [1440, 900], [2560, 1440]]) {
    for (const rate of [30, 60, 120]) {
      const motion = new LaunchMotion(width / 2 + 48, height / 2 + 48);
      for (let time = 0; time < 1100; time += 1000 / rate) {
        motion.advance(time);
        if (time < 520) assert.equal(motion.drops.length, 0);
        for (const source of motion.drops) {
          assert.ok(source.dy * source.y > 0, 'each drop travels to its contact outer side');
          assert.ok(Math.sin(source.angle) * source.dx - Math.cos(source.angle) * source.dy > .99 * Math.hypot(source.dx, source.dy));
          const drop = motion.frame(source, time);
          assert.ok(drop.opacity >= 0 && drop.opacity <= 1);
          assert.ok(Math.abs(drop.x) < 70 && Math.abs(drop.y) < 70, 'drops stay near the logo');
        }
      }
      assert.equal(motion.drops.length, 4, `${width}/${height}/${rate}`);
      for (let index = 0; index < 4; index += 2) {
        const [large, small] = motion.drops.slice(index, index + 2);
        assert.equal(large.x, small.x); assert.equal(large.y, small.y);
        assert.ok(large.size > small.size && large.duration > small.duration);
        assert.ok(Math.abs(large.angle - small.angle) > .3);
        let previous = 1;
        for (let age = 0; age <= 500; age += 5) {
          const frame = motion.frame(large, large.born + large.delay + age);
          assert.ok(frame.opacity <= previous + .001); previous = frame.opacity;
        }
        const stretched = motion.frame(large, large.born + large.delay + large.duration * .16);
        assert.ok(Math.abs(stretched.scaleY - 2.2) < 1e-9);
        assert.ok(stretched.neckOpacity > .1);
        assert.equal(motion.frame(large, 1100).opacity, 0);
        assert.equal(motion.frame(large, 1100).neckOpacity, 0);
      }
      motion.advance(1100); assert.equal(motion.offset, 0); assert.equal(motion.scale, 1);
    }
  }
});

test('a skipped animation does not emit late drops or leave a partial logo', () => {
  const motion = new LaunchMotion(243, 470);
  motion.advance(1100);
  assert.equal(motion.drops.length, 0); assert.equal(motion.offset, 0);
});

async function host() {
  let source = introSource.replace(/^import .*;\r?\n/gm, '').replace('@Component\nexport struct LaunchIntro', 'export class LaunchIntro');
  const start = source.indexOf('  @Builder'), end = source.indexOf('  aboutToAppear()', start);
  source = source.slice(0, start) + source.slice(end);
  source = source.replace(/@Watch\('[^']+'\)/g, '').replace(/@(State|Prop)\s*/g, '');
  const module = { exports: {} }, timers = new Map(), animators = [], draws = [];
  let next = 0;
  class Canvas {
    clearRect() { draws.push('clear'); } save() {} restore() {} translate() {} rotate() {} scale() {}
    beginPath() {} ellipse() { draws.push('head'); } fill() {} moveTo() {} bezierCurveTo() { draws.push('neck'); } closePath() {}
  }
  runInNewContext(await compile(source), { module, exports: module.exports, LaunchMotion,
    display: { getDefaultDisplaySync: () => ({ width: 390, height: 844, densityPixels: 1 }) },
    CanvasRenderingContext2D: Canvas, RenderingContextSettings: class {}, Curve: { EaseOut: 'ease-out' },
    curves: { springMotion: () => 'spring' }, $r: name => ({ id: name.endsWith('ink') ? 0xff171614 : 0xffd07a5f }),
    setTimeout: (callback, delay) => { timers.set(++next, { callback, delay }); return next; }, clearTimeout: id => timers.delete(id) });
  const intro = new module.exports.LaunchIntro();
  let dismissed = 0;
  intro.onDismissed = () => dismissed++;
  intro.canvasReady = true;
  intro.getUIContext = () => ({
    getHostContext: () => ({ resourceManager: { getColorSync: id => id } }),
    animateTo: (options, change) => { change(); options.onFinish?.(); },
    createAnimator: options => {
      const animator = { options, play() {}, finish() { this.onFrame(1100); } };
      animators.push(animator); return animator;
    }
  });
  const fire = delay => { for (const [id, item] of timers) if (item.delay === delay) { timers.delete(id); item.callback(); return; } assert.fail('missing timer ' + delay); };
  return { intro, timers, animators, draws, fire, dismissed: () => dismissed };
}

test('native intro shares one timeline for painted drops and SVG positions and exits when ready', async () => {
  const h = await host(); h.intro.ready = true; h.intro.aboutToAppear(); h.fire(32);
  const animator = h.animators[0];
  for (let t = 0; t <= 650; t += 5) animator.onFrame(t);
  assert.ok(h.draws.includes('head') && h.draws.includes('neck'));
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

test('native droplet colors match the logo in light and dark modes', async () => {
  for (const mode of ['base', 'dark']) {
    const colors = JSON.parse(await fs.readFile(new URL(`resources/${mode}/element/color.json`, main), 'utf8')).color;
    const svg = await fs.readFile(new URL(`resources/${mode}/media/launch_nodes.svg`, main), 'utf8');
    const ink = await fs.readFile(new URL(`resources/${mode}/media/launch_top.svg`, main), 'utf8');
    assert.ok(svg.toLowerCase().includes(colors.find(c => c.name === 'launch_coral').value.toLowerCase()));
    assert.ok(ink.toLowerCase().includes(colors.find(c => c.name === 'launch_ink').value.toLowerCase()));
  }
});
