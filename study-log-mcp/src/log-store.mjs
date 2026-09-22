import fs from "node:fs/promises";
import path from "node:path";
import { SourceError, resolveRoots, assertSafePath, readSourceText } from "./paths.mjs";
import { LOG_FILE_PATTERN, assertDate, assertMonth, parseDayBlocks } from "./markdown-source.mjs";
import { HybridRetriever } from "./retrieval.mjs";
export { resolveLogRoot } from "./paths.mjs";

function limit(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SourceError("Expected a finite numeric limit.", "INVALID_ARGUMENT");
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
function summary(block) {
  return { date: block.date, month: block.month, fileName: block.fileName, headings: block.headings, preview: block.preview };
}

export class StudyLogStore {
  constructor(logRoot, options = {}) {
    const roots = resolveRoots({ logRoot, indexRoot: options.indexRoot });
    this.logRoot = roots.logRoot;
    this.indexRoot = roots.indexRoot;
    this.retriever = options.retriever || new HybridRetriever({ ...options.retrieval, logRoot: this.logRoot, indexRoot: this.indexRoot });
  }

  async listLogFiles() {
    await assertSafePath(this.logRoot, { directory: true });
    await assertSafePath(this.indexRoot, { directory: true, allowMissing: true });
    let entries;
    try { entries = await fs.readdir(this.logRoot, { withFileTypes: true }); }
    catch { throw new SourceError("Log directory could not be read.", "SOURCE_UNAVAILABLE"); }
    const files = [];
    for (const entry of entries) {
      if (!LOG_FILE_PATTERN.test(entry.name)) continue;
      if (entry.isSymbolicLink() || !entry.isFile()) throw new SourceError("Matching log sources must be regular files without links.", "UNSAFE_PATH");
      files.push({ fileName: entry.name, filePath: path.join(this.logRoot, entry.name) });
    }
    return files.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  parseBlocks(content, file) { return parseDayBlocks(content, file.fileName); }

  async readAllBlocks() {
    const blocks = [], dates = new Set();
    for (const file of await this.listLogFiles()) {
      const source = await readSourceText(file.filePath);
      for (const block of this.parseBlocks(source, file)) {
        if (dates.has(block.date)) throw new SourceError("Duplicate day dates exist in the log sources.", "DUPLICATE_DATE");
        dates.add(block.date); blocks.push(block);
      }
    }
    return blocks.sort((a, b) => a.date.localeCompare(b.date));
  }

  async listMonths() {
    const groups = new Map();
    for (const block of await this.readAllBlocks()) {
      const group = groups.get(block.month) || { id: block.month, label: block.month, dayCount: 0, firstDate: block.date, lastDate: block.date };
      group.dayCount++; group.lastDate = block.date; groups.set(block.month, group);
    }
    return [...groups.values()].sort((a, b) => b.id.localeCompare(a.id));
  }

  async listDays(month) {
    assertMonth(month);
    return (await this.readAllBlocks()).filter(block => block.month === month).sort((a, b) => b.date.localeCompare(a.date)).map(summary);
  }

  async getDay(date, options = {}) {
    assertDate(date);
    const maxChars = limit(options.maxChars, 12000, 1, 100000);
    const block = (await this.readAllBlocks()).find(block => block.date === date);
    if (!block) throw new SourceError("Log day not found.", "DAY_NOT_FOUND");
    return { ...summary(block), content: block.content.length <= maxChars ? block.content :
      `${block.content.slice(0, maxChars)}\n\n[已截断：原文 ${block.content.length} 字符，本次返回前 ${maxChars} 字符]` };
  }

  async searchLogs(query, options = {}) {
    if (typeof query !== "string" || query.length > 60000) throw new SourceError("Search query must be text up to 60000 characters.", "INVALID_ARGUMENT");
    if (!query.trim()) return [];
    if (options.ignoreCase !== undefined && typeof options.ignoreCase !== "boolean") throw new SourceError("ignoreCase must be boolean.", "INVALID_ARGUMENT");
    const ignoreCase = options.ignoreCase !== false, needle = ignoreCase ? query.trim().toLowerCase() : query.trim();
    const maxResults = limit(options.maxResults, 20, 1, 50), contextLines = limit(options.contextLines, 1, 0, 4);
    const results = [];
    for (const block of await this.readAllBlocks()) {
      const lines = block.content.split(/\r?\n/), matches = [];
      for (let i = 0; i < lines.length && matches.length < 5; i++) {
        if (!(ignoreCase ? lines[i].toLowerCase() : lines[i]).includes(needle)) continue;
        const from = Math.max(0, i - contextLines), to = Math.min(lines.length, i + contextLines + 1);
        matches.push(lines.slice(from, to).map((line, offset) => `${from + offset + 1}: ${line}`).join("\n").trim());
      }
      if (matches.length) results.push({ ...summary(block), matches });
    }
    return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxResults).map(({ preview, ...result }) => result);
  }

  async findRelated(input, options = {}) { return this.retriever.findRelated(await this.readAllBlocks(), input, options); }
  async retrieveContexts(input, options = {}) { return this.retriever.retrieveContexts(await this.readAllBlocks(), input, options); }

  async getRecentContext(options = {}) {
    return (await this.readAllBlocks()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit(options.limit, 7, 1, 30)).map(summary);
  }

  async getStyleExamples(options = {}) {
    if (options.dates !== undefined && (!Array.isArray(options.dates) || options.dates.length > 30)) throw new SourceError("dates must contain at most 30 dates.", "INVALID_ARGUMENT");
    const dates = options.dates?.length ? options.dates : (await this.getRecentContext({ limit: 1 })).map(day => day.date);
    dates.forEach(assertDate);
    const examples = [];
    for (const date of dates) {
      try { examples.push(await this.getDay(date, { maxChars: limit(options.maxChars, 14000, 1, 100000) })); }
      catch (error) { if (error?.code !== "DAY_NOT_FOUND") throw error; }
    }
    return examples;
  }
}
