import { logHistoryPolicy, expireLogHistory } from "./log-history-policy.ts";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getBackupRoot, getLogRoot, LOG_FILE_PATTERN } from "./config.ts";
import { findLevelTwoHeadings, findRootAtxHeadings, normalizeDayContent, stripTrailingStructuralSeparator } from "./day-content.ts";
import { buildMarkdownOutline } from "./markdown-outline.ts";
import type { DayEntry, DaySummary, MonthSummary, SaveDayInput, DeleteDayInput } from "./types.ts";
import { assertLogDateIsNotFuture, isValidLogDate } from "./study-date.ts";


interface LogFile {
  filePath: string;
  fileName: string;
}


interface ParsedBlock {
  date: string;
  start: number;
  end: number;
  content: string;
  fileName: string;
  filePath: string;
  sourceContent: string;
}

const parsedFileCache = new Map<string, {
  content: string;
  headings: ReturnType<typeof findLevelTwoHeadings>;
}>();

const MAX_CACHED_CHARACTERS = 4_000_000;

let cachedCharacters = 0;


function assertDate(date: string): void {
  if (!isValidLogDate(date)) {
    throw new Error("Invalid date. Expected YYYY-MM-DD");
  }
}


function toMonth(date: string): string {
  return date.slice(0, 7);
}


