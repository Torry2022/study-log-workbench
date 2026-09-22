import { todayInShanghai } from "./study-date.ts";

export function ragSessionGroup(updatedAt: string, now = new Date()): string {
  const today = Date.parse(`${todayInShanghai(now)}T00:00:00+08:00`);
  const timestamp = Date.parse(`${todayInShanghai(new Date(updatedAt))}T00:00:00+08:00`);
  const days = Math.floor((today - timestamp) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days <= 7) return "近7天";
  return "更早";
}

export function ragUpdatedLabel(updatedAt: string, now = new Date()): string {
  const date = new Date(updatedAt), day = todayInShanghai(date);
  return day === todayInShanghai(now)
    ? date.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false })
    : day.slice(5);
}
