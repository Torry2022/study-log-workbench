import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLogDraft, restoredLogDraft } from '../entry/src/main/ets/features/logs/LogDraftPolicy.ts';

const draft = { namespace: 'instance-a', date: '2026-02-05', text: '未保存的合成草稿', baseVersion: 'v1' };

test('a saved draft belongs only to its instance and date', () => {
  assert.deepEqual(parseLogDraft(JSON.stringify(draft), 'instance-a'), draft);
  assert.equal(parseLogDraft(JSON.stringify(draft), 'instance-b'), undefined);
  assert.equal(restoredLogDraft(draft, 'instance-a', '2026-02-06', '服务端正文', 'v1'), undefined);
  assert.equal(parseLogDraft('{bad json', 'instance-a'), undefined);
});

test('recovery detects server changes and ignores already-saved text', () => {
  assert.deepEqual(restoredLogDraft(draft, 'instance-a', draft.date, '服务端正文', 'v1'),
    { text: draft.text, conflict: false });
  assert.deepEqual(restoredLogDraft(draft, 'instance-a', draft.date, '服务端新正文', 'v2'),
    { text: draft.text, conflict: true });
  assert.equal(restoredLogDraft(draft, 'instance-a', draft.date, draft.text, 'v2'), undefined);
});
