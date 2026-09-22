import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { getBackupRoot, getLogRoot } from "./config.ts";
import { compareNoteUpdates } from "./note-order.ts";
import { normalizeNoteInput, noteVersion, parseNoteBlocks, toStudyNote, updateNotesMarkdown } from "./notes-markdown.ts";
import { NoteConflictError, NoteFormatError, NoteInputError, NoteNotFoundError, NoteRecoveryError,
  type StoredNote, type StudyNote, type StudyNoteFacet, type StudyNoteInput, type StudyNotesPayload, type UpdateStudyNoteInput, type BatchStudyNoteInput } from "./notes-types.ts";
export type { StudyNoteInput, UpdateStudyNoteInput, BatchStudyNoteInput } from "./notes-types.ts";
export { parseNotesMarkdown } from "./notes-markdown.ts";

const FILE_PATTERN = /^(\d{4})_随记\.md$/;
const PENDING_FILE = ".pending-write.json";
const queues = new Map<string, Promise<unknown>>();
type Snapshot = { year: string; content: string | null; notes: StoredNote[] };
type Change = { before: Snapshot; after: string };

function withQueue<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(root, next);
  void next.finally(() => { if (queues.get(root) === next) queues.delete(root); }).catch(() => {});
  return next;
}

async function lstat(file: string) {
  try { return await fs.lstat(file, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function checkedDirectory(directory: string, allowMissing = false): Promise<void> {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat && allowMissing) continue;
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Invalid notes directory");
  }
}
async function readText(file: string): Promise<string | null> {
  await checkedDirectory(path.dirname(file), true);
  const stat = await lstat(file);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid notes source file");
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({ bigint: true });
    // On Windows lstat reports dev=0 while fstat reports the volume serial.
    if (!opened.isFile() || stat.ino !== opened.ino || (process.platform !== "win32" && stat.dev !== opened.dev)) throw new NoteConflictError();
    const content = await handle.readFile("utf8");
    const finished = await handle.stat({ bigint: true });
    if (finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs) throw new NoteConflictError();
    await checkedDirectory(path.dirname(file));
    const after = await lstat(file);
    if (!after?.isFile() || after.isSymbolicLink() || after.ino !== opened.ino || (process.platform !== "win32" && after.dev !== opened.dev)) throw new NoteConflictError();
    return content;
  } finally { await handle.close(); }
}
function fileFor(root: string, year: string): string { return path.join(root, `${year}_随记.md`); }

async function assertReady(root: string): Promise<void> {
  await checkedDirectory(path.dirname(root));
  await checkedDirectory(root, true);
  if (await lstat(path.join(root, PENDING_FILE))) throw new NoteRecoveryError();
}
async function readSnapshots(root: string): Promise<Snapshot[]> {
  await assertReady(root);
  if (!await lstat(root)) return [];
  const names = await fs.readdir(root);
  const snapshots: Snapshot[] = [];
  const ids = new Set<string>();
  for (const name of names.sort()) {
    const match = name.match(FILE_PATTERN);
    if (!match) continue;
    const content = await readText(path.join(root, name));
    if (content === null) throw new NoteConflictError();
    const notes = parseNoteBlocks(content, match[1]).map(block => block.note);
    for (const note of notes) { if (ids.has(note.id)) throw new NoteFormatError(); ids.add(note.id); }
    snapshots.push({ year: match[1], content, notes });
  }
  return snapshots;
}
async function writeExclusive(file: string, content: string): Promise<void> {
  await checkedDirectory(path.dirname(file));
  const handle = await fs.open(file, "wx", 0o600);
  let complete = false;
  try { await handle.writeFile(content, "utf8"); await handle.sync(); complete = true; }
  finally {
    await handle.close();
    if (!complete) await removeOwnedFile(file).catch(() => {});
  }
}
async function removeOwnedFile(file: string): Promise<void> {
  await checkedDirectory(path.dirname(file));
  const stat = await lstat(file);
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid temporary notes file");
  await fs.unlink(file);
}

