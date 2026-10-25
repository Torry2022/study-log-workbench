import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { _electron: electron, expect } = createRequire(repository + '/study-log-web/package.json')('@playwright/test');
const packaged = process.argv[2] && process.argv[2] !== 'source';
const executablePath = packaged ? path.resolve(process.argv[2]) : createRequire(import.meta.url)('electron');
const payload = packaged ? path.join(path.dirname(executablePath), 'resources/payload') : repository;
const output = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'study-log-startup-' + Date.now()));
await fs.mkdir(output, { recursive: true });
const { DesktopManager } = await import(pathToFileURL(payload + '/ops/desktop/manager.mjs'));
const fixture = path.join(output, 'fixture');
const manager = new DesktopManager({ packageRoot: payload });
await manager.select({ root: fixture, create: true, password: crypto.randomUUID() });
const report = { packaged: Boolean(packaged), passed: [], runs: [], installedOnUserMachine: false };
let application;
const observedMessages = new WeakMap();
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
async function profile(name, remote) {
  const base = path.join(output, name), instance = path.join(base, 'instance'), profile = path.join(base, 'profile');
  await fs.mkdir(profile, { recursive: true });
  await fs.cp(fixture, instance, { recursive: true });
  await fs.writeFile(path.join(profile, 'desktop.json'), JSON.stringify(remote
    ? { usageConfirmed: true, mode: 'remote', remote }
    : { usageConfirmed: true, mode: 'local', root: instance, preserved: name }));
  return { base, instance, profile };
}
async function start(f) {
  application = await electron.launch({ executablePath, args: packaged ? [] : [repository + '/ops/electron'],
    env: { ...env, STUDY_LOG_DESKTOP_PROFILE: f.profile }, timeout: 60000 });
  await expect.poll(() => application.context().pages().some(p => p.url().includes('startup.html'))).toBe(true);
  const page = application.context().pages().find(p => p.url().includes('startup.html'));
  const messages = []; observedMessages.set(page, messages);
  await page.exposeFunction('recordStartupMessage', text => messages.push(text));
  await page.evaluate(() => {
    const message = document.getElementById('message');
    window.recordStartupMessage(message.textContent);
    new MutationObserver(() => window.recordStartupMessage(message.textContent)).observe(message, { childList: true });
  });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some(w => w.webContents.getURL().includes('startup.html') && w.isVisible()))).toBe(true);
  await expect.poll(() => page.locator('.mark img').evaluateAll(images => images.length === 8 && images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  return page;
}
async function closeApplication() {
  if (!application) return;
  const closed = application.waitForEvent('close', { timeout: 60000 });
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await closed; application = null;
}
async function marks() {
  return application.evaluate(() => performance.getEntriesByType('mark')
    .filter(m => m.name.startsWith('desktop:')).map(m => ({ name: m.name, ms: m.startTime, ...(m.detail ? { detail: m.detail } : {}) })));
}
async function workspace() {
  await expect.poll(() => application.context().pages().some(p => /^http:/.test(p.url())), { timeout: 60000 }).toBe(true);
  const page = application.context().pages().find(p => /^http:/.test(p.url()));
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60000 });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(w => w.isVisible()).map(w => w.webContents.getURL()).every(url => !url.includes('startup.html')))).toBe(true);
  return page;
}

const capabilities = { apiContractVersion: 1, instanceId: crypto.randomUUID(), features: Object.fromEntries(
  ['aiWriting', 'aiHighlighting', 'aiNoteExtraction', 'aiTaxonomy', 'rag'].map(key => [key, { supported: true, configured: false }])) };
