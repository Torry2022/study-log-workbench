import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getBackupRoot } from "./config.ts";
import { assertUnlinkedPath, extractDayBlockFromSource, getDay, saveDay, LogConflictError } from "./log-store.ts";
import { isValidLogDate } from "./study-date.ts";

export class DayBackupInputError extends Error {}
export class DayBackupNotFoundError extends Error {}
export class DayBackupChangedError extends LogConflictError {
  constructor() { super(); this.message = "所选备份内容已变化，请重新预览后确认。"; }
}

export interface DayBackupSummary {
  id: string; kind: "write"; createdAt: string; sizeBytes: number; fileName: string;
}
interface Cursor { date: string; after: string; seen: string[] }

// Current writes use an ISO timestamp plus UUID to retain same-millisecond
// versions. The old second-based filename is accepted for existing archives.
const backupPattern = /^((\d{4})(?:-(\d{2}))?_学习日志\.md)\.(?:(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(\d{8}-\d{6}))\.bak$/i;
const MAX_VERSIONS = 20;
const MAX_SCANNED_FILES = 64;
const digest = (content: string) => crypto.createHash("sha256").update(content).digest("hex");

function assertDate(date: string) {
  if (typeof date !== "string" || !isValidLogDate(date)) throw new DayBackupInputError("需要有效日期 YYYY-MM-DD");
}
function sourceName(id: string, date: string): string {
  const match = typeof id === "string" && id.length < 256 ? backupPattern.exec(id) : null;
  if (!match || ![`${date.slice(0, 7)}_学习日志.md`, `${date.slice(0, 4)}_学习日志.md`].includes(match[1])) {
    throw new DayBackupInputError("备份版本与所选日期不匹配");
  }
  return match[1];
}
function order(id: string): string {
  const match = backupPattern.exec(id)!;
  const stamp = (match[4] || match[5]).replace(/\D/g, "").padEnd(17, "0");
  return `${stamp}:${id}`;
}

async function readVersion(id: string, date: string) {
  const fileName = sourceName(id, date);
  const file = path.join(getBackupRoot(), id);
  await assertUnlinkedPath(file);
  const stat = await fs.lstat(file).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DayBackupNotFoundError("所选备份不存在，请刷新列表");
    throw error;
  });
  if (!stat.isFile()) throw new DayBackupInputError("所选备份不是普通文件");
  const source = await fs.readFile(file, "utf8");
  const content = extractDayBlockFromSource(source, fileName, date);
  return { content, fileName, createdAt: stat.mtime.toISOString() };
}

export async function listDayBackups(date: string, cursor?: string) {
  assertDate(date);
  let state: Cursor = { date, after: "", seen: [] };
  if (cursor !== undefined && cursor !== "") {
    try {
      if (cursor.length > 4000) throw new Error();
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (parsed.date !== date || typeof parsed.after !== "string" || !Array.isArray(parsed.seen) || parsed.seen.length >= MAX_VERSIONS ||
        parsed.seen.some((hash: unknown) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) throw new Error();
      sourceName(parsed.after, date);
      state = parsed;
    } catch { throw new DayBackupInputError("备份分页参数无效，请重新打开列表"); }
  }
  const root = getBackupRoot();
  await assertUnlinkedPath(root);
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { write: [] as DayBackupSummary[], nextCursor: null as string | null };
    throw error;
  }
  const candidates = entries.filter(entry => {
    if (!entry.isFile()) return false;
    try { sourceName(entry.name, date); return !state.after || order(entry.name) < order(state.after); }
    catch { return false; }
  }).sort((a, b) => {
    const left = order(a.name), right = order(b.name);
    return left === right ? 0 : left < right ? 1 : -1;
  });
  const seen = new Set(state.seen);
  const write: DayBackupSummary[] = [];
  let scanned = 0;
  for (const entry of candidates.slice(0, MAX_SCANNED_FILES)) {
    scanned++;
    const backup = await readVersion(entry.name, date);
    if (!backup.content) continue;
    const hash = digest(backup.content);
    if (seen.has(hash)) continue;
    seen.add(hash);
    write.push({ id: entry.name, kind: "write", fileName: backup.fileName, createdAt: backup.createdAt, sizeBytes: Buffer.byteLength(backup.content) });
    if (seen.size >= MAX_VERSIONS) break;
  }
  const nextCursor = seen.size < MAX_VERSIONS && candidates.length > scanned
    ? Buffer.from(JSON.stringify({ date, after: candidates[scanned - 1].name, seen: [...seen] })).toString("base64url") : null;
  return { write, nextCursor };
}

export async function previewDayBackup(date: string, kind: string, id: string) {
  assertDate(date);
  if (kind !== "write") throw new DayBackupInputError("只支持恢复保存前的历史版本");
  const [backup, current] = await Promise.all([readVersion(id, date), getDay(date)]);
  if (!backup.content) throw new DayBackupNotFoundError("此备份不包含所选日志");
  return { date, kind: "write" as const, id, fileName: backup.fileName,
    historicalContent: backup.content, currentContent: current.content, currentVersion: current.version,
    backupVersion: digest(backup.content) };
}

export interface RestoreDayBackupInput {
  date: string; kind: "write"; id: string; baseVersion: string | null; backupVersion: string;
}
export async function restoreDayBackup(input: RestoreDayBackupInput) {
  if (!input || typeof input !== "object" || input.kind !== "write" || !Object.hasOwn(input, "baseVersion") ||
    !(input.baseVersion === null || typeof input.baseVersion === "string" && input.baseVersion.length > 0) ||
    typeof input.backupVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.backupVersion)) {
    throw new DayBackupInputError("无法确认历史版本及当前日志，请重新选择历史版本后重试");
  }
  assertDate(input.date);
  const backup = await readVersion(input.id, input.date);
  if (!backup.content) throw new DayBackupNotFoundError("此备份不包含所选日志");
  if (digest(backup.content) !== input.backupVersion) throw new DayBackupChangedError();
  // Reuse the same versioned transaction and pre-write backup as normal saves.
  // Only the selected day is copied out of the historical source snapshot.
  return saveDay({ date: input.date, content: backup.content, mode: "replace", baseVersion: input.baseVersion }, backup.fileName);
}
