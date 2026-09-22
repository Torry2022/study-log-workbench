import type { StudyNote, StudyNoteFacet } from "./notes-types.ts";
import { compareNoteUpdates } from "./note-order.ts";

export type NoteDraft = {
  id: string;
  title: string;
  body: string;
  insight: string;
  sourcesText: string;
  tagsText: string;
  recordedAt: string;
  baseVersion: string | null;
};

export function localDateTimeInput(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function noteDateTimeInput(value: string): string {
  return value.slice(0, 16);
}

export function emptyDraft(): NoteDraft {
  return {
    id: "",
    title: "",
    body: "",
    insight: "",
    sourcesText: "",
    tagsText: "",
    recordedAt: localDateTimeInput(),
    baseVersion: null
  };
}

export function noteToDraft(note: StudyNote): NoteDraft {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    insight: note.insight,
    sourcesText: note.sources.join("\n"),
    tagsText: note.tags.join("、"),
    recordedAt: noteDateTimeInput(note.recordedAt),
    baseVersion: note.version
  };
}

export function draftFingerprint(draft: NoteDraft): string {
  return JSON.stringify({
    title: draft.title,
    body: draft.body,
    insight: draft.insight,
    sourcesText: draft.sourcesText,
    tagsText: draft.tagsText,
    recordedAt: draft.recordedAt
  });
}

export function parseTags(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseSources(value: string): string[] {
  return value.split(/\r?\n/).map((source) => source.trim()).filter(Boolean);
}

export function formatNoteTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date).replace(/\//g, "-");
}

export function buildFacets(notes: StudyNote[], key: "year" | "tags"): StudyNoteFacet[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const values = key === "year" ? [note.year] : note.tags;
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => key === "year" ? b.value.localeCompare(a.value) : b.count - a.count || a.value.localeCompare(b.value));
}

export function filterNotes(notes: StudyNote[], year: string, tag: string, query: string): StudyNote[] {
  const needle = query.trim().toLocaleLowerCase();
  return notes.filter(note => (year === "all" || note.year === year) && (tag === "all" || note.tags.includes(tag)) &&
    (!needle || [note.title, note.body, note.insight, note.sources.join(" "), note.tags.join(" ")].join("\n").toLocaleLowerCase().includes(needle)))
    .sort(compareNoteUpdates);
}

export interface NoteInsertion { field: "body" | "insight"; from: number; to: number; valid: boolean }
/** Map an upload's original textarea selection across subsequent input events. */
export function mapNoteInsertion(range: NoteInsertion, before: string, after: string): NoteInsertion {
  if (before === after) return range;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length, nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  const shift = after.length - before.length;
  const map = (position: number, bias: number) => position < start || (position === start && bias < 0)
    ? position : position >= end ? position + shift : bias < 0 ? start : nextEnd;
  const intersects = range.from === range.to ? start < range.from && end > range.from
    : start < range.to && end > range.from;
  return { ...range, from: map(range.from, 1), to: map(range.to, range.from === range.to ? 1 : -1), valid: range.valid && !intersects };
}

export function mergeSavedNote(submitted: NoteDraft, current: NoteDraft, saved: StudyNote) {
  const persisted = noteToDraft(saved);
  const changed = draftFingerprint(current) !== draftFingerprint(submitted);
  return { draft: changed ? { ...current, id: saved.id, baseVersion: saved.version } : persisted,
    baseline: draftFingerprint(persisted), keepEditor: changed };
}