let remoteAvailable = true;
const server = http.createServer((request, response) => {
  if (request.url.endsWith('/api/capabilities')) {
    response.writeHead(remoteAvailable ? 200 : 401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(remoteAvailable ? capabilities : { error: 'synthetic expired connection' }));
  } else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<html><title>启动验收</title><body class="workspace">隔离服务器页面</body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const remote = { mode: 'remote', origin: `http://127.0.0.1:${server.address().port}`, instanceId: capabilities.instanceId, localHttp: true };
try {
  const f = await profile('local');
  for (const run of ['first', 'reopen']) {
    const began = performance.now(), startup = await start(f);
    await expect(startup.locator('#message')).toHaveText('正在准备工作台…');
    assert.equal(await startup.locator('.mark img').count(), 8);
    assert.equal(await startup.evaluate(() => typeof window.require), 'undefined');
    await application.evaluate(({ app }) => app.emit('second-instance'));
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length), 1);
    if (run === 'first') {
      await expect(startup.locator('body')).toHaveClass(/intro-playing/);
      const intro = await startup.evaluate(async () => {
        const images = [...document.querySelectorAll('.mark img')].filter(image => getComputedStyle(image).display !== 'none');
        const animation = images[0].getAnimations()[0], samples = [];
        const record = () => samples.push({ time: animation.currentTime,
          scale: new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.mark')).transform).m11,
          fragmentOpacity: Math.max(...[...document.querySelectorAll('.fragment')].map(fragment => Number(getComputedStyle(fragment).opacity))),
          fragmentSpread: Math.max(...[...document.querySelectorAll('.fragment')].map(fragment => Math.abs(new DOMMatrixReadOnly(getComputedStyle(fragment).transform).m41))),
          layers: images.map(image => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
          return { x: matrix.m41, y: matrix.m42 };
        }) });
        while (animation.playState !== 'finished') { record(); await new Promise(requestAnimationFrame); }
        record();
        return { duration: animation.effect.getTiming().duration, delay: animation.effect.getTiming().delay, samples };
      });
      assert.equal(intro.delay, 300);
      assert.equal(intro.samples[0].layers.length, 4);
      assert.ok(intro.samples.some(sample => Math.abs(sample.layers[0].x) > 50), 'gathering must visibly travel from outside the logo');
      assert.ok(intro.samples.some(sample => sample.layers[0].x > 0), 'gathering must retain its spring overshoot');
      assert.ok(intro.samples.some(sample => sample.scale < .99), 'contact must include a short compression');
      assert.ok(intro.samples.some(sample => sample.fragmentOpacity > .1), 'fragments must appear briefly at contact');
      assert.ok(intro.samples.some(sample => sample.fragmentSpread > 60), 'confetti must spread clearly beyond the logo');
      assert.ok(intro.samples.at(-1).layers.every(layer => Math.abs(layer.x) < .01 && Math.abs(layer.y) < .01));
      await fs.writeFile(path.join(output, 'intro-motion.json'), JSON.stringify(intro, null, 2));
      for (const scheme of ['light', 'dark']) {
        await startup.emulateMedia({ colorScheme: scheme });
        await expect(startup.locator('.mark-frame')).toHaveCSS('background-color', scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(28, 26, 23)');
        await startup.evaluate(() => Promise.all(document.querySelector('.mark').getAnimations({ subtree: true }).map(animation => animation.finished)) );
        assert.deepEqual((await startup.locator('.fragment').evaluateAll(fragments => [...new Set(fragments.map(fragment => getComputedStyle(fragment).backgroundColor))])).sort(),
          (scheme === 'light' ? ['rgb(208, 122, 95)', 'rgb(23, 22, 20)'] : ['rgb(212, 135, 106)', 'rgb(245, 240, 232)']).sort());
        await startup.screenshot({ path: path.join(output, 'startup-' + scheme + '.png') });
      }
      await startup.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await startup.locator('.spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await startup.locator('.fragment').count(), 28);
      assert.equal(await startup.locator('.fragment').first().evaluate(el => getComputedStyle(el).animationName), 'none');
    }
    const page = await workspace(), entries = await marks();
    assert.deepEqual([...new Set(observedMessages.get(startup))], ['正在准备工作台…', '正在读取学习记录…', '正在载入界面…']);
    const stages = entries.filter(m => m.name === 'desktop:stage').map(m => m.detail);
    assert.deepEqual([...new Set(stages)], ['正在准备工作台…', '正在读取学习记录…', '正在载入界面…']);
    const time = name => entries.find(m => m.name === 'desktop:' + name)?.ms;
    assert.ok(time('feedback') < time('services'));
    assert.ok(time('feedback') - time('ready') < 2000);
    assert.ok(time('visible') - time('page-loaded') < 250);
    await expect(page.locator('.day-tag').first()).toHaveCSS('font-weight', '500');
    report.runs.push({ run, wallReady: performance.now() - began, marks: entries });
    await closeApplication();
    await assert.rejects(fs.stat(path.join(f.instance, 'data/.instance-operation.lock')), { code: 'ENOENT' });
  }
  report.passed.push('real startup messages, local service readiness, single-instance focus, both themes, reduced motion, 500-weight labels and clean reopen');

  for (const phase of ['early', 'services', 'session-end']) {
    const f = await profile('cancel-' + phase), original = await fs.readFile(path.join(f.profile, 'desktop.json'));
    const startup = await start(f);
    if (phase === 'services') await expect.poll(async () => {
      try { return JSON.parse(await fs.readFile(path.join(f.instance, 'data/.instance-operation.lock/owner.json'))).operation === 'desktop-services'; }
      catch { return false; }
    }, { timeout: 60000 }).toBe(true);
    const opened = []; application.on('window', page => opened.push(page));
    const closed = application.waitForEvent('close', { timeout: 60000 });
    if (phase === 'session-end') await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('startup.html')).emit('session-end', {}));
    else await startup.getByRole('button', { name: '关闭', exact: true }).click();
    await closed; application = null;
    assert.equal(opened.some(page => /^http:/.test(page.url())), false);
    await assert.rejects(fs.stat(path.join(f.instance, 'data/.instance-operation.lock')), { code: 'ENOENT' });
    if (phase !== 'services') assert.deepEqual(await fs.readFile(path.join(f.profile, 'desktop.json')), original);
    report.passed.push('closing during ' + phase + ' preparation preserves preferences and leaves no service lock or late workspace');
  }

  const fast = await profile('remote', remote), began = performance.now();
  await start(fast); await workspace();
  const remoteMarks = await marks(), at = name => remoteMarks.find(m => m.name === 'desktop:' + name).ms;
  assert.deepEqual([...new Set(remoteMarks.filter(m => m.name === 'desktop:stage').map(m => m.detail))],
    ['正在准备工作台…', '正在连接服务器…', '正在载入界面…']);
  assert.ok(at('visible') - at('page-loaded') < 250, 'ready remote page must not wait for a forced animation duration or redundant preference write');
  report.runs.push({ run: 'remote-http-fixture', wallReady: performance.now() - began, marks: remoteMarks });
  await closeApplication(); report.passed.push('ready remote transport fixture closes feedback immediately');

  remoteAvailable = false;
  const failed = await profile('remote-failed', remote); await start(failed);
  await expect.poll(() => application.context().pages().some(p => p.url().includes('connection.html')), { timeout: 15000 }).toBe(true);
  const chooser = application.context().pages().find(p => p.url().includes('connection.html'));
  await expect(chooser.locator('#notice')).toContainText('请重新连接服务器');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().includes('startup.html'))), false);
  await chooser.screenshot({ path: path.join(output, 'remote-fallback.png') });
  await closeApplication(); report.passed.push('expired server connection returns to chooser without a stranded startup window');
  report.success = true;
} finally {
  await closeApplication(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, passed: report.passed, output, runs: report.runs }));
}
