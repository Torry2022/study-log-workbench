import crypto from "node:crypto";
import { findRootAtxHeadings, stripTrailingStructuralSeparator } from "./day-content.ts";
import { isValidLogDate } from "./study-date.ts";
import { NoteFormatError, NoteInputError, type StoredNote, type StudyNote, type StudyNoteInput } from "./notes-types.ts";

const NOTE_HEADING = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:\s+·\s+(.+?))?\s*$/;
const METADATA = /^<!--\s*study-note\s+(\{.*\})\s*-->\s*$/;
const RESERVED = new Set(["个人理解", "来源", "标签"]);
const MAX_NOTE_CLOCK_SKEW_MS = 10 * 60 * 1000;
export interface NoteBlock { note: StoredNote; start: number; end: number }

export function normalizeNoteRecordedAt(value: string, rejectFuture = true): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\+08:00)?$/);
  if (!match || !isValidLogDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +(match[4] || "0") > 59) {
    throw new NoteInputError("记录时间格式无效");
  }
  const normalized = `${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}+08:00`;
  if (rejectFuture && Date.parse(normalized) > Date.now() + MAX_NOTE_CLOCK_SKEW_MS) {
    throw new NoteInputError("不能创建未来时间的随记");
  }
  return normalized;
}

function editable(value: string, field: string): void {
  for (const heading of findRootAtxHeadings(value)) {
    if (heading.level === 2) throw new NoteInputError(`${field}不能包含二级标题`);
    if (heading.level === 3 && RESERVED.has(heading.text)) throw new NoteInputError(`${field}不能使用保留标题“${heading.text}”`);
  }
}

function stringList(value: unknown, limit: number, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) throw new NoteInputError(`${field}必须是文字数组`);
  return [...new Set(value.map(item => item.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, limit);
}

export function normalizeNoteInput(input: StudyNoteInput, existing?: StoredNote): StoredNote {
  if (!input || typeof input !== "object" || typeof input.body !== "string" || typeof input.recordedAt !== "string" ||
    (input.title !== undefined && typeof input.title !== "string") || (input.insight !== undefined && typeof input.insight !== "string")) {
    throw new NoteInputError("需要有效的随记正文、记录时间和文字字段");
  }
  const title = (input.title || "").replace(/\s+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim(), insight = (input.insight || "").replace(/\r\n/g, "\n").trim();
  if (!body) throw new NoteInputError("随记正文不能为空");
  if (title.length > 120) throw new NoteInputError("随记标题不能超过 120 个字符");
  editable(body, "随记正文"); editable(insight, "个人理解");
  const now = new Date().toISOString();
  return { id: existing?.id || crypto.randomUUID(), title, body, insight,
    sources: stringList(input.sources, 30, "来源"), tags: stringList(input.tags, 20, "标签"),
    recordedAt: normalizeNoteRecordedAt(input.recordedAt), createdAt: existing?.createdAt || now, updatedAt: now };
}

export function noteVersion(note: StoredNote): string {
  return crypto.createHash("sha256").update(JSON.stringify(note)).digest("hex").slice(0, 20);
}

function firstSentence(markdown: string): string {
  const plain = markdown.replace(/```[\s\S]*?```/g, " ").replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?]]/g, (_, target: string, alias?: string) => alias || target)
    .replace(/^#{1,6}\s+/gm, "").replace(/[*_`~>|]/g, "").replace(/\s+/g, " ").trim();
  const sentence = plain.match(/^.*?[。！？.!?](?:\s|$)/)?.[0]?.trim() || plain;
  return !sentence ? "无标题随记" : sentence.length > 42 ? `${sentence.slice(0, 42)}…` : sentence;
}

export function toStudyNote(note: StoredNote): StudyNote {
  return { ...note, year: note.recordedAt.slice(0, 4), version: noteVersion(note), displayTitle: note.title || firstSentence(note.body) };
}

