import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserScope } from '../../../test/browser/browser-scope.mjs';

test('actual editor and reader publish user scrolling, accept peer progress and suppress echoes', async () => {
  const scope = await createBrowserScope();
  try {
    const editor = await scope.newPage({ viewport: { width: 640, height: 600 } });
    const reader = await scope.newPage({ viewport: { width: 640, height: 600 } });
    await editor.addInitScript(() => {
      window.events = []; window.editorBridge = { message: raw => window.events.push(JSON.parse(raw)) };
    });
    await reader.addInitScript(() => {
      window.events = []; window.readerFrames = { activeHeading() {},
        splitScroll: (key, progress) => window.events.push({ key, progress }) };
    });
    await editor.goto(new URL('../../../entry/src/main/resources/rawfile/editor/index.html', import.meta.url).href);
    await reader.goto(new URL('../../../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url).href);
    const text = Array.from({ length: 60 }, (_, i) => `### Section ${i}\n\nSynthetic paragraph ${'text '.repeat(40)}\n\n\`\`\`js\nconst n = ${i};\n\`\`\`\n`).join('\n');
    await editor.evaluate(async text => {
      await window.editorRequest({ action: 'load', documentKey: 'synthetic:1', requestId: 1, text });
      window.configureEditorSplitScroll('synthetic:1', true);
    }, text);
    await reader.evaluate(async text => {
      await window.renderMarkdown(text, '', 'light', 'log');
      window.configureReaderSplitScroll('synthetic:1', true);
    }, text);
    await editor.mouse.move(320, 300); await editor.mouse.wheel(0, 1000);
    await editor.waitForFunction(() => window.events.some(e => e.type === 'scroll'));
    await editor.waitForTimeout(250);
    const first = await editor.evaluate(() => window.events.filter(e => e.type === 'scroll').at(-1));
    assert.ok(first.progress > 0 && first.progress < 1);
    await reader.evaluate(packet => window.applyReaderSplitScroll(packet), { key: first.documentKey, progress: first.progress });
    await reader.waitForTimeout(150);
    const ratio = await reader.evaluate(() => window.scrollY / (document.documentElement.scrollHeight - innerHeight));
    assert.ok(Math.abs(ratio - first.progress) < 0.002); assert.deepEqual(await reader.evaluate(() => window.events), []);
    await reader.mouse.move(320, 300); await reader.mouse.wheel(0, 900);
    await reader.waitForFunction(() => window.events.length > 0); await reader.waitForTimeout(250);
    const reverse = await reader.evaluate(() => window.events.at(-1));
    const count = await editor.evaluate(() => window.events.filter(e => e.type === 'scroll').length);
    await editor.evaluate(packet => window.applyEditorSplitScroll(packet), reverse);
    await editor.waitForTimeout(150);
    const editorRatio = await editor.locator('.cm-scroller').evaluate(e => e.scrollTop / (e.scrollHeight - e.clientHeight));
    assert.ok(Math.abs(editorRatio - reverse.progress) < 0.002);
    assert.equal(await editor.evaluate(() => window.events.filter(e => e.type === 'scroll').length), count);
    await reader.evaluate(() => { window.events.length = 0; window.scrollToTop(); });
    await reader.waitForFunction(() => window.events.some(e => e.progress === 0));
    const top = await reader.evaluate(() => window.events.at(-1));
    await editor.evaluate(packet => window.applyEditorSplitScroll(packet), top);
    assert.equal(await editor.locator('.cm-scroller').evaluate(e => e.scrollTop), 0);
    await editor.evaluate(async text => window.editorRequest({ action: 'replace', documentKey: 'synthetic:1', requestId: 10, text: text + '\n新增合成编辑' }), text);
    await editor.setViewportSize({ width: 480, height: 420 }); await reader.setViewportSize({ width: 480, height: 420 });
    await reader.mouse.move(200, 200); await reader.mouse.wheel(0, 900); await reader.waitForTimeout(250);
    const resized = await reader.evaluate(() => window.events.at(-1));
    await editor.evaluate(packet => window.applyEditorSplitScroll(packet), resized); await editor.waitForTimeout(100);
    const resizedRatio = await editor.locator('.cm-scroller').evaluate(e => e.scrollTop / (e.scrollHeight - e.clientHeight));
    assert.ok(Math.abs(resizedRatio - resized.progress) < 0.002);
    await editor.evaluate(async () => window.editorRequest({ action: 'undo', documentKey: 'synthetic:1', requestId: 11 }));
    assert.equal(await editor.evaluate(() => window.events.find(e => e.type === 'result' && e.requestId === 11).text), text,
      'scroll synchronization does not add edits or consume undo history');
    await reader.evaluate(() => window.configureReaderSplitScroll('synthetic:1', false));
    const previous = await reader.evaluate(() => window.scrollY);
    await reader.evaluate(() => window.applyReaderSplitScroll({ key: 'synthetic:1', progress: 0 }));
    assert.equal(await reader.evaluate(() => window.scrollY), previous);
    await editor.evaluate(() => window.configureEditorSplitScroll('synthetic:1', false));
    const sourceOffset = await editor.locator('.cm-scroller').evaluate(e => e.scrollTop);
    await editor.evaluate(() => window.applyEditorSplitScroll({ key: 'synthetic:1', progress: 1 }));
    assert.equal(await editor.locator('.cm-scroller').evaluate(e => e.scrollTop), sourceOffset);
    await reader.evaluate(() => window.configureReaderSplitScroll('synthetic:2', true));
    await reader.evaluate(() => window.applyReaderSplitScroll({ key: 'synthetic:1', progress: 1 }));
    assert.equal(await reader.evaluate(() => window.scrollY), previous, 'a prior day cannot move the current reader');
  } finally { await scope.close(); }
});
