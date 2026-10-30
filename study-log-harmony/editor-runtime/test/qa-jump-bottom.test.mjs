import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../../../study-log-web/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8').then(text => text.replace(/\r\n/g, '\n'));
const methods = source.slice(source.indexOf('  private observeHoverPointer()'), source.indexOf('  @Builder\n  private qaScrollToBottomButton()'));
function harness(inputDevice) {
  const scope = { inputDevice };
  runInNewContext(ts.transpile(`class Harness {
    data = {sending: true, sessionLoading: false};
    pointerRevision = 0; pointerListening = false; pointerHoverSupported = false;
    pointerChanged = () => {this.detectHoverPointer()};
    bottomControlHovered = false; bottomControlFocused = false;
    readerScrollRemaining = 100; followAnswer = false; composerHidden = true; answerVersionRevision = 0;
    conversation = true; hasConversation() {return this.conversation;}
    setComposerHidden(hidden) {this.composerHidden = hidden;}
    ${methods}
  }; globalThis.Harness = Harness;`, {target: ts.ScriptTarget.ES2022}), scope);
  return new scope.Harness();
}
test('native bottom control distinguishes pointer capabilities, focus, completion and scroll range', async () => {
  let sources = ['touchscreen'];
  const page = harness({getDeviceList: async()=>[1], getDevice: async()=>({sources})});
  await page.detectHoverPointer(); assert.equal(page.bottomControlBusy(), false);
  sources = ['touchpad']; await page.detectHoverPointer(); assert.equal(page.bottomControlBusy(), true);
  page.bottomControlHovered = true; assert.equal(page.bottomControlBusy(), false);
  page.bottomControlHovered = false; page.bottomControlFocused = true; assert.equal(page.bottomControlBusy(), false);
  page.bottomControlFocused = false; page.data.sending = false; assert.equal(page.bottomControlBusy(), false);
  assert.equal(page.scrollToBottomVisible(), true);
  page.readerScrollRemaining = 20; assert.equal(page.scrollToBottomVisible(), false);
  page.readerScrollRemaining = 100; page.data.sessionLoading = true; assert.equal(page.scrollToBottomVisible(), false);
  page.data.sessionLoading = false; page.conversation = false; assert.equal(page.scrollToBottomVisible(), false);
  page.scrollToBottom(); assert.equal(page.followAnswer, true); assert.equal(page.composerHidden, false); assert.equal(page.answerVersionRevision, 1);
});
test('late pointer discovery cannot update a disposed page; unavailable device API retains the arrow', async () => {
  let resolve;
  const page = harness({getDeviceList:()=>new Promise(done=>resolve=done), getDevice:async()=>({sources:['mouse']})});
  const pending = page.detectHoverPointer(); page.releaseHoverPointer(); resolve([1]); await pending;
  assert.equal(page.pointerHoverSupported, false);
  const unavailable = harness({getDeviceList:async()=>{throw Error('unavailable')}});
  await unavailable.detectHoverPointer(); assert.equal(unavailable.bottomControlBusy(), false);
});
