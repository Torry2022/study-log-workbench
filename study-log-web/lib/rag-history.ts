import type { RagChatMessage, RagSession } from './rag-types.ts';

export const RAG_HISTORY_THRESHOLD = 40;
export const RAG_HISTORY_BATCH = 20;
export const RAG_HISTORY_OUTLINE = 30;
export interface RagHistoryEntry { questionId: string; question: string; preview: string }
export interface RagHistoryWindow {
  paginated: boolean; start: number; end: number; total: number;
  firstQuestionId: string; outline: RagHistoryEntry[];
}
export interface RagHistoryQuery { from?: string; before?: string; around?: string }
export class RagHistoryCursorError extends Error {}

const preview = (text: string, length: number) => text.slice(0, length * 6).replace(/<[^>]*>/g, ' ').replace(/[`*_#>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, length);
export function ragHistoryOutline(messages: RagChatMessage[]): RagHistoryEntry[] {
  const entries: RagHistoryEntry[] = [];
  for (let i = 0; i + 1 < messages.length; i += 2) entries.push({ questionId: messages[i].id,
    question: preview(messages[i].content, 160), preview: preview(messages[i + 1].content, 180) });
  return entries.slice(-RAG_HISTORY_OUTLINE);
}

/** A read window never changes the authoritative record or its version. */
export function ragHistoryPage(session: RagSession, query: RagHistoryQuery = {}): RagSession {
  const all = session.messages, total = all.length, paginated = total > RAG_HISTORY_THRESHOLD;
  const indexOf = (id: string) => all.findIndex(message => message.role === 'user' && message.id === id);
  let start = paginated ? Math.max(0, total - RAG_HISTORY_BATCH) : 0, end = total;
  if (query.from) { const index = indexOf(query.from); if (index >= 0) start = index; }
  if (query.before) {
    end = indexOf(query.before);
    if (end < 0) throw new RagHistoryCursorError('会话已更新，请重新读取后继续');
    start = Math.max(0, end - RAG_HISTORY_BATCH);
    if (query.around) {
      const index = indexOf(query.around);
      if (index < 0 || index >= end) throw new RagHistoryCursorError('目标问题已变化，请重新读取后继续');
      // One request bridges the target's batch to the current window, without holes.
      start = Math.floor(index / RAG_HISTORY_BATCH) * RAG_HISTORY_BATCH;
    }
  }
  return { ...session, messages: all.slice(start, end), history: { paginated, start, end, total,
    firstQuestionId: all[start]?.id || '', outline: ragHistoryOutline(all) } };
}

export function completeRagSession(session: RagSession): boolean { return session.messages.length === session.messageCount; }

/** A full response obtained for a write must not expand the current reading window. */
export function retainRagHistory(next: RagSession, previous: RagSession | null): RagSession {
  if (next.history && previous?.history && next.id === previous.id && next.history.start === 0 && previous.history.start === 0 && !previous.history.paginated) {
    return { ...next, history: { ...next.history, paginated: false } };
  }
  if (next.history || !previous?.history || next.id !== previous.id) return next;
  const old = previous.history;
  const found = next.messages.findIndex(message => message.id === old.firstQuestionId);
  const start = old.paginated ? found >= 0 ? found : Math.max(0, next.messages.length - RAG_HISTORY_BATCH) : 0;
  return { ...next, history: { paginated: old.paginated, start, end: next.messageCount, total: next.messageCount,
    firstQuestionId: next.messages[start]?.id || '', outline: ragHistoryOutline(next.messages) } };
}

export function visibleRagHistory<T extends RagChatMessage>(messages: T[], session: RagSession | null): T[] {
  if (!session?.history?.paginated) return messages;
  const start = messages.findIndex(message => message.id === session.history!.firstQuestionId);
  return start > 0 ? messages.slice(start) : messages;
}

export function prependRagHistory(current: RagSession, earlier: RagSession): RagSession {
  const left = earlier.history, right = current.history;
  if (!left || !right || earlier.id !== current.id || earlier.version !== current.version || left.end !== right.start) {
    throw new RagHistoryCursorError('会话已更新，请重新读取后继续');
  }
  return { ...current, messages: [...earlier.messages, ...visibleRagHistory(current.messages, current)],
    history: { ...left, paginated: right.paginated, end: right.end } };
}

/** Keep the authoritative index order; loaded old rounds cannot displace recent ticks. */
export function ragNavigationEntries(outline: RagHistoryEntry[], messages: RagChatMessage[]): RagHistoryEntry[] {
  const loaded = ragHistoryOutline(messages), map = new Map(loaded.map(entry => [entry.questionId, entry]));
  if (!outline.length) return loaded;
  const known = new Set(outline.map(entry => entry.questionId));
  const lastKnown = loaded.findLastIndex(entry => known.has(entry.questionId));
  return [...outline.map(entry => map.get(entry.questionId) || entry), ...loaded.slice(lastKnown + 1).filter(entry => !known.has(entry.questionId))].slice(-RAG_HISTORY_OUTLINE);
}

/** Explicit reopening starts a new reading window, while the owner's drafts stay retained. */
export function reopenRagHistory(session: RagSession): RagSession {
  if (!session.history) return session;
  const paginated = session.messageCount > RAG_HISTORY_THRESHOLD;
  const messages = paginated ? session.messages.slice(-RAG_HISTORY_BATCH) : session.messages;
  return { ...session, messages, history: { ...session.history, paginated,
    start: session.messageCount - messages.length, end: session.messageCount, total: session.messageCount,
    firstQuestionId: messages[0]?.id || '' } };
}
