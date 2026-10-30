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

export function ragTimeLabel(date: Date, now: Date = new Date()): string {
  const shanghai = new Date(date.getTime() + 8 * 60 * 60_000);
  const today = new Date(now.getTime() + 8 * 60 * 60_000);
  const days = Math.floor(today.getTime() / 86_400_000) - Math.floor(shanghai.getTime() / 86_400_000);
  const clock = `${String(shanghai.getUTCHours()).padStart(2, "0")}:${String(shanghai.getUTCMinutes()).padStart(2, "0")}`;
  const day = days === 0 ? "今天" : days === 1 ? "昨天" : days > 1 && days < 7 ?
    `星期${"日一二三四五六"[shanghai.getUTCDay()]}` :
    `${shanghai.getUTCFullYear() === today.getUTCFullYear() ? "" : `${shanghai.getUTCFullYear()}年`}${shanghai.getUTCMonth() + 1}月${shanghai.getUTCDate()}日`;
  return `${day} ${clock}`;
}

const day = (time: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
export function ragTimeSeparators(ids: string[], times: ReadonlyMap<string, string>, now: Date = new Date()): ReadonlyMap<string, { time: string; label: string }> {
  const separators = new Map<string, { time: string; label: string }>();
  let previous: string | undefined;
  for (const id of ids) {
    const time = times.get(id);
    if (!time || !Number.isFinite(Date.parse(time))) continue;
    const crossDay = !previous || day(previous) !== day(time);
    if (crossDay || Date.parse(time) - Date.parse(previous!) >= 30 * 60_000) {
      const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time));
      separators.set(id, { time, label: crossDay ? ragTimeLabel(new Date(time), now) : clock });
    }
    previous = time;
  }
  return separators;
}