async function writeChanges(root: string, backupRoot: string, changes: Change[]): Promise<void> {
  await assertReady(root);
  await checkedDirectory(backupRoot, true);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await checkedDirectory(root);
  const id = crypto.randomUUID(), stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staged: Array<Change & { temporary: string; backup: string | null }> = [];
  const committed: typeof staged = [];
  const marker = path.join(root, PENDING_FILE);
  let marked = false;
  try {
    for (const change of changes) {
      if (await readText(fileFor(root, change.before.year)) !== change.before.content) throw new NoteConflictError();
      let backup: string | null = null;
      if (change.before.content !== null) {
        await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
        backup = `${change.before.year}_随记.md.${stamp}.${id}.bak`;
        await writeExclusive(path.join(backupRoot, backup), change.before.content);
      }
      const temporary = path.join(root, `.${change.before.year}.${id}.tmp`);
      staged.push({ ...change, temporary, backup });
      await writeExclusive(temporary, change.after);
    }
    // A cross-year move cannot be one filesystem rename. Keep a recovery marker
    // until both atomic replacements finish; ordinary errors roll back below.
    if (staged.length > 1) {
      const entries = staged.map(item => ({ year: item.before.year, existed: item.before.content !== null, backup: item.backup }));
      await writeExclusive(marker, JSON.stringify({ format: 1, transaction: id, entries }) + "\n");
      marked = true;
    }
    for (const item of staged) {
      if (await readText(fileFor(root, item.before.year)) !== item.before.content) throw new NoteConflictError();
      if (await readText(item.temporary) !== item.after) throw new NoteConflictError();
      await fs.rename(item.temporary, fileFor(root, item.before.year));
      committed.push(item);
    }
    if (marked) { await removeOwnedFile(marker); marked = false; }
  } catch (error) {
    let restored = true;
    for (const item of committed.reverse()) {
      try {
        const target = fileFor(root, item.before.year);
        if (await readText(target) !== item.after) throw new NoteConflictError();
        if (item.before.content === null) await removeOwnedFile(target);
        else {
          const rollback = path.join(root, `.${item.before.year}.${id}.rollback.tmp`);
          await writeExclusive(rollback, item.before.content);
          try { await fs.rename(rollback, target); }
          finally { await removeOwnedFile(rollback); }
        }
      } catch { restored = false; }
    }
    if (restored && marked) { await removeOwnedFile(marker); marked = false; }
    if (!restored) throw new NoteRecoveryError();
    throw error;
  } finally {
    for (const item of staged) await removeOwnedFile(item.temporary).catch(() => {});
  }
}

function buildFacets(notes: StudyNote[], key: "year" | "tags"): StudyNoteFacet[] {
  const counts = new Map<string, number>();
  for (const note of notes) for (const value of key === "year" ? [note.year] : [...new Set(note.tags)]) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => key === "year" ? b.value.localeCompare(a.value) : b.count - a.count || a.value.localeCompare(b.value));
}
export async function listStudyNotes(): Promise<StudyNotesPayload> {
  const root = path.join(getLogRoot(), "随记");
  return withQueue(root, async () => {
    const notes = (await readSnapshots(root)).flatMap(snapshot => snapshot.notes).sort(compareNoteUpdates).map(toStudyNote);
    return { notes, years: buildFacets(notes, "year"), tags: buildFacets(notes, "tags") };
  });
}
function snapshotFor(snapshots: Snapshot[], year: string): Snapshot {
  return snapshots.find(snapshot => snapshot.year === year) || { year, content: null, notes: [] };
}
function mutationIdentity(id: unknown, baseVersion: unknown): asserts id is string {
  if (typeof id !== "string" || !id.trim() || typeof baseVersion !== "string" || !baseVersion.trim()) {
    throw new NoteInputError("修改或删除随记需要 id 和当前非空 baseVersion");
  }
}
export async function createStudyNote(input: StudyNoteInput): Promise<StudyNote> {
  const root = path.join(getLogRoot(), "随记"), backupRoot = path.join(getBackupRoot(), "notes");
  return withQueue(root, async () => {
    const next = normalizeNoteInput(input);
    const snapshot = snapshotFor(await readSnapshots(root), next.recordedAt.slice(0, 4));
    await writeChanges(root, backupRoot, [{ before: snapshot, after: updateNotesMarkdown(snapshot.content || "", snapshot.year, next.id, next) }]);
    return toStudyNote(next);
  });
}
function noteBusinessFields(note: StoredNote): string {
  return JSON.stringify([note.title, note.body, note.insight, note.sources, note.tags, note.recordedAt]);
}

