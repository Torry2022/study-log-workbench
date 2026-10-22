import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserScope } from './browser-scope.mjs';

test('inline user editor keeps its DOM, caret, focus and composing text across answer and copied-state rerenders', async () => {
  const browser = await createBrowserScope();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('../../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url).href);
    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(async () => {
        window.editEvents = [];
        window.readerFrames = { qaQuestionEdit: (...args) => window.editEvents.push(args) };
        window.qaPayload = [{ id: 'q', role: 'user', content: '原问题\n[S1]', canEdit: true,
          editToken: 'token', editContent: '初始草稿', documentKey: 'session:1' },
        { id: 'a', role: 'assistant', content: '回答' }];
        await window.renderMarkdown(JSON.stringify(window.qaPayload), '', 'light', 'qa');
      });
      const editor = page.locator('.qa-question-editor');
      await editor.focus();
      await editor.evaluate(node => {
        window.originalEditor = node; node.value = '正在输入\n[S1]'; node.setSelectionRange(2, 4);
        node.dispatchEvent(new CompositionEvent('compositionstart', { data: '中' }));
        node.dispatchEvent(new InputEvent('input', { data: '中', isComposing: true }));
      });
      await page.evaluate(async () => {
        window.qaPayload[0].copied = true; window.qaPayload[0].editContent = '陈旧的服务端草稿';
        window.qaPayload[1].content = '回答更新';
        await window.renderMarkdown(JSON.stringify(window.qaPayload), '', 'dark', 'qa');
      });
      assert.deepEqual(await editor.evaluate(node => [node === window.originalEditor, document.activeElement === node, node.value, node.selectionStart, node.selectionEnd]),
        [true, true, '正在输入\n[S1]', 2, 4]);
      await editor.press('Enter');
      assert.equal(await page.evaluate(() => window.editEvents.filter(e => e[3] === 'send').length), 0, 'IME confirmation never sends');
      await editor.dispatchEvent('compositionend', { data: '中' });
      await page.locator('.qa-edit-send').click();
      const sent = await page.evaluate(() => window.editEvents.find(e => e[3] === 'send'));
      assert.deepEqual(sent, ['session:1', 'q', 'token', 'send', await editor.inputValue()]);
      await page.evaluate(async () => {
        window.qaPayload[0].canEdit = false; window.qaPayload[0].editBusy = true;
        await window.renderMarkdown(JSON.stringify(window.qaPayload), '', 'light', 'qa');
      });
      assert.equal(await editor.getAttribute('readonly'), '');
      assert.equal(await page.locator('.qa-edit-send').isDisabled(), true);
      assert.equal(await page.locator('.qa-edit-cancel').isDisabled(), true);
      await page.evaluate(async () => {
        window.qaPayload[0].editBusy = false;
        await window.renderMarkdown(JSON.stringify(window.qaPayload), '', 'light', 'qa');
      });
      assert.equal(await editor.getAttribute('readonly'), null, 'offline/unavailable service does not trap the draft in a readonly editor');
      assert.equal(await page.locator('.qa-edit-cancel').isEnabled(), true, 'cancel is a local action, independent of server readiness');
      await editor.fill('离线继续编辑');
      assert.equal(await page.locator('.qa-edit-send').isDisabled(), true, 'typing cannot re-enable send while the service is unavailable');
      assert.equal(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth), true);
      // A new identity must not reuse the old editor, even for the same message.
      await page.evaluate(async () => {
        window.qaPayload[0].editToken = `token-${Math.random()}`; window.qaPayload[0].canEdit = true;
        await window.renderMarkdown(JSON.stringify(window.qaPayload), '', 'light', 'qa');
      });
      assert.equal(await editor.evaluate(node => node === window.originalEditor), false);
    }
  } finally { await browser.close(); }
});

test('user copy and edit stay visible on touch widths and time labels remain plain text', async () => {
  const browser = await createBrowserScope();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('../../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url).href);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.evaluate(() => window.renderMarkdown(JSON.stringify([
      { id: 'q', role: 'user', content: '逐字复制\n[S1]', canEdit: true, editSupported: true, timeLabel: '<img src=x onerror=alert(1)>时间' },
      { id: 'a', role: 'assistant', content: '回答' }
    ]), '', 'light', 'qa'));
    assert.equal(await page.locator('.qa-user-actions a').count(), 2);
    assert.equal(await page.locator('.qa-user-actions a').first().isVisible(), true);
    assert.equal(await page.locator('.qa-user-actions a').last().isVisible(), true);
    assert.equal(await page.locator('.qa-message-time img').count(), 0);
    assert.equal(await page.locator('.qa-message-user > p').textContent(), '逐字复制\n[S1]');
    await page.evaluate(() => window.renderMarkdown(JSON.stringify([
      { id: 'q', role: 'user', content: '逐字复制\n[S1]', canEdit: false, editSupported: true }
    ]), '', 'light', 'qa'));
    assert.equal(await page.locator('.qa-user-actions a').count(), 1, 'copy remains active while generation prevents editing');
    assert.equal(await page.locator('.qa-user-actions [aria-disabled="true"]').isVisible(), true, 'editing stays discoverable, not hidden while busy');
  } finally { await browser.close(); }
});

test('an orphan draft remains visible and copyable with cancel but no send or implicit retargeting', async () => {
  const browser = await createBrowserScope();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('../../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url).href);
    await page.setViewportSize({ width: 390, height: 520 });
    await page.evaluate(async () => {
      window.editEvents = []; window.readerFrames = { qaQuestionEdit: (...args) => window.editEvents.push(args) };
      await window.renderMarkdown(JSON.stringify([{ id: 'removed:user', role: 'user', content: '孤立草稿\n[S1]',
        editToken: 'orphan-token', editContent: '孤立草稿\n[S1]', editOrphan: true, editBusy: false,
        editError: '原问题已移除，编辑稿仍保留', documentKey: 'session:orphan' }]), '', 'light', 'qa');
    });
    assert.equal(await page.locator('.qa-edit-error').isVisible(), true);
    assert.equal(await page.locator('.qa-edit-send').isVisible(), false);
    assert.equal(await page.locator('.qa-edit-cancel').isEnabled(), true);
    await page.locator('.qa-edit-copy').click();
    assert.deepEqual(await page.evaluate(() => window.editEvents.at(-1)), ['session:orphan', 'removed:user', 'orphan-token', 'copy', '孤立草稿\n[S1]']);
    await page.locator('.qa-edit-cancel').click();
    assert.equal(await page.evaluate(() => window.editEvents.at(-1)[3]), 'cancel');
  } finally { await browser.close(); }
});
