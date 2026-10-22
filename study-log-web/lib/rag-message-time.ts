import type { RagTask } from './rag-task-types.ts';

/** Regenerations and retries cannot supply the original question's creation time. */
export function originalRagMessageTimes(tasks: Iterable<Pick<RagTask, 'id' | 'createdAt' | 'questionMessageId' | 'replaceLast'>>): ReadonlyMap<string, string> {
  const times = new Map<string, string>();
  for (const task of tasks) {
    const id = task.questionMessageId || `${task.id}:user`;
    if (task.replaceLast || id !== `${task.id}:user` || !Number.isFinite(Date.parse(task.createdAt))) continue;
    times.set(id, task.createdAt);
  }
  return times;
}

const day = (time: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
export function ragTimeSeparators(ids: string[], times: ReadonlyMap<string, string>): ReadonlyMap<string, { time: string; label: string }> {
  const separators = new Map<string, { time: string; label: string }>();
  let previous: string | undefined;
  for (const id of ids) {
    const time = times.get(id);
    if (!time || !Number.isFinite(Date.parse(time))) continue;
    const crossDay = !previous || day(previous) !== day(time);
    if (crossDay || Date.parse(time) - Date.parse(previous!) >= 30 * 60_000) {
      const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time));
      separators.set(id, { time, label: crossDay ? `${day(time)} ${clock}` : clock });
    }
    previous = time;
  }
  return separators;
}
