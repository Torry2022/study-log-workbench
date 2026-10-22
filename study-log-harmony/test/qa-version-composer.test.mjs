import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const transform = async (input) => ({ code: ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText });
const source = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
test('version replacement scroll is layout-owned until its completed frame, then gestures own visibility again', async () => {
  const readerSource = await readFile(new URL('../entry/src/main/ets/common/ui/MarkdownReader.ets', import.meta.url), 'utf8');
  const scroll = readerSource.slice(readerSource.indexOf('  private handleScroll('), readerSource.indexOf('  private measureActiveHeading('));
  const { code: readerCode } = await transform(`class Reader { ${scroll} }`, { loader: 'ts' });
  const Reader = new Function(`${readerCode}; return Reader;`)();
  const start = source.indexOf('  private setComposerHidden('), end = source.indexOf('  private backToTopVisible(', start);
  const { code } = await transform(`class Layout { ${source.slice(start, end)} }`, { loader: 'ts' });
  const Layout = new Function(`${code}; return Layout;`)();
  const h = Object.assign(new Layout(), { composerHidden: false, questionFocused: false, lastScrollY: 5000,
    scrollTravel: 0, scrollDirection: 0, topDividerOffset: 0, data: { question: '', sending: false }, onScrollStateChange() {} });
  const r = Object.assign(new Reader(), { bottomInsetChanging: false, scrollToEndRequestRevision: 1, handledEndRevision: 0,
    measureActiveHeading() {}, showBackToTop: false, trackScrollProgress: false, onScrollPosition: (y, layout) => h.handleReaderScroll(y, layout) });
  r.handleScroll(1800); assert.equal(h.composerHidden, false); assert.equal(h.lastScrollY, 1800);
  r.handleScroll(7200); assert.equal(h.composerHidden, false);
  r.handledEndRevision = 1;
  r.handleScroll(7300); assert.equal(h.composerHidden, true);
  r.handleScroll(7200); assert.equal(h.composerHidden, false);
});

for (const hidden of [false, true]) test(`answer version action preserves composer hidden=${hidden} and still requests the final position`, async () => {
  const start = source.indexOf('  private async answerAction('), end = source.indexOf('  private composerHorizontalInset(', start);
  const { code } = await transform(`class Page { ${source.slice(start, end)} }`, { loader: 'ts' });
  const Page = new Function(`${code}; return Page;`)();
  const events=[], h=Object.assign(new Page(), { answerVersionRevision: 0, composerHidden: hidden,
    setComposerHidden() { assert.fail('switching versions must not change composer visibility'); },
    data: { taskSaving: false, answerMessages: () => [{ id: 'current', questionId: 'q', role: 'assistant', versions: ['old','current'] }],
      selectAnswerVersion: async () => events.push('select') } });
  await h.answerAction('current','version','old');
  assert.deepEqual(events,['select']); assert.equal(h.answerVersionRevision,1); assert.equal(h.composerHidden,hidden);
  await h.answerAction('current','version','current');
  assert.equal(h.answerVersionRevision,2); assert.equal(h.composerHidden,hidden);
});
