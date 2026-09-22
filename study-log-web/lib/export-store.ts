import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { getLogRoot, LOG_FILE_PATTERN } from "./config.ts";
import { extractDayBlockFromSource } from "./log-store.ts";
import { listStudyNotes } from "./notes-store.ts";
import { parseNoteBlocks } from "./notes-markdown.ts";
import { checkAssetPath } from "./asset-path.ts";
import { readAssetResponse } from "./asset-read.ts";
import { isValidLogDate, todayInShanghai } from "./study-date.ts";
import { ExportInputError, exportAssetReferences, rewriteExportAssetLinks } from "./export-assets.ts";
export { ExportInputError } from "./export-assets.ts";
export type ExportScope = "day" | "file" | "all" | "notes";
export interface BuiltExport { fileName: string; buffer: Buffer; warnings: string[] }
export class ExportNotFoundError extends Error { constructor() { super("未找到要导出的已保存日块"); } }
export class ExportChangedError extends Error { constructor() { super("导出期间源文件发生变化，请重试"); } }
interface SourceFile { fileName: string; content: string; filePath: string }

async function readSource(filePath: string): Promise<string> {
  await checkAssetPath(filePath);
  const stat = await fs.lstat(filePath, { bigint: true });
  if (!stat.isFile()) throw new Error("Export source is not a regular file");
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    await checkAssetPath(filePath);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.ino !== stat.ino || (process.platform !== "win32" && opened.dev !== stat.dev)) throw new ExportChangedError();
    const content = await handle.readFile("utf8");
    const finished = await handle.stat({ bigint: true });
    if (opened.size !== finished.size || opened.mtimeNs !== finished.mtimeNs) throw new ExportChangedError();
    await checkAssetPath(filePath);
    const after = await fs.lstat(filePath, { bigint: true });
    if (after.ino !== opened.ino || (process.platform !== "win32" && after.dev !== opened.dev)) throw new ExportChangedError();
    return content;
  } finally { await handle.close(); }
}

async function listSources(directory: string, pattern: RegExp): Promise<SourceFile[]> {
  await checkAssetPath(directory);
  const entries = await fs.readdir(directory);
  const files: SourceFile[] = [];
  for (const fileName of entries.filter(name => pattern.test(name)).sort()) {
    const filePath = path.join(directory, fileName);
    files.push({ fileName, filePath, content: await readSource(filePath) });
  }
  return files;
}

/** Strip only real entry metadata; examples inside fenced Markdown stay intact. */
export function stripNoteMetadata(content: string, year: string): string {
  const ranges = parseNoteBlocks(content, year).map(block => {
    const raw = content.slice(block.start, block.end);
    const match = raw.match(/\r?\n(?:[ \t]*\r?\n)*<!--\s*study-note\s+\{[^\r\n]*\}\s*-->\r?\n/);
    if (!match || match.index === undefined) throw new Error("Invalid note metadata");
    return { start: block.start + match.index, end: block.start + match.index + match[0].length };
  });
  let output = content;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  for (const range of ranges.reverse()) output = output.slice(0, range.start) + newline + output.slice(range.end);
  return output;
}

export async function buildLogExport(scope: string | null, date: string | null): Promise<BuiltExport> {
  if (!["day", "file", "all", "notes"].includes(scope || "")) throw new ExportInputError("导出范围无效");
  if ((scope === "day" || scope === "file") && (!date || !isValidLogDate(date))) throw new ExportInputError("此导出范围需要有效日期 YYYY-MM-DD");
  const root = getLogRoot(); await checkAssetPath(root);
  const zip = new AdmZip(), warnings: string[] = [], assets = new Set<string>();
  let sourceFiles: SourceFile[], folder: string;
  const entries: Array<{ name: string; content: string; notes: boolean }> = [];
  if (scope === "notes") {
    await listStudyNotes(); // Reuse note-format, duplicate-id and recovery-marker checks.
    const notesRoot = path.join(root, "随记");
    const present = await fs.lstat(notesRoot).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
    sourceFiles = present ? await listSources(notesRoot, /^\d{4}_随记\.md$/) : [];
    folder = `study-notes-export-${todayInShanghai()}`;
    for (const file of sourceFiles) entries.push({ name: `随记/${file.fileName}`, content: stripNoteMetadata(file.content, file.fileName.slice(0, 4)), notes: true });
  } else {
    const selectedPattern = scope === "all" ? LOG_FILE_PATTERN : new RegExp(`^(?:${date!.slice(0, 4)}|${date!.slice(0, 7)})_学习日志\\.md$`);
    sourceFiles = await listSources(root, selectedPattern);
    if (scope === "all") {
      folder = `study-log-export-${todayInShanghai()}`;
      for (const file of sourceFiles) entries.push({ name: file.fileName, content: file.content, notes: false });
    } else {
      const matches = sourceFiles.map(file => ({ file, day: extractDayBlockFromSource(file.content, file.fileName, date!) })).filter(item => item.day !== null);
      if (!matches.length) throw new ExportNotFoundError();
      if (matches.length !== 1) throw new ExportInputError("源文件中存在重复日期，请先整理源文件");
      const selected = matches[0];
      folder = scope === "day" ? date! : selected.file.fileName.slice(0, -3);
      entries.push({ name: scope === "day" ? `${date}.md` : selected.file.fileName, content: scope === "day" ? selected.day!.trimEnd() + "\n" : selected.file.content, notes: false });
    }
  }
  for (const entry of entries) {
    const references = exportAssetReferences(entry.content, entry.notes);
    zip.addFile(`${folder}/${entry.name}`, Buffer.from(rewriteExportAssetLinks(entry.content, references), "utf8"));
    for (const reference of references) {
      if (assets.has(reference.asset)) continue;
      assets.add(reference.asset);
      const response = await readAssetResponse(root, reference.asset.split("/"));
      if (response.status === 404) { warnings.push(`缺少附件：assets/${reference.asset}（引用于 ${entry.name}）`); continue; }
      if (response.status === 400) throw new ExportInputError("附件包含链接或不安全路径，未生成导出文件");
      if (!response.ok) throw new Error("Export asset could not be read");
      zip.addFile(`${folder}/assets/${reference.asset}`, Buffer.from(await response.arrayBuffer()));
    }
  }
  // Do not label a mixture of changed source snapshots as a completed export.
  for (const file of sourceFiles) if (await readSource(file.filePath) !== file.content) throw new ExportChangedError();
  if (scope === "notes") await listStudyNotes();
  if (warnings.length) zip.addFile(`${folder}/导出说明.txt`, Buffer.from(`以下附件未找到，Markdown 引用已保留。请补齐后重新导出。\n\n${warnings.join("\n")}\n`, "utf8"));
  return { fileName: `${folder}.zip`, buffer: zip.toBuffer(), warnings };
}
