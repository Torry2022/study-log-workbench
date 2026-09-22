import { isValidLogDate } from "./study-date.ts";

export function validMonth(month: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month);
}

export function shiftMonth(month: string, offset: number): string {
  if (!validMonth(month) || !Number.isInteger(offset)) throw new Error("Invalid month offset");
  const [year, number] = month.split("-").map(Number);
  const shifted = year * 12 + number - 1 + offset;
  if (shifted < 0 || shifted >= 10000 * 12) throw new Error("Month is outside the calendar range");
  return `${String(Math.floor(shifted / 12)).padStart(4, "0")}-${String(shifted % 12 + 1).padStart(2, "0")}`;
}

// Monday first, matching the mature workspace calendar. UTC avoids host timezone/DST
// differences and explicit ISO parsing avoids JavaScript's special years 0–99 constructor.
export function buildMonthCalendar(month: string): Array<string | null> {
  if (!validMonth(month)) return [];
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const leading = (first.getUTCDay() + 6) % 7;
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return [...Array.from({ length: leading }, () => null),
    ...Array.from({ length: last.getUTCDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
}

export function recordedDates(days: unknown, month: string): Set<string> {
  if (!validMonth(month) || !Array.isArray(days)) throw new Error("日期目录格式无效，请重试");
  const dates = new Set<string>();
  for (const day of days) {
    if (!day || typeof day.date !== "string" || !isValidLogDate(day.date) || !day.date.startsWith(`${month}-`)) {
      throw new Error("日期目录与当前月份不一致，请重试");
    }
    dates.add(day.date);
  }
  return dates;
}
