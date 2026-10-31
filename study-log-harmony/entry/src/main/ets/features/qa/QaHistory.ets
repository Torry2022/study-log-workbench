import { RagChatMessage, RagSession } from './QaModels';
import { QaAnswerMessage } from './QaTaskModels';

export interface QaHistoryEntry { questionId: string; question: string; preview: string; }
export interface QaHistoryWindow {
  paginated: boolean; start: number; end: number; total: number;
  firstQuestionId: string; outline: QaHistoryEntry[];
}
export function visibleQaHistory(messages: QaAnswerMessage[], history?: QaHistoryWindow): QaAnswerMessage[] {
  if (!history?.paginated) return messages;
  const index = messages.findIndex((message: QaAnswerMessage) => message.id === history.firstQuestionId);
  return index > 0 ? messages.slice(index) : messages;
}
export function retainQaHistory(next: RagSession, previous?: RagSession): RagSession {
  const history = previous?.history;
  if (next.history && history && previous?.id === next.id && next.history.start === 0 && history.start === 0 && !history.paginated) next.history.paginated = false;
  if (next.history || !history || previous?.id !== next.id) return next;
  const found = next.messages.findIndex((message: RagChatMessage) => message.id === history.firstQuestionId);
  const start = history.paginated ? (found >= 0 ? found : Math.max(0, next.messages.length - 20)) : 0;
  next.history = { paginated: history.paginated, start, end: next.messageCount, total: next.messageCount,
    firstQuestionId: next.messages[start]?.id || '', outline: history.outline };
  return next;
}

export interface QaHistoryPresentation { window?: QaHistoryWindow; loading: boolean; error: string; key: string; hover: boolean; }
