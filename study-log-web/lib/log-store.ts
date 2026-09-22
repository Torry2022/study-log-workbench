import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getLogRoot, LOG_FILE_PATTERN } from "./config.ts";
import { findLevelTwoHeadings, findRootAtxHeadings, stripTrailingStructuralSeparator } from "./day-content.ts";
import type { DayEntry, DaySummary, MonthSummary } from "./types.ts";
import { isValidLogDate } from "./study-date.ts";


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
    .filter(heading => /^\d+\.\s+/.test(heading.text))
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
  return parseBlocks(content, file).find((block) => block.date === date)?.content || null;
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
