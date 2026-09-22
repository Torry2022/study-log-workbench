import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as store from "../lib/notes-store.ts";
import * as types from "../lib/notes-types.ts";

const item = (body = "合成候选正文", year = "2026") => ({ clientId: crypto.randomUUID(), title: "合成（标题）", body, insight: "", sources: ["合成来源"], tags: ["合成标签"], recordedAt: `${year}-01-15T09:30` });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-notes-batch-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups"), notes = path.join(data, "随记");
  await fs.mkdir(data); await fs.mkdir(backups);
  const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-notes-batch-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { data, backups, notes, file: year => path.join(notes, `${year}_随记.md`) };
}

test("whole-batch field/identity/Markdown validation precedes every write", async t => {
  const { data, backups } = await fixture(t);
  const same = item();
  for (const batch of [undefined, [], Array.from({ length: 21 }, () => item()), [item(), { ...item(), clientId: undefined }], [item(), { ...item(), clientId: "candidate-1" }], [same, { ...same }], [item(), { ...item(), body: " " }], [item("valid", "2025"), item("```md\nunclosed")]]) {
    await assert.rejects(store.createStudyNotes(batch), types.NoteInputError);
    assert.deepEqual(await fs.readdir(data), []); assert.deepEqual(await fs.readdir(backups), []);
  }
});

test("batch creates all years, preserves neighboring raw CRLF blocks, and returns request-order identities", async t => {
  const { file, backups, notes } = await fixture(t);
  const neighbor = await store.createStudyNote({ body: "原邻条 API（正文）\n\n**原格式**", recordedAt: "2026-02-01T09:30" });
  const original = (await fs.readFile(file("2026"), "utf8")).replace(/\n/g, "\r\n"); await fs.writeFile(file("2026"), original);
  const originalBlock = original.slice(original.indexOf("## 2026-02-01"));
  const input = [item("较早一条", "2025"), item("同年新增", "2026"), item("另一条", "2025")];
  const created = await store.createStudyNotes(input);
  assert.deepEqual(created.map(note => note.id), input.map(note => note.clientId));
  assert.equal((await store.listStudyNotes()).notes.length, 4);
  assert.equal((await store.listStudyNotes()).notes.find(note => note.id === neighbor.id).version, neighbor.version);
  assert.ok((await fs.readFile(file("2026"), "utf8")).includes(originalBlock));
  assert.equal((await fs.readdir(path.join(backups, "notes"))).length, 1);
  assert.ok(!(await fs.readdir(notes)).some(name => name.includes("pending") || name.endsWith(".tmp")));
  const single = await store.createStudyNote({ ...item(), id: input[0].clientId });
  assert.notEqual(single.id, input[0].clientId, "single-create must still assign a server UUID");
});

test("lost-response retry returns original versions/times with no new notes, source writes or backups", async t => {
  const { file, backups } = await fixture(t);
  await store.createStudyNote({ body: "neighbor", recordedAt: "2026-01-01T09:30" });
  const input = [item("  中文 API（正文）\r\n下一行。  "), { ...item("other"), tags: [" tag ", "tag"], sources: [" src ", "src"] }];
  const first = await store.createStudyNotes(input);
  const bytes = await fs.readFile(file("2026"), "utf8"), stat = await fs.stat(file("2026"));
  const backupNames = await fs.readdir(path.join(backups, "notes"));
  const retried = await store.createStudyNotes(input.map(value => ({ ...value, clientId: value.clientId.toUpperCase() })));
  assert.deepEqual(retried, first);
  assert.equal(await fs.readFile(file("2026"), "utf8"), bytes); assert.equal((await fs.stat(file("2026"))).mtimeMs, stat.mtimeMs);
  assert.deepEqual(await fs.readdir(path.join(backups, "notes")), backupNames);
  assert.equal((await store.listStudyNotes()).notes.length, 3);
});

test("same id with changed content or year conflicts without writing any other new batch item", async t => {
  const { data, file, backups } = await fixture(t);
  const input = item(); await store.createStudyNotes([input]);
  const original = await fs.readFile(file("2026"), "utf8");
  for (const changes of [{ body: "different" }, { recordedAt: "2025-01-15T09:30" }, { tags: ["different"] }, { sources: ["different"] }, { title: "different" }, { insight: "different" }]) {
    await assert.rejects(store.createStudyNotes([item("must not exist", "2024"), { ...input, ...changes }]), types.NoteConflictError);
    assert.equal(await fs.readFile(file("2026"), "utf8"), original);
    assert.deepEqual(await fs.readdir(path.join(data, "随记")), ["2026_随记.md"]); assert.deepEqual(await fs.readdir(backups), []);
  }
});

