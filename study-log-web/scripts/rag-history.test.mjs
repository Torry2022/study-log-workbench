import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ragHistoryPage, prependRagHistory, retainRagHistory, visibleRagHistory, completeRagSession, ragNavigationEntries, reopenRagHistory } from '../lib/rag-history.ts';

const make = rounds => ({ id: randomUUID(), version: 'a'.repeat(64), title: '合成历史', titleSource: 'fallback',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', answerMode: 'logs_only', messageCount: rounds * 2,
  messages: Array.from({ length: rounds }, (_, i) => [{ id: `q${i}`, role: 'user', content: `问题 ${i}` },
    { id: `a${i}`, role: 'assistant', content: `回答 ${i}`, status: 'complete', citations: [] }]).flat() });
test('20 rounds are complete; 21 rounds start with 10 whole pairs', () => {
  const short = ragHistoryPage(make(20)), long = ragHistoryPage(make(21));
  assert.equal(short.messages.length, 40); assert.equal(short.history.paginated, false);
  assert.equal(long.messages.length, 20); assert.equal(long.messages[0].id, 'q11');
  assert.equal(long.history.total, 42); assert.equal(completeRagSession(long), false);
});
test('recent outline has at most 30 plain-text previews and never returns old answer bodies', () => {
  const full = make(70); full.messages[0].content = 'old question marker'; full.messages[1].content = 'old answer marker';
  full.messages[100].content = '<script>unsafe</script> **question**';
  const page = ragHistoryPage(full);
  assert.equal(page.history.outline.length, 30); assert.equal(page.history.outline[0].questionId, 'q40');
  assert.ok(!JSON.stringify(page).includes('old answer marker'));
  assert.ok(!page.history.outline.some(item => /[<>*]/.test(item.question)));
});
test('prepending maintains order and rejects gaps or changed versions', () => {
  const full = make(42), recent = ragHistoryPage(full), earlier = ragHistoryPage(full, { before: recent.history.firstQuestionId });
  const merged = prependRagHistory(recent, earlier);
  assert.deepEqual(merged.messages.map(x => x.id), full.messages.slice(-40).map(x => x.id));
  assert.throws(() => prependRagHistory(recent, { ...earlier, version: 'b'.repeat(64) }));
  assert.throws(() => prependRagHistory(recent, ragHistoryPage(full, { before: 'q20' })));
});
test('an unloaded outline target is bridged directly without repeated requests', () => {
  const full = make(70), recent = ragHistoryPage(full), target = ragHistoryPage(full, { before: recent.history.firstQuestionId, around: 'q43' });
  const merged = prependRagHistory(recent, target);
  assert.equal(merged.messages[0].id, 'q40'); assert.equal(merged.messages.at(-1).id, 'a69');
  assert.throws(() => ragHistoryPage(full, { before: 'missing' }));
});
test('full write hydration preserves the reading window; short sessions do not fold mid-reading', () => {
  const full = make(42), recent = ragHistoryPage(full), hydrated = retainRagHistory(full, recent);
  assert.equal(completeRagSession(hydrated), true); assert.equal(visibleRagHistory(hydrated.messages, hydrated).length, 20);
  const short = ragHistoryPage(make(20)); const longer = { ...short, history: undefined, messages: [...short.messages, ...make(1).messages], messageCount: 42 };
  assert.equal(retainRagHistory(longer, short).history.paginated, false);
});
test('paged storage reads retain bytes/version and partial replacement cannot erase unseen history', async () => {
  const store = await import('../lib/rag-sessions-store.ts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-history-'));
  const previous = process.env.LOG_ROOT, backup = process.env.BACKUP_ROOT; process.env.LOG_ROOT = root; process.env.BACKUP_ROOT = path.join(root, "backup");
  try {
    await fs.mkdir(process.env.BACKUP_ROOT, { recursive: true });
    const full = make(25), saved = await store.createRagSession({ id: full.id, mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: full.messages });
    const file = store.getRagSessionsFilePath(), before = await fs.readFile(file);
    const page = await store.getRagSessionHistory(saved.id, {});
    assert.equal(page.version, saved.version); assert.equal(page.messages.length, 20);
    await assert.rejects(store.getRagSessionHistory(saved.id, {}, 'b'.repeat(64)), /变化/);
    await assert.rejects(store.updateRagSession(saved.id, { mutationId: randomUUID(), baseVersion: saved.version, answerMode: 'logs_only', messages: page.messages }), /变化/);
    assert.deepEqual(await fs.readFile(file), before);
    const updated = await store.updateRagSession(saved.id, { mutationId: randomUUID(), baseVersion: saved.version, answerMode: 'logs_and_general', messages: saved.messages });
    assert.equal(updated.messages.length, 50);
  } finally { if (previous === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = previous; if (backup === undefined) delete process.env.BACKUP_ROOT; else process.env.BACKUP_ROOT = backup; await fs.rm(root, { recursive: true, force: true }); }
});

test('recent navigation retains index order after older pages load, and includes new live rounds', () => {
  const full = make(70), page = ragHistoryPage(full), all = ragHistoryPage(full, { before: page.history.firstQuestionId, around: 'q43' });
  const merged = prependRagHistory(page, all), entries = ragNavigationEntries(page.history.outline, merged.messages);
  assert.deepEqual(entries.map(entry => entry.questionId), full.messages.filter(message => message.role === 'user').slice(-30).map(message => message.id));
  const live = [...merged.messages, { id: 'new-q', role: 'user', content: 'new question' }, { id: 'new-a', role: 'assistant', content: 'live answer' }];
  assert.equal(ragNavigationEntries(page.history.outline, live).at(-1).questionId, 'new-q');
});
test('a short conversation remains complete when a refresh crosses the threshold', () => {
  const short = ragHistoryPage(make(20)), next = { ...make(21), id: short.id };
  const refreshed = retainRagHistory(ragHistoryPage(next, { from: short.history.firstQuestionId }), short);
  assert.equal(refreshed.history.paginated, false); assert.equal(refreshed.messages.length, 42);
});

test('explicitly reopening a grown or expanded conversation resets only the reading window', () => {
  const short = ragHistoryPage(make(20)), next = { ...make(21), id: short.id };
  const grown = retainRagHistory(next, short), reopened = reopenRagHistory(grown);
  assert.equal(reopened.messages.length, 20); assert.equal(reopened.history.paginated, true);
  assert.equal(grown.messages.length, 42); assert.equal(grown.history.paginated, false);
});