/** Client identities make an unchanged batch retry safe after a lost response; they never authorize an update. */
export async function createStudyNotes(input: BatchStudyNoteInput[]): Promise<StudyNote[]> {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw new NoteInputError("每次请保存 1 至 20 条随记");
  const ids = new Set<string>();
  const normalized = input.map(item => {
    if (!item || typeof item !== "object" || typeof item.clientId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(item.clientId)) {
      throw new NoteInputError("每条批量随记都需要有效的 UUID clientId");
    }
    const id = item.clientId.toLowerCase();
    if (ids.has(id)) throw new NoteInputError("同批随记的 clientId 不能重复");
    ids.add(id);
    return { ...normalizeNoteInput(item), id };
  });
  const root = path.join(getLogRoot(), "随记"), backupRoot = path.join(getBackupRoot(), "notes");
  return withQueue(root, async () => {
    const snapshots = await readSnapshots(root);
    const existing = new Map(snapshots.flatMap(snapshot => snapshot.notes).map(note => [note.id, note]));
    const changes = new Map<string, Change>();
    const result: StudyNote[] = [];
    for (const note of normalized) {
      const prior = existing.get(note.id);
      if (prior) {
        if (noteBusinessFields(prior) !== noteBusinessFields(note)) throw new NoteConflictError();
        result.push(toStudyNote(prior));
        continue;
      }
      const year = note.recordedAt.slice(0, 4), before = snapshotFor(snapshots, year);
      const content = changes.get(year)?.after ?? before.content ?? "";
      // Validate the entire batch's Markdown in memory before staging any filesystem writes.
      changes.set(year, { before, after: updateNotesMarkdown(content, year, note.id, note) });
      result.push(toStudyNote(note));
    }
    if (changes.size) await writeChanges(root, backupRoot, [...changes.values()]);
    return result;
  });
}
export async function updateStudyNote(input: UpdateStudyNoteInput): Promise<StudyNote> {
  mutationIdentity(input?.id, input?.baseVersion);
  const root = path.join(getLogRoot(), "随记"), backupRoot = path.join(getBackupRoot(), "notes");
  return withQueue(root, async () => {
    const snapshots = await readSnapshots(root);
    const source = snapshots.find(snapshot => snapshot.notes.some(note => note.id === input.id));
    const existing = source?.notes.find(note => note.id === input.id);
    if (!existing || !source) throw new NoteNotFoundError();
    if (input.baseVersion !== noteVersion(existing)) throw new NoteConflictError();
    const next = normalizeNoteInput(input, existing), year = next.recordedAt.slice(0, 4);
    const destination = snapshotFor(snapshots, year);
    const changes: Change[] = [{ before: destination, after: updateNotesMarkdown(destination.content || "", year, next.id, next) }];
    if (year !== source.year) changes.push({ before: source, after: updateNotesMarkdown(source.content || "", source.year, next.id, null) });
    await writeChanges(root, backupRoot, changes);
    return toStudyNote(next);
  });
}
export async function deleteStudyNote(id: string, baseVersion: string): Promise<void> {
  mutationIdentity(id, baseVersion);
  const root = path.join(getLogRoot(), "随记"), backupRoot = path.join(getBackupRoot(), "notes");
  return withQueue(root, async () => {
    const snapshots = await readSnapshots(root);
    const source = snapshots.find(snapshot => snapshot.notes.some(note => note.id === id));
    const existing = source?.notes.find(note => note.id === id);
    if (!existing || !source) throw new NoteNotFoundError();
    if (baseVersion !== noteVersion(existing)) throw new NoteConflictError();
    await writeChanges(root, backupRoot, [{ before: source, after: updateNotesMarkdown(source.content || "", source.year, id, null) }]);
  });
}