test("concurrent identical requests serialize to one append and one prewrite backup", async t => {
  const { backups } = await fixture(t);
  await store.createStudyNote({ body: "neighbor", recordedAt: "2026-01-01T09:30" });
  const input = [item("first"), item("second")];
  const replies = await Promise.all(Array.from({ length: 5 }, () => store.createStudyNotes(input)));
  for (const reply of replies) assert.deepEqual(reply, replies[0]);
  assert.equal((await store.listStudyNotes()).notes.length, 3);
  assert.equal((await fs.readdir(path.join(backups, "notes"))).length, 1);
});

test("second-year replacement failure rolls back existing bytes and removes newly created first-year files", async t => {
  const { file, notes } = await fixture(t);
  await store.createStudyNote({ body: "existing 2026", recordedAt: "2026-01-01T09:30" });
  const original = await fs.readFile(file("2026"), "utf8");
  const rename = fs.rename;
  try {
    fs.rename = async (from, to) => { if (to === file("2026")) throw new Error("synthetic replacement failure"); return rename(from, to); };
    await assert.rejects(store.createStudyNotes([item("new first year", "2025"), item("second year", "2026")]), /replacement failure/);
  } finally { fs.rename = rename; }
  await assert.rejects(fs.stat(file("2025")), { code: "ENOENT" });
  assert.equal(await fs.readFile(file("2026"), "utf8"), original);
  assert.deepEqual(await fs.readdir(notes), ["2026_随记.md"]);

  await store.createStudyNote({ body: "existing 2025", recordedAt: "2025-01-01T09:30" });
  const old2025 = await fs.readFile(file("2025"), "utf8");
  try {
    fs.rename = async (from, to) => { if (to === file("2026")) throw new Error("synthetic replacement failure"); return rename(from, to); };
    await assert.rejects(store.createStudyNotes([item("change first", "2025"), item("change second", "2026")]), /replacement failure/);
  } finally { fs.rename = rename; }
  assert.equal(await fs.readFile(file("2025"), "utf8"), old2025); assert.equal(await fs.readFile(file("2026"), "utf8"), original);
  assert.equal((await store.listStudyNotes()).notes.length, 2);
});

test("rollback failure retains the recovery marker and exact backups, blocking retries", async t => {
  const { file, notes, backups } = await fixture(t);
  for (const year of ["2025", "2026"]) await store.createStudyNote({ body: `existing ${year}`, recordedAt: `${year}-01-01T09:30` });
  const originals = await Promise.all(["2025", "2026"].map(year => fs.readFile(file(year), "utf8")));
  const input = [item("first", "2025"), item("second", "2026")];
  const rename = fs.rename; let calls = 0;
  try {
    fs.rename = async (...args) => { if (++calls >= 2) throw new Error("synthetic persistent failure"); return rename(...args); };
    await assert.rejects(store.createStudyNotes(input), types.NoteRecoveryError);
  } finally { fs.rename = rename; }
  const marker = JSON.parse(await fs.readFile(path.join(notes, ".pending-write.json"), "utf8")); assert.equal(marker.entries.length, 2);
  const retained = await Promise.all(marker.entries.map(entry => fs.readFile(path.join(backups, "notes", entry.backup), "utf8")));
  assert.ok(originals.every(bytes => retained.includes(bytes)));
  await assert.rejects(store.createStudyNotes(input), types.NoteRecoveryError);
});

test("batch API authenticates first, bounds real JSON stream and exposes safe conflict/recovery errors", async t => {
  const { notes } = await fixture(t);
  const source = await fs.readFile(new URL("../app/api/notes/batch/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} }; let authorized = false;
  runInNewContext(outputText, { Response, TextDecoder, Buffer, exports: module.exports, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/notes-store") return store;
    if (name === "@/lib/notes-types") return types;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const route = module.exports.POST;
  assert.equal((await route({ get body() { assert.fail("anonymous request read"); } })).status, 401);
  authorized = true;
  const send = value => route(new Request("http://localhost", { method: "POST", body: JSON.stringify(value) }));
  assert.equal((await send({ notes: [{ body: "no client ID", recordedAt: "2026-01-01T09:30" }] })).status, 400);
  const input = item(); const first = await send({ notes: [input] }); assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await (await send({ notes: [input] })).json(), await first.json());
  const conflict = await send({ notes: [{ ...input, body: "different" }] }); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "NOTE_CONFLICT");
  let canceled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } });
  assert.equal((await route(new Request("http://localhost", { method: "POST", body, duplex: "half" }))).status, 413); assert.equal(canceled, true);
  const open = fs.open;
  try {
    fs.open = async () => { throw new Error("synthetic /private/secret"); };
    const failure = await send({ notes: [item()] }); assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /private|secret/);
  } finally { fs.open = open; }
  await fs.writeFile(path.join(notes, ".pending-write.json"), "{}");
  const recovery = await send({ notes: [input] }); assert.equal(recovery.status, 503); assert.equal((await recovery.json()).code, "NOTES_RECOVERY_REQUIRED");
});