export function parseNoteBlocks(content: string, year?: string): NoteBlock[] {
  const headings = findRootAtxHeadings(content, 2);
  if (!headings.length && content.trim() && !/^# \d{4} 随记\s*$/.test(content.trim())) throw new NoteFormatError();
  const ids = new Set<string>();
  return headings.map((heading, index) => {
    // A title may literally end in hashes; Markdown's parsed heading text strips
    // optional closing hashes, while the storage format keeps the raw title.
    const rawHeading = content.slice(heading.start, heading.end).replace(/^ {0,3}##[ \t]+/, "");
    const match = rawHeading.match(NOTE_HEADING);
    const end = headings[index + 1]?.start ?? content.length;
    if (!match) throw new NoteFormatError();
    const section = stripTrailingStructuralSeparator(content.slice(heading.end, end)).trim();
    const firstEnd = section.indexOf("\n");
    const first = (firstEnd === -1 ? section : section.slice(0, firstEnd)).trim();
    const metadata = first.match(METADATA);
    if (!metadata) throw new NoteFormatError();
    let meta: Partial<StoredNote>;
    try { meta = JSON.parse(metadata[1]); } catch { throw new NoteFormatError(); }
    if (!meta || typeof meta.id !== "string" || !meta.id.trim() || ids.has(meta.id) ||
      typeof meta.createdAt !== "string" || !Number.isFinite(Date.parse(meta.createdAt)) ||
      (meta.updatedAt !== undefined && (typeof meta.updatedAt !== "string" || !Number.isFinite(Date.parse(meta.updatedAt))))) throw new NoteFormatError();
    ids.add(meta.id);
    let recordedAt: string;
    try { recordedAt = normalizeNoteRecordedAt(typeof meta.recordedAt === "string" ? meta.recordedAt : `${match[1]}T${match[2]}`, false); }
    catch { throw new NoteFormatError(); }
    if (recordedAt.slice(0, 10) !== match[1] || recordedAt.slice(11, 16) !== match[2] || (year && !recordedAt.startsWith(year + "-"))) throw new NoteFormatError();
    const body = firstEnd === -1 ? "" : section.slice(firstEnd + 1).replace(/\r\n/g, "\n").trim();
    const markers = findRootAtxHeadings(body, 3).filter(node => RESERVED.has(node.text));
    const fields = new Map<string, string>([["正文", body.slice(0, markers[0]?.start ?? body.length).trim()]]);
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (fields.has(marker.text)) throw new NoteFormatError();
      fields.set(marker.text, body.slice(marker.end, markers[i + 1]?.start ?? body.length).trim());
    }
    const list = (field: string) => (fields.get(field) || "").split(/\r?\n/)
      .map(line => (line.match(/^\s*[-*+]\s+(.+?)\s*$/)?.[1] || line.trim())).filter(Boolean);
    const note: StoredNote = { id: meta.id, title: typeof meta.title === "string" ? meta.title : match[3]?.trim() || "",
      body: fields.get("正文") || "", insight: fields.get("个人理解") || "", sources: list("来源"), tags: list("标签"),
      recordedAt, createdAt: meta.createdAt, updatedAt: meta.updatedAt || recordedAt };
    if (!note.body) throw new NoteFormatError();
    return { note, start: heading.start, end };
  });
}

export function parseNotesMarkdown(content: string): StoredNote[] { return parseNoteBlocks(content).map(block => block.note); }

export function serializeNote(note: StoredNote): string {
  const metadata = JSON.stringify({ id: note.id, recordedAt: note.recordedAt, createdAt: note.createdAt, updatedAt: note.updatedAt });
  const parts = [`## ${note.recordedAt.slice(0, 10)} ${note.recordedAt.slice(11, 16)}${note.title ? ` · ${note.title}` : ""}`, "", `<!-- study-note ${metadata} -->`, "", note.body];
  if (note.insight) parts.push("", "### 个人理解", "", note.insight);
  if (note.sources.length) parts.push("", "### 来源", "", ...note.sources.map(value => `- ${value}`));
  if (note.tags.length) parts.push("", "### 标签", "", ...note.tags.map(value => `- ${value}`));
  return [...parts, "", "---", ""].join("\n");
}

/** Only the selected block is rewritten; all other source bytes remain authoritative. */
export function updateNotesMarkdown(content: string, year: string, id: string, replacement: StoredNote | null): string {
  const blocks = parseNoteBlocks(content, year);
  const existing = blocks.find(block => block.note.id === id);
  const expected = [...blocks.filter(block => block.note.id !== id).map(block => block.note), ...(replacement ? [replacement] : [])];
  function validate(result: string): string {
    try {
      // A dangling fence or HTML comment must not absorb the following note.
      const boundary = "notes-storage-boundary";
      if (findRootAtxHeadings(`${result}\n\n## ${boundary}\n`, 2).at(-1)?.text !== boundary) throw new NoteFormatError();
      const parsed = parseNoteBlocks(result, year).map(block => block.note);
      if (parsed.length !== expected.length || expected.some(note => {
        const actual = parsed.find(value => value.id === note.id);
        return !actual || noteVersion(actual) !== noteVersion(note);
      })) throw new NoteFormatError();
      return result;
    } catch { throw new NoteInputError("随记 Markdown 结构不完整或字段分隔有歧义，未写入随记文件"); }
  }
  let next = existing ? content.slice(0, existing.start) + content.slice(existing.end) : content;
  if (!replacement) return validate(next);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  if (!next) next = `# ${year} 随记${newline}${newline}`;
  const following = parseNoteBlocks(next, year).find(block => block.note.recordedAt < replacement.recordedAt);
  const at = following?.start ?? next.length;
  const prefix = next.slice(0, at), suffix = next.slice(at);
  const boundary = prefix.endsWith(newline + newline) ? "" : prefix.endsWith(newline) ? newline : newline + newline;
  return validate(prefix + boundary + serializeNote(replacement).replace(/\r?\n/g, newline) + (suffix ? newline : "") + suffix);
}
