const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export const FUTURE_LOG_DATE_ERROR_CODE = "FUTURE_LOG_DATE";

export function isValidLogDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export class FutureLogDateError extends Error {
  constructor() {
    super("不能创建未来日期的日志");
    this.name = "FutureLogDateError";
  }
}

export function todayInShanghai(now = new Date()): string {
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isFutureLogDate(date: string, now = new Date()): boolean {
  return date > todayInShanghai(now);
}

export function assertLogDateIsNotFuture(date: string, now = new Date()): void {
  if (isFutureLogDate(date, now)) throw new FutureLogDateError();
}