function getPreview(markdown: string): string {
  return markdown
    .replace(/^#{2,3}\s+.+$/gm, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}


function getHeadings(markdown: string): string[] {
  return findRootAtxHeadings(markdown, 3)
    .map(heading => heading.text.replace(/^\d+\.\s+/, "").trim());
}


function fileVersion(filePath: string, content: string, mtimeMs: number): string {
  const hash = crypto.createHash("sha1").update(content).digest("hex").slice(0, 16);
  return `${Math.round(mtimeMs)}:${Buffer.byteLength(content, "utf8")}:${hash}`;
}


async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}


async function listLogFiles(): Promise<LogFile[]> {
  const root = getLogRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name))
    .map((entry) => ({
      fileName: entry.name,
      filePath: path.join(root, entry.name)
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}


function parseBlocks(content: string, file: LogFile): ParsedBlock[] {
  const cached = parsedFileCache.get(file.filePath);
  let headings = cached?.headings || [];
  if (!cached || cached.content !== content) {
    if (cached) {
      cachedCharacters -= cached.content.length;
      parsedFileCache.delete(file.filePath);
    }
    headings = findLevelTwoHeadings(content).filter((heading) => /^\d{4}-\d{2}-\d{2}$/.test(heading.text));
    // Compare actual content, not mtimes: synced files can retain their timestamps.
    if (content.length <= MAX_CACHED_CHARACTERS) {
      while (parsedFileCache.size && (parsedFileCache.size >= 32 || cachedCharacters + content.length > MAX_CACHED_CHARACTERS)) {
        const oldest = parsedFileCache.keys().next().value!;
        cachedCharacters -= parsedFileCache.get(oldest)!.content.length;
        parsedFileCache.delete(oldest);
      }
      parsedFileCache.set(file.filePath, { content, headings });
      cachedCharacters += content.length;
    }
  } else {
    parsedFileCache.delete(file.filePath);
    parsedFileCache.set(file.filePath, cached);
  }
  return headings.map((heading, index) => {
    if (!isValidLogDate(heading.text)) throw new Error("源文件包含无效日期");
    const sourceDate = file.fileName.match(LOG_FILE_PATTERN);
    const prefix = sourceDate ? `${sourceDate[1]}-${sourceDate[2] ? sourceDate[2] + "-" : ""}` : null;
    if (prefix && !heading.text.startsWith(prefix)) throw new Error("日块日期与源文件年月不一致");
    const start = heading.start;
    const end = index + 1 < headings.length ? headings[index + 1].start : content.length;
    return {
      date: heading.text,
      start,
      end,
      content: stripTrailingStructuralSeparator(content.slice(start, end)),
      fileName: file.fileName,
      filePath: file.filePath,
      sourceContent: content
    };
  });
}


export function extractDayBlockFromSource(content: string, fileName: string, date: string): string | null {
  assertDate(date);
  const file = { fileName, filePath: fileName };
  const blocks = parseBlocks(content, file);
  if (new Set(blocks.map(block => block.date)).size !== blocks.length) {
    throw new LogWriteInputError("备份源文件包含重复日期，无法确认所选日块");
  }
  return blocks.find((block) => block.date === date)?.content || null;
}


async function readBlocks(month?: string): Promise<ParsedBlock[]> {
  const files = await listLogFiles();
  const all: ParsedBlock[] = [];
  for (const file of files) {
    if (month && file.fileName !== `${month}_学习日志.md` && file.fileName !== `${month.slice(0, 4)}_学习日志.md`) continue;
    const content = await readText(file.filePath);
    all.push(...parseBlocks(content, file));
  }
  const dates = new Set<string>();
  for (const block of all) {
    if (dates.has(block.date)) throw new Error("源文件中存在重复日期，请先整理源文件");
    dates.add(block.date);
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}


function toDaySummary(block: ParsedBlock): DaySummary {
  return {
    date: block.date,
    month: toMonth(block.date),
    fileName: block.fileName,
    headings: getHeadings(block.content),
    preview: getPreview(block.content)
  };
}


export async function listMonths(): Promise<MonthSummary[]> {
  const blocks = await readBlocks();
  const groups = new Map<string, ParsedBlock[]>();
  for (const block of blocks) {
    const month = toMonth(block.date);
    groups.set(month, [...(groups.get(month) || []), block]);
  }

  return [...groups.entries()]
    .map(([id, monthBlocks]) => ({
      id,
      label: id,
      dayCount: monthBlocks.length,
      firstDate: monthBlocks[0]?.date || null,
      lastDate: monthBlocks.at(-1)?.date || null
    }))
    .sort((a, b) => b.id.localeCompare(a.id));
}


export async function listDays(month: string): Promise<DaySummary[]> {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Invalid month. Expected YYYY-MM");
  }
  const blocks = await readBlocks(month);
  return blocks
    .filter((block) => toMonth(block.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(toDaySummary);
}

export async function listSavedDayContents(): Promise<Array<{ date: string; content: string; fileName: string }>> {
  return (await readBlocks()).map(({ date, content, fileName }) => ({ date, content, fileName }));
}


async function findDayBlock(date: string): Promise<ParsedBlock | null> {
  assertDate(date);
  const blocks = await readBlocks(toMonth(date));
  return blocks.find((block) => block.date === date) || null;
}


export async function getDay(date: string): Promise<DayEntry> {
  assertDate(date);
  const existing = await findDayBlock(date);
  if (!existing) {
    return {
      date,
      month: toMonth(date),
      fileName: `${toMonth(date)}_学习日志.md`,
      headings: [],
      preview: "",
      exists: false,
      content: `## ${date}\n\n`,
      version: null,
      updatedAt: null
    };
  }

  const stat = await fs.stat(existing.filePath);
  return {
    ...toDaySummary(existing),
    exists: true,
    content: existing.content,
    version: fileVersion(existing.filePath, existing.sourceContent, stat.mtimeMs),
    updatedAt: stat.mtime.toISOString()
  };
}

export class LogWriteInputError extends Error {}

function assertUniqueDaySections(content: string): void {
  const seen = new Set<string>();
  for (const heading of buildMarkdownOutline(content)) {
    if (heading.level !== 3) continue;
    const title = heading.text.replace(/^\d+\.\s+/, "").trim();
    const key = title.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    if (seen.has(key)) throw new LogWriteInputError(`同一天不能保存两个“${title}”小节，请修改重复标题后重试`);
    seen.add(key);
  }
}
export class LogConflictError extends Error {
  constructor() { super("源文件已变化，未覆盖。请保留当前草稿并重新读取后核对。"); }
}

// Serialize the target-file decision as well as the write. A new day may select
// either the existing yearly file or a monthly file created by an earlier write.
const writeQueues = new Map<string, Promise<void>>();
async function withWriteQueue<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(root) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  writeQueues.set(root, current);
  await previous;
  try { return await operation(); }
  finally { release(); if (writeQueues.get(root) === current) writeQueues.delete(root); }
}

export async function assertUnlinkedPath(target: string): Promise<void> {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("Linked storage path is not permitted");
  }
}

async function existingRegularFile(file: string): Promise<boolean> {
  await assertUnlinkedPath(file);
  const stat = await fs.lstat(file).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (stat && !stat.isFile()) throw new Error("Source must be a regular file");
  return Boolean(stat);
}

function boundaryAfter(prefix: string, newline: string): string {
  if (!prefix) return "";
  return prefix.endsWith(newline + newline) ? "" : prefix.endsWith(newline) ? newline : newline + newline;
}

function replaceOrInsert(source: string, file: LogFile, date: string, normalized: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const block = `${normalized.replace(/\r?\n/g, newline).trimEnd()}${newline}${newline}---`;
  const blocks = parseBlocks(source, file);
  const existing = blocks.find(item => item.date === date);
  if (existing) {
    const suffix = source.slice(existing.end);
    // The unedited prefix and following day blocks remain byte-for-byte intact.
    return source.slice(0, existing.start) + block + newline + (suffix ? newline : "") + suffix;
  }
  const next = blocks.find(item => item.date > date);
  const at = next?.start ?? source.length;
  const prefix = source.slice(0, at);
  const suffix = source.slice(at);
  let boundary = boundaryAfter(prefix, newline);
  if (blocks.some(item => item.start < at) && !/(?:^|\r?\n)[ \t]*---[ \t]*$/.test(prefix.trimEnd())) {
    boundary += `---${newline}${newline}`;
  }
  return prefix + boundary + block + newline + (suffix ? newline : "") + suffix;
}

async function sourceVersion(file: string): Promise<string | null> {
  if (!(await existingRegularFile(file))) return null;
  const content = await readText(file);
  const stat = await fs.stat(file);
  return fileVersion(file, content, stat.mtimeMs);
}

function assertMutationVersion(input: { date: string; baseVersion: string | null }): void {
  if (!input || typeof input !== "object" || !Object.hasOwn(input, "baseVersion") ||
    !(input.baseVersion === null || typeof input.baseVersion === "string" && input.baseVersion.length > 0) ||
    typeof input.date !== "string" || !isValidLogDate(input.date)) {
    throw new LogWriteInputError("需要有效日期和 baseVersion（非空字符串或 null）");
  }
}

export async function saveDay(input: SaveDayInput, missingDaySourceFileName?: string): Promise<DayEntry> {
  assertMutationVersion(input);
  if (typeof input.content !== "string" || (input.mode !== undefined && input.mode !== "replace" && input.mode !== "append")) {
    throw new LogWriteInputError("需要有效正文；mode 仅支持 replace 或 append");
  }
  // Only trusted backup metadata supplies this internal hint. Public writes
  // pass one argument and cannot choose a source filename or filesystem path.
  if (missingDaySourceFileName !== undefined && ![`${toMonth(input.date)}_学习日志.md`, `${input.date.slice(0, 4)}_学习日志.md`].includes(missingDaySourceFileName)) {
    throw new LogWriteInputError("历史源文件与日块年月不匹配");
  }
  assertLogDateIsNotFuture(input.date);
  const normalized = normalizeDayContent(input.date, input.content);
  return mutateDay(input.date, input.baseVersion, current => {
    if (input.mode !== "append" || !current) return normalized;
    const incoming = normalized.replace(/^##\s+\d{4}-\d{2}-\d{2}[^\S\r\n]*\r?\n/, "").trim();
    return incoming ? `${current.content.trimEnd()}\n\n${incoming}` : current.content;
  }, missingDaySourceFileName);
}

export async function deleteDay(input: DeleteDayInput): Promise<DayEntry> {
  assertMutationVersion(input);
  if (input.baseVersion === null) throw new LogWriteInputError("删除日块必须提供当前非空 baseVersion");
  return mutateDay(input.date, input.baseVersion, () => null);
}

async function mutateDay(date: string, baseVersion: string | null, replacement: (current: ParsedBlock | undefined) => string | null, missingDaySourceFileName?: string): Promise<DayEntry> {
  const root = getLogRoot();
  const backupRoot = getBackupRoot();
  return withWriteQueue(root, async () => {
    await assertUnlinkedPath(root);
    const blocks = await readBlocks(toMonth(date));
    const existing = blocks.find(block => block.date === date);
    const monthlyName = `${toMonth(date)}_学习日志.md`;
    const yearlyName = `${date.slice(0, 4)}_学习日志.md`;
    const fileName = existing?.fileName || missingDaySourceFileName ||
      (await existingRegularFile(path.join(root, monthlyName)) ? monthlyName :
        await existingRegularFile(path.join(root, yearlyName)) ? yearlyName : monthlyName);
    const file: LogFile = { fileName, filePath: path.join(root, fileName) };
    const present = await existingRegularFile(file.filePath);
    // Reuse the day lookup's source snapshot for an existing day.
    const source = existing?.sourceContent ?? (present ? await readText(file.filePath) : "");
    const stat = present ? await fs.stat(file.filePath) : null;
    const version = stat ? fileVersion(file.filePath, source, stat.mtimeMs) : null;
    const currentBlocks = parseBlocks(source, file);
    const currentDay = currentBlocks.find(block => block.date === date);
    if (baseVersion === null ? Boolean(currentDay) : !currentDay || baseVersion !== version) {
      throw new LogConflictError();
    }
    const normalized = replacement(currentDay);
    if (normalized !== null) assertUniqueDaySections(normalized);
    const next = normalized === null
      ? source.slice(0, currentDay!.start) + source.slice(currentDay!.end)
      : replaceOrInsert(source, file, date, normalized);
    const nextBlocks = parseBlocks(next, file);
    const updated = nextBlocks.find(block => block.date === date);
    if ((normalized === null ? Boolean(updated) : !updated) || new Set(nextBlocks.map(block => block.date)).size !== nextBlocks.length) {
      throw new LogWriteInputError("日块结构无效，未写入源文件");
    }
    if (present && logHistoryPolicy().enabled) {
      await assertUnlinkedPath(backupRoot);
      await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
      const backup = path.join(backupRoot, `${fileName}.${new Date().toISOString().replace(/[:.]/g, "-")}.${crypto.randomUUID()}.bak`);
      await fs.writeFile(backup, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    const temporary = path.join(root, `.${fileName}.${crypto.randomUUID()}.tmp`);
    let committed = false;
    let savedVersion = "";
    let savedUpdatedAt = "";
    try {
      await fs.writeFile(temporary, next, { encoding: "utf8", flag: "wx", mode: stat?.mode ?? 0o600 });
      const preparedStat = await fs.stat(temporary);
      savedVersion = fileVersion(file.filePath, next, preparedStat.mtimeMs);
      savedUpdatedAt = preparedStat.mtime.toISOString();
      // Detect external changes during preparation; do not overwrite a newer source.
      if (await sourceVersion(file.filePath) !== version) throw new LogConflictError();
      await fs.rename(temporary, file.filePath);
      committed = true;
    } finally {
      if (!committed) await fs.unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    }
    // Retention failure must not report an already committed save as failed.
    await assertUnlinkedPath(backupRoot).then(() => expireLogHistory(fileName)).catch(() => {});
    if (!updated) return {
      date, month: toMonth(date), fileName: `${toMonth(date)}_学习日志.md`, headings: [], preview: "",
      exists: false, content: `## ${date}\n\n`, version: null, updatedAt: null
    };
    return { ...toDaySummary(updated), exists: true, content: updated.content,
      version: savedVersion, updatedAt: savedUpdatedAt };
  });
}
