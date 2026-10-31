import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('QA feedback occupies its own full-width row before the reader, with no copy in the composer', async () => {
  const page = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
  const layout = page.slice(page.indexOf('  build() {'));
  const header = layout.indexOf("ModulePageHeader({ title: '知识问答'");
  const feedback = layout.indexOf(".id('qa_page_feedback')");
  const reader = layout.indexOf('Stack({ alignContent: Alignment.BottomEnd })');
  assert.ok(header >= 0 && feedback > header && reader > feedback);
  assert.match(layout.slice(header, reader), /InlineStatus\(\{ compact: true/);
  assert.doesNotMatch(layout.slice(reader), /InlineStatus\(/);
  const component = await readFile(new URL('../entry/src/main/ets/common/ui/FeedbackStates.ets', import.meta.url), 'utf8');
  assert.match(component, /@Prop compact: boolean = false/);
});
