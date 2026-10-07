import fs from "node:fs/promises";
import path from "node:path";
import { getBackupRoot } from "./config.ts";

export function logHistoryPolicy() {
  const enabled = process.env.LOG_HISTORY_ENABLED !== "false";
  const days = Number(process.env.LOG_HISTORY_DAYS || 0);
  return { enabled, days: [0, 30, 90, 180, 365].includes(days) ? days : 0 };
}

// Only current-format log snapshots are owned by this retention policy.
// Legacy files, transaction recovery files and exported archives are preserved.
export async function expireLogHistory(fileName: string, now = Date.now()) {
  const { enabled, days } = logHistoryPolicy();
  if (!enabled || !days) return;
  const root = getBackupRoot();
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return;
  const prefix = `${fileName}.`;
  const pattern = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.bak$/i;
  for (const name of await fs.readdir(root)) {
    if (!name.startsWith(prefix)) continue;
    const match = pattern.exec(name.slice(prefix.length));
    if (!match) continue;
    const stamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
    if (!Number.isFinite(stamp) || stamp >= now - days * 86400000) continue;
    const file = path.join(root, name), stat = await fs.lstat(file);
    if (stat.isFile() && !stat.isSymbolicLink()) await fs.unlink(file);
  }
}
