import { RagChatMessage, RagCitation, RagSession } from './QaModels';

export interface QaTaskSubmission {
  submissionId: string;
  sessionId: string;
  baseVersion: string | null;
  question: string;
  mode: string;
  replaceLast?: boolean;
  cancelRequested?: boolean;
}
export interface QaTaskSummary {
  id: string;
  submissionId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  state: string;
  saveState: string;
}
export interface QaTaskResult { answer: string; citations: RagCitation[]; groundingWarning?: string; }
export interface QaTask extends QaTaskSummary {
  question: string;
  mode: string;
  replaceLast: boolean;
  partial: string;
  stage: string;
  error: string;
  saveError: string;
  result: QaTaskResult | null;
}
export interface QaTaskResponse { task: QaTask; }
export interface QaTaskListResponse { tasks: QaTaskSummary[]; }
export interface QaTaskChoice { id: string; label: string; }
export interface QaTaskStorage { read: () => Promise<string>; write: (raw: string) => Promise<void>; }

export function taskActive(task: QaTaskSummary): boolean { return task.state === 'queued' || task.state === 'running'; }
export function taskRetained(task: QaTaskSummary): boolean {
  return taskActive(task) || task.state === 'succeeded' && task.saveState !== 'saved' && task.saveState !== 'deleted';
}
export function latestTask(tasks: QaTask[], sessionId: string): QaTask | undefined {
  let latest: QaTask | undefined;
  tasks.forEach((task: QaTask) => {
    if (task.sessionId === sessionId && (!latest || `${task.createdAt}:${task.id}` > `${latest.createdAt}:${latest.id}`)) latest = task;
  });
  return latest;
}
export function validTaskSummary(task: QaTaskSummary): boolean {
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  return !!task && uuid.test(task.id) && uuid.test(task.sessionId) && uuid.test(task.submissionId) &&
    Number.isSafeInteger(task.revision) && task.revision > 0 && typeof task.createdAt === 'string' && typeof task.updatedAt === 'string' &&
    ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.state) &&
    ['pending', 'saved', 'conflict', 'error', 'deleted'].includes(task.saveState);
}
export function validTask(task: QaTask): boolean {
  return validTaskSummary(task) && typeof task.question === 'string' && typeof task.partial === 'string' &&
    typeof task.stage === 'string' && typeof task.error === 'string' && typeof task.saveError === 'string' &&
    typeof task.replaceLast === 'boolean' && ['logs_only', 'logs_and_general'].includes(task.mode) &&
    (task.result === null || !!task.result && typeof task.result.answer === 'string' && Array.isArray(task.result.citations)) &&
    (task.state !== 'succeeded' || !!task.result?.answer.trim());
}
export function taskMessages(task: QaTask, session?: RagSession, historical: boolean = false): RagChatMessage[] {
  if (historical) session = undefined;
  if (task.saveState === 'saved' && session) return session.messages;
  const previous = session?.messages || [];
  return [...(task.replaceLast ? previous.slice(0, -2) : previous),
    { id: `${task.id}:user`, role: 'user', content: task.question },
    { id: `${task.id}:assistant`, role: 'assistant', content: task.result?.answer || task.partial,
      status: taskActive(task) ? 'streaming' : task.state === 'succeeded' ? 'complete' : task.state === 'cancelled' ? 'stopped' : 'error',
      citations: task.result?.citations || [], groundingWarning: task.result?.groundingWarning,
      error: task.state === 'failed' || task.state === 'interrupted' ? task.error || '问答中断，请重试' : undefined }];
}
