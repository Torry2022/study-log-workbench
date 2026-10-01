import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createStudyNote, deleteStudyNote, listStudyNotes, updateStudyNote } from "../lib/notes-store.ts";
import { normalizeNoteInput, parseNotesMarkdown, serializeNote } from "../lib/notes-markdown.ts";
import { NoteConflictError, NoteFormatError, NoteInputError, NoteNotFoundError, NoteRecoveryError } from "../lib/notes-types.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-notes-test-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups");
  await fs.mkdir(data); await fs.mkdir(backups);
  const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-notes-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, data, backups, notes: path.join(data, "随记"), file: year => path.join(data, "随记", `${year}_随记.md`) };
}
const input = (body = "合成随记正文。", recordedAt = "2026-01-15T09:30") => ({ body, recordedAt });
const patch = (note, changes = {}) => ({ ...note, baseVersion: note.version, ...changes });
const beijingTimestamp = offsetMs => new Date(Date.now() + offsetMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);

test("empty explicit instance is read-only until creation; fields/facets/version survive Markdown roundtrip", async t => {
  const { data, file, backups } = await fixture(t);
  assert.deepEqual(await listStudyNotes(), { notes: [], years: [], tags: [] }); assert.deepEqual(await fs.readdir(data), []);
  const note = await createStudyNote({ ...input(), title: "  合成\n标题 ### ", insight: "个人理解独立保存。", sources: [" https://example.test/source ", "https://example.test/source"], tags: [" 并发 ", "并发", "事务"] });
  assert.equal(note.title, "合成 标题 ###"); assert.equal(note.recordedAt, "2026-01-15T09:30:00+08:00");
  assert.deepEqual(note.tags, ["并发", "事务"]); assert.equal(note.sources.length, 1);
  const bytes = await fs.readFile(file("2026"), "utf8");
  assert.match(bytes, /^# 2026 随记/); assert.match(bytes, /<!-- study-note/); assert.match(bytes, /### 个人理解/);
  const listing = await listStudyNotes(); assert.deepEqual(listing.notes, [note]);
  assert.deepEqual(listing.years, [{ value: "2026", count: 1 }]); assert.equal(listing.tags.length, 2);
  assert.deepEqual(await fs.readdir(backups), []);
  const noTitle = await createStudyNote(input("无标题时以正文首句展示。\r\n后续内容。"));
  assert.equal(noTitle.displayTitle, "无标题时以正文首句展示。");
  assert.ok(!noTitle.body.includes("\r"));
  assert.equal((await listStudyNotes()).notes.length, 2);
});

test("Markdown parser ignores nested fences, quoted/list headings, and metadata examples", async () => {
  const body = ["真正正文。", "", "````md", "## 2025-01-01 01:00 · 伪条目", '<!-- study-note {"id":"fake","createdAt":"2025-01-01"} -->', "```", "### 个人理解", "````", "", "~~~", "### 标签", "~~~", "", "> ### 来源", "", "- 列表", "  ### 个人理解"].join("\n");
  const note = normalizeNoteInput({ ...input(body), insight: "真实心得", tags: ["真实标签"], sources: ["真实来源"] });
  const parsed = parseNotesMarkdown("# 2026 随记\n\n" + serializeNote(note));
  assert.deepEqual(parsed, [note]);
});

test("invalid dates, future times, field types and reserved root headings never create source files", async t => {
  const { data } = await fixture(t);
  for (const value of [null, {}, { ...input(), body: " " }, { ...input(), body: 12 }, { ...input(), tags: "wrong" },
    input("x", "2026-02-30T09:00"), input("x", "2026-01-01T24:00"), input("x", "2026-01-01T23:60"),
    input("x", "9999-01-01T00:00"), input("## 2026-01-01 00:00\n非法分块"), input("### 标签\n非法保留标题"),
    input("```md\n未闭合围栏"), input("<!-- 未闭合注释"),
    { ...input(), insight: "### 来源\n非法保留标题" }]) await assert.rejects(createStudyNote(value), NoteInputError);
  assert.deepEqual(await fs.readdir(data), []);
  delete process.env.LOG_ROOT; await assert.rejects(listStudyNotes(), /LOG_ROOT/);
});

test("small device clock skew saves a note while clearly future times remain invalid", async t => {
  await fixture(t);
  const note = await createStudyNote(input("设备时间快四分钟。", beijingTimestamp(4 * 60 * 1000)));
  assert.equal((await listStudyNotes()).notes[0].id, note.id);
  await assert.rejects(createStudyNote(input("未来时间。", beijingTimestamp(12 * 60 * 1000))), NoteInputError);
  assert.equal((await listStudyNotes()).notes.length, 1);
});

test("updates preserve identity/creation and unedited CRLF blocks, and new versions sort by update time", async t => {
  const { file } = await fixture(t);
  const old = await createStudyNote(input("旧年份资料", "2025-01-01T08:00"));
  const recent = await createStudyNote(input("新年份资料", "2026-02-01T08:00"));
  const other = await createStudyNote(input("同年其他块\n\n**保留格式**", "2025-02-01T08:00"));
  const bytes = (await fs.readFile(file("2025"), "utf8")).replace(/\n/g, "\r\n");
  await fs.writeFile(file("2025"), bytes);
  const untouched = bytes.slice(bytes.indexOf("## 2025-02-01"), bytes.indexOf("## 2025-01-01"));
  const updated = await updateStudyNote(patch(old, { body: "更新旧资料" }));
  assert.equal(updated.id, old.id); assert.equal(updated.createdAt, old.createdAt); assert.notEqual(updated.version, old.version);
  assert.equal((await listStudyNotes()).notes[0].id, old.id);
  assert.ok((await fs.readFile(file("2025"), "utf8")).includes(untouched));
  assert.equal((await listStudyNotes()).notes.find(note => note.id === other.id).version, other.version);
  assert.equal((await listStudyNotes()).notes.find(note => note.id === recent.id).version, recent.version);
});

test("same-millisecond writes retain unique exact-byte backups; deletion retains the yearly file", async t => {
  const { file, backups } = await fixture(t);
  const note = await createStudyNote(input("first"));
  const first = await fs.readFile(file("2026"), "utf8");
  const next = await updateStudyNote(patch(note, { body: "second" }));
  const second = await fs.readFile(file("2026"), "utf8");
  await deleteStudyNote(next.id, next.version);
  assert.deepEqual((await listStudyNotes()).notes, []);
  assert.equal((await fs.readFile(file("2026"), "utf8")).trim(), "# 2026 随记");
  const names = await fs.readdir(path.join(backups, "notes")); assert.equal(names.length, 2); assert.notEqual(names[0], names[1]);
  const versions = await Promise.all(names.map(name => fs.readFile(path.join(backups, "notes", name), "utf8")));
  assert.ok(versions.includes(first)); assert.ok(versions.includes(second));
});

test("missing/stale versions cannot bypass update or deletion, concurrent edits conflict", async t => {
  await fixture(t);
  const note = await createStudyNote(input());
  for (const baseVersion of [undefined, null, ""]) {
    await assert.rejects(updateStudyNote({ ...note, baseVersion }), NoteInputError);
    await assert.rejects(deleteStudyNote(note.id, baseVersion), NoteInputError);
  }
  const results = await Promise.allSettled([updateStudyNote(patch(note, { body: "A" })), updateStudyNote(patch(note, { body: "B" }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(results.find(result => result.status === "rejected").reason instanceof NoteConflictError);
  await assert.rejects(deleteStudyNote(note.id, note.version), NoteConflictError);
  await assert.rejects(deleteStudyNote("missing", "version"), NoteNotFoundError);
});

test("concurrent creates serialize instead of overwriting and malformed source fails closed", async t => {
  const { file } = await fixture(t);
  const notes = await Promise.all([createStudyNote(input("first")), createStudyNote(input("second"))]);
  assert.equal((await listStudyNotes()).notes.length, 2);
  const bad = (await fs.readFile(file("2026"), "utf8")).replace('"id":', '"bad-id":'); await fs.writeFile(file("2026"), bad);
  await assert.rejects(listStudyNotes(), NoteFormatError); await assert.rejects(createStudyNote(input()), NoteFormatError);
  assert.equal(await fs.readFile(file("2026"), "utf8"), bad); assert.equal(notes.length, 2);
});

test("cross-year edits move one note and preserve both yearly neighbors with two backups", async t => {
  const { file, backups, notes } = await fixture(t);
  const moving = await createStudyNote(input("moving", "2025-01-01T10:00"));
  const left = await createStudyNote(input("left", "2025-02-01T10:00"));
  const right = await createStudyNote(input("right", "2026-01-01T10:00"));
  const before = await Promise.all(["2025", "2026"].map(year => fs.readFile(file(year), "utf8")));
  const moved = await updateStudyNote(patch(moving, { recordedAt: "2026-02-01T10:00" }));
  assert.equal(moved.year, "2026"); assert.equal(moved.id, moving.id);
  const listing = await listStudyNotes(); assert.equal(listing.notes.length, 3);
  assert.equal(listing.notes.find(note => note.id === left.id).version, left.version);
  assert.equal(listing.notes.find(note => note.id === right.id).version, right.version);
  assert.equal(parseNotesMarkdown(await fs.readFile(file("2025"), "utf8")).some(note => note.id === moving.id), false);
  const saved = await Promise.all((await fs.readdir(path.join(backups, "notes"))).map(name => fs.readFile(path.join(backups, "notes", name), "utf8")));
  assert.ok(before.every(content => saved.includes(content)));
  assert.ok(!(await fs.readdir(notes)).some(name => name.includes(".tmp") || name.includes("pending")));
});

test("backup failure leaves authoritative bytes unchanged and no mutation temporaries", async t => {
  const { file, backups, notes } = await fixture(t);
  const note = await createStudyNote(input()); const before = await fs.readFile(file("2026"), "utf8");
  const open = fs.open;
  try {
    fs.open = async (target, ...args) => { if (String(target).startsWith(backups + path.sep)) throw new Error("synthetic backup failure"); return open(target, ...args); };
    await assert.rejects(updateStudyNote(patch(note, { body: "must not replace" })), /backup failure/);
  } finally { fs.open = open; }
  assert.equal(await fs.readFile(file("2026"), "utf8"), before);
  assert.deepEqual(await fs.readdir(notes), ["2026_随记.md"]);
});

test("cross-year second replacement failure rolls back the first replacement byte-for-byte", async t => {
  const { file, notes } = await fixture(t);
  const note = await createStudyNote(input("move", "2025-01-01T10:00"));
  await createStudyNote(input("destination"));
  const before = await Promise.all(["2025", "2026"].map(year => fs.readFile(file(year), "utf8")));
  const rename = fs.rename; let failed = false;
  try {
    fs.rename = async (from, to) => { if (!failed && to === file("2025")) { failed = true; throw new Error("synthetic second replacement failure"); } return rename(from, to); };
    await assert.rejects(updateStudyNote(patch(note, { recordedAt: "2026-02-01T10:00" })), /second replacement/);
  } finally { fs.rename = rename; }
  assert.ok(failed);
  assert.deepEqual(await Promise.all(["2025", "2026"].map(year => fs.readFile(file(year), "utf8"))), before);
  assert.equal((await listStudyNotes()).notes.length, 2);
  assert.ok(!(await fs.readdir(notes)).some(name => name.includes("pending") || name.includes(".tmp")));
});

test("an external edit during staging is not overwritten and returns conflict", async t => {
  const { file } = await fixture(t);
  const note = await createStudyNote(input()); const original = await fs.readFile(file("2026"), "utf8");
  const external = original.replace("合成随记正文", "外部更新正文");
  const open = fs.open; let changed = false;
  try {
    fs.open = async (target, ...args) => {
      const handle = await open(target, ...args);
      if (!changed && String(target).endsWith(".tmp")) { changed = true; await fs.writeFile(file("2026"), external); }
      return handle;
    };
    await assert.rejects(updateStudyNote(patch(note, { body: "stale" })), NoteConflictError);
  } finally { fs.open = open; }
  assert.equal(await fs.readFile(file("2026"), "utf8"), external);
});

test("failed move into a new year removes the new destination instead of leaving duplicate notes", async t => {
  const { file } = await fixture(t);
  const note = await createStudyNote(input("move", "2025-01-01T10:00"));
  const original = await fs.readFile(file("2025"), "utf8");
  const rename = fs.rename;
  try {
    fs.rename = async (from, to) => { if (to === file("2025")) throw new Error("synthetic source failure"); return rename(from, to); };
    await assert.rejects(updateStudyNote(patch(note, { recordedAt: "2026-01-01T10:00" })), /source failure/);
  } finally { fs.rename = rename; }
  await assert.rejects(fs.stat(file("2026")), { code: "ENOENT" });
  assert.equal(await fs.readFile(file("2025"), "utf8"), original);
  assert.equal((await listStudyNotes()).notes.length, 1);
});

test("rollback failure retains the recovery marker and write-before backups", async t => {
  const { file, notes, backups } = await fixture(t);
  const note = await createStudyNote(input("move", "2025-01-01T10:00"));
  await createStudyNote(input("destination"));
  const original = await Promise.all(["2025", "2026"].map(year => fs.readFile(file(year), "utf8")));
  const rename = fs.rename; let calls = 0;
  try {
    fs.rename = async (...args) => { if (++calls >= 2) throw new Error("synthetic persistent filesystem failure"); return rename(...args); };
    await assert.rejects(updateStudyNote(patch(note, { recordedAt: "2026-02-01T10:00" })), NoteRecoveryError);
  } finally { fs.rename = rename; }
  await assert.rejects(listStudyNotes(), NoteRecoveryError);
  const marker = JSON.parse(await fs.readFile(path.join(notes, ".pending-write.json"), "utf8"));
  assert.equal(marker.entries.length, 2); assert.ok(marker.entries.every(entry => entry.backup && entry.existed));
  const versions = await Promise.all(marker.entries.map(entry => fs.readFile(path.join(backups, "notes", entry.backup), "utf8")));
  assert.ok(original.every(content => versions.includes(content)));
});

test("unfinished cross-year markers block reads and writes without attempting silent recovery", async t => {
  const { notes, file } = await fixture(t);
  const note = await createStudyNote(input()); const before = await fs.readFile(file("2026"), "utf8");
  await fs.writeFile(path.join(notes, ".pending-write.json"), '{"format":1,"entries":[]}');
  await assert.rejects(listStudyNotes(), NoteRecoveryError);
  await assert.rejects(updateStudyNote(patch(note, { body: "blocked" })), NoteRecoveryError);
  assert.equal(await fs.readFile(file("2026"), "utf8"), before);
});

test("linked notes/data/backup directories cannot read or write a neighboring instance", async t => {
  const { root, data, notes } = await fixture(t);
  const other = path.join(root, "other"); await fs.mkdir(other);
  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(other, notes, type);
  await assert.rejects(listStudyNotes(), /Invalid notes directory/); await assert.rejects(createStudyNote(input()), /Invalid notes directory/);
  await fs.unlink(notes); const note = await createStudyNote(input());
  const backupAlias = path.join(root, "backup-alias"); await fs.symlink(other, backupAlias, type); process.env.BACKUP_ROOT = backupAlias;
  await assert.rejects(updateStudyNote(patch(note, { body: "no outside write" })), /Invalid notes directory/);
  assert.deepEqual(await fs.readdir(other), []);
  const dataAlias = path.join(root, "data-alias"); await fs.symlink(data, dataAlias, type); process.env.LOG_ROOT = dataAlias;
  await assert.rejects(listStudyNotes(), /Invalid notes directory/);
});

test("duplicate identities and file-year mismatch cannot be silently rewritten", async t => {
  const { file } = await fixture(t);
  const note = await createStudyNote(input());
  const content = await fs.readFile(file("2026"), "utf8");
  await fs.writeFile(file("2025"), content.replaceAll("2026", "2025"));
  await assert.rejects(listStudyNotes(), NoteFormatError);
  await fs.writeFile(file("2025"), content);
  await assert.rejects(updateStudyNote(patch(note, { body: "blocked" })), NoteFormatError);
});
