import type { RagChatMessage } from './rag-types.ts';
import type { RagTask } from './rag-task-types.ts';
import { newestRagTask, ragTaskMessages } from './rag-task-client.ts';
import { ragTaskActive } from './rag-task-types.ts';

export interface RagAnswerMessage extends RagChatMessage {
  questionId?: string;
  versions?: string[];
  versionIndex?: number;
  taskId?: string;
  canRegenerate?: boolean;
  canRetry?: boolean;
  canSave?: boolean;
  canDiscard?: boolean;
  saveError?: string;
  saving?: boolean;
}

/** Preview-only selection; sending commits the selected last answer before building its context. */
export function ragAnswerVersions(saved: RagChatMessage[], tasks: RagTask[], choices: ReadonlyMap<string, string>, readingTaskId?: string) {
  const ordered = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const pairs = [...saved], messages: RagAnswerMessage[] = [];
  const latest = ordered.at(-1);
  for (const task of ordered) {
    const id = task.questionMessageId || `${task.id}:user`;
    if (!pairs.some(message => message.id === id) && (task.saveState !== 'saved' || task.id === readingTaskId)) {
      const next = pairs.findIndex(message => message.role === 'user' && ordered.some(candidate =>
        (candidate.questionMessageId || `${candidate.id}:user`) === message.id && `${candidate.createdAt}:${candidate.id}` > `${task.createdAt}:${task.id}`));
      pairs.splice(next < 0 ? pairs.length : next, 0, { id, role: 'user', content: task.question }, ragTaskMessages(task, null).at(-1)!);
    }
  }
  let historical = false;
  for (let i = 0; i < pairs.length - 1; i += 2) {
    const question = pairs[i], canonical = pairs[i + 1];
    const related = ordered.filter(task => (task.questionMessageId || `${task.id}:user`) === question.id);
    const variants: RagChatMessage[] = [];
    for (const task of related) {
      if (task.previousAnswer && !variants.some(item => item.id === task.previousAnswer!.id)) variants.push(task.previousAnswer);
      const answer = ragTaskMessages(task, null).at(-1)!;
      if (!variants.some(item => item.id === answer.id)) variants.push(answer);
    }
    const canonicalIndex = variants.findIndex(item => item.id === canonical.id);
    if (canonicalIndex < 0) variants.unshift(canonical);
    else variants[canonicalIndex] = canonical;
    const newest = related.at(-1);
    const fallback = newest && (newest.saveState !== 'saved' || newest.id === readingTaskId) ? `${newest.id}:assistant` : canonical.id;
    const selected = variants.find(item => item.id === choices.get(question.id)) || variants.find(item => item.id === fallback) || canonical;
    const task = related.find(item => `${item.id}:assistant` === selected.id);
    if (choices.has(question.id) && saved.some(item => item.id === question.id) && selected.id !== canonical.id) historical = true;
    messages.push(question, { ...selected, questionId: question.id, versions: variants.map(item => item.id),
      versionIndex: variants.findIndex(item => item.id === selected.id), taskId: task?.id,
      canRegenerate: question.id === saved.at(-2)?.id && selected.id === saved.at(-1)?.id && !ordered.some(ragTaskActive),
      canRetry: !!task && task.id === newestRagTask(ordered, task.sessionId)?.id && ['failed', 'cancelled', 'interrupted'].includes(task.state),
      canSave: task?.state === 'succeeded' && task.saveState === 'error',
      canDiscard: task?.state === 'succeeded' && ['error', 'conflict'].includes(task.saveState),
      saving: task?.state === 'succeeded' && task.saveState === 'pending',
      saveError: task?.state === 'succeeded' && ['error', 'conflict'].includes(task.saveState) ? task.saveError || '回答已保留，尚未写入会话' : '' });
  }
  return { messages, historical };
}
