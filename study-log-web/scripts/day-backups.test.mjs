import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { deleteDay, getDay, saveDay, listMonths, LogConflictError, LogWriteInputError } from "../lib/log-store.ts";
import { listDayBackups, previewDayBackup, restoreDayBackup, DayBackupChangedError, DayBackupInputError, DayBackupNotFoundError } from "../lib/day-backup-store.ts";
import { dayBackupErrorResponse, dayBackupHeaders } from "../lib/day-backup-response.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-day-backups-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups");
  await fs.mkdir(data); await fs.mkdir(backups);
  const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-day-backups-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, data, backups };
}
const create = (date, content) => saveDay({ date, content, baseVersion: null });
const restoreInput = preview => ({ date: preview.date, kind: "write", id: preview.id, baseVersion: preview.currentVersion, backupVersion: preview.backupVersion });

test("versioned append preserves the existing body and non-target CRLF bytes", async t => {
  const { data, backups } = await fixture(t);
  const prefix = "# 合成年份\r\n\r\n## 2026-01-01\r\n\r\nA  \r\n\r\n---\r\n\r\n";
  const target = "## 2026-01-03\r\n\r\n### 1. 原文\r\n\r\n原文保留\r\n\r\n---\r\n\r\n";
  const suffix = "## 2026-01-05\r\n\r\nB  \r\n\r\n---\r\n";
  const file = path.join(data, "2026_学习日志.md");
  await fs.writeFile(file, prefix + target + suffix);
  const current = await getDay("2026-01-03");
  const appended = await saveDay({ date: current.date, content: "### 2. 追加\n\n新增内容", baseVersion: current.version, mode: "append" });
  assert.match(appended.content, /原文保留/); assert.match(appended.content, /新增内容/);
  assert.equal(appended.fileName, "2026_学习日志.md");
  const after = await fs.readFile(file, "utf8");
  assert.ok(after.startsWith(prefix)); assert.ok(after.endsWith(suffix));
  assert.equal(await fs.readFile(path.join(backups, (await fs.readdir(backups))[0]), "utf8"), prefix + target + suffix);
  await assert.rejects(saveDay({ date: current.date, content: "stale", baseVersion: current.version, mode: "append" }), LogConflictError);
  await assert.rejects(saveDay({ date: current.date, content: "no version", baseVersion: null, mode: "append" }), LogConflictError);
  const fresh = await saveDay({ date: "2026-01-07", content: "new", baseVersion: null, mode: "append" });
  assert.match(fresh.content, /new/);
});

test("saving a day rejects duplicate section titles before writing source or backup", async t => {
  const { data, backups } = await fixture(t);
  const day = await create("2026-01-09", "### 1. 并发控制\n\n第一节");
  const file = path.join(data, day.fileName);
  const before = await fs.readFile(file, "utf8");
  const backupNames = await fs.readdir(backups);
  const duplicate = /同一天不能保存两个“并发控制”小节/;
  await assert.rejects(
    saveDay({ date: day.date, baseVersion: day.version, content: "### 1. **并发控制**\n\n第一节\n\n### 2. 并发控制\n\n第二节" }),
    error => error instanceof LogWriteInputError && duplicate.test(error.message)
  );
  await assert.rejects(
    saveDay({ date: day.date, baseVersion: day.version, mode: "append", content: "### 2. 并发控制\n\n第二节" }),
    error => error instanceof LogWriteInputError && duplicate.test(error.message)
  );
  assert.equal(await fs.readFile(file, "utf8"), before);
  assert.deepEqual(await fs.readdir(backups), backupNames);
  const saved = await saveDay({ date: day.date, baseVersion: day.version, mode: "append", content: "```markdown\n### 2. 并发控制\n```\n\n### 2. 数据一致性" });
  assert.match(saved.content, /### 2\. 数据一致性/);
});

test("delete removes exactly one day, retains its old snapshot, and conflicts on stale or missing targets", async t => {
  const { data, backups } = await fixture(t);
  const prefix = "# Header\r\n\r\n## 2026-02-01\r\n\r\nA  \r\n\r\n---\r\n\r\n";
  const target = "## 2026-02-03\r\n\r\nDELETE\r\n\r\n---\r\n\r\n";
  const suffix = "## 2026-02-05\r\n\r\nB  \r\n\r\n---\r\n";
  const file = path.join(data, "2026_学习日志.md");
  await fs.writeFile(file, prefix + target + suffix);
  const current = await getDay("2026-02-03");
  await assert.rejects(deleteDay({ date: current.date, baseVersion: null }), LogWriteInputError);
  await assert.rejects(deleteDay({ date: current.date }), LogWriteInputError);
  const result = await deleteDay({ date: current.date, baseVersion: current.version });
  assert.equal(result.exists, false); assert.equal(result.version, null);
  assert.deepEqual(result, await getDay(current.date));
  assert.equal(await fs.readFile(file, "utf8"), prefix + suffix);
  assert.equal(await fs.readFile(path.join(backups, (await fs.readdir(backups))[0]), "utf8"), prefix + target + suffix);
  await assert.rejects(deleteDay({ date: current.date, baseVersion: current.version }), LogConflictError);
  const stale = await getDay("2026-02-01");
  await create("2026-02-06", "new day");
  await assert.rejects(deleteDay({ date: stale.date, baseVersion: stale.version }), LogConflictError);
});

test("deleting the only day keeps the source file and never deletes backups", async t => {
  const { data, backups } = await fixture(t);
  const day = await create("2026-03-01", "only day");
  await deleteDay({ date: day.date, baseVersion: day.version });
  assert.equal(await fs.readFile(path.join(data, day.fileName), "utf8"), "");
  assert.deepEqual(await listMonths(), []);
  assert.equal((await fs.readdir(backups)).length, 1);
});

test("preview and restore use just the selected historical day and preserve newer neighbors", async t => {
  const { data, backups } = await fixture(t);
  await create("2026-04-01", "historical target");
  let neighbor = await create("2026-04-02", "neighbor old");
  let target = await getDay("2026-04-01");
  await saveDay({ date: target.date, content: "target current", baseVersion: target.version });
  neighbor = await getDay(neighbor.date);
  await saveDay({ date: neighbor.date, content: "neighbor NEW must survive", baseVersion: neighbor.version });
  const listed = await listDayBackups(target.date);
  assert.equal(listed.nextCursor, null); assert.equal(listed.write.length, 2);
  const previews = await Promise.all(listed.write.map(item => previewDayBackup(target.date, "write", item.id)));
  const preview = previews.find(item => item.historicalContent.includes("historical target"));
  assert.ok(preview); assert.match(preview.currentContent, /target current/); assert.match(preview.backupVersion, /^[a-f0-9]{64}$/);
  const before = await fs.readFile(path.join(data, target.fileName), "utf8");
  const savedCount = (await fs.readdir(backups)).length;
  const restored = await restoreDayBackup(restoreInput(preview));
  assert.match(restored.content, /historical target/);
  assert.match((await getDay(neighbor.date)).content, /neighbor NEW must survive/);
  const backupNames = await fs.readdir(backups);
  assert.equal(backupNames.length, savedCount + 1);
  assert.ok((await Promise.all(backupNames.map(name => fs.readFile(path.join(backups, name), "utf8")))).includes(before));
  await assert.rejects(restoreDayBackup(restoreInput(preview)), LogConflictError);
});

test("backup preview detects content replacement even if filename and mtime are unchanged", async t => {
  const { data, backups } = await fixture(t);
  const old = await create("2026-05-01", "original");
  const current = await saveDay({ date: old.date, content: "current", baseVersion: old.version });
  const id = (await listDayBackups(old.date)).write[0].id;
  const preview = await previewDayBackup(old.date, "write", id);
  const file = path.join(backups, id), stat = await fs.stat(file);
  await fs.writeFile(file, "## 2026-05-01\n\naltered!\n\n---\n");
  await fs.utimes(file, stat.atime, stat.mtime);
  await assert.rejects(restoreDayBackup(restoreInput(preview)), DayBackupChangedError);
  assert.match((await getDay(old.date)).content, /current/);
  assert.equal(await fs.readFile(path.join(data, current.fileName), "utf8"), "## 2026-05-01\n\ncurrent\n\n---\n");
  assert.notEqual((await previewDayBackup(old.date, "write", id)).backupVersion, preview.backupVersion);
});

test("a deleted day restores with explicit null but cannot overwrite a concurrently recreated day", async t => {
  await fixture(t);
  const old = await create("2026-06-01", "restore me");
  await deleteDay({ date: old.date, baseVersion: old.version });
  const id = (await listDayBackups(old.date)).write[0].id;
  const preview = await previewDayBackup(old.date, "write", id);
  assert.equal(preview.currentVersion, null);
  const restored = await restoreDayBackup(restoreInput(preview));
  assert.match(restored.content, /restore me/);
  await assert.rejects(restoreDayBackup(restoreInput(preview)), LogConflictError);
});

test("missing-day restore returns to its historical yearly file, but an existing monthly day stays monthly", async t => {
  const { data } = await fixture(t);
  const date = "2026-06-03", yearFile = path.join(data, "2026_学习日志.md"), monthFile = path.join(data, "2026-06_学习日志.md");
  const neighbor = "## 2026-06-01\r\n\r\nYEAR NEIGHBOR  \r\n\r\n---\r\n\r\n";
  await fs.writeFile(yearFile, neighbor + `## ${date}\r\n\r\nHISTORICAL\r\n\r\n---\r\n`);
  const monthly = "## 2026-06-10\n\nMONTH NEIGHBOR  \n\n---\n";
  await fs.writeFile(monthFile, monthly);
  let day = await getDay(date);
  await deleteDay({ date, baseVersion: day.version });
  const id = (await listDayBackups(date)).write[0].id;
  const missingPreview = await previewDayBackup(date, "write", id);
  day = await restoreDayBackup(restoreInput(missingPreview));
  assert.equal(day.fileName, "2026_学习日志.md");
  assert.ok((await fs.readFile(yearFile, "utf8")).startsWith(neighbor));
  assert.equal(await fs.readFile(monthFile, "utf8"), monthly);
  await deleteDay({ date, baseVersion: day.version });
  day = await create(date, "RECREATED MONTHLY");
  assert.equal(day.fileName, "2026-06_学习日志.md");
  const existingPreview = await previewDayBackup(date, "write", id);
  const restored = await restoreDayBackup(restoreInput(existingPreview));
  assert.equal(restored.fileName, "2026-06_学习日志.md");
  assert.equal(await fs.readFile(yearFile, "utf8"), neighbor);
  assert.ok((await fs.readFile(monthFile, "utf8")).endsWith(monthly));
});

test("bounded backup scans paginate past repeated snapshots and handle current and legacy filenames", async t => {
  const { backups } = await fixture(t);
  const date = "2026-07-01", fileName = "2026-07_学习日志.md";
  for (let index = 0; index < 70; index++) {
    const id = `${fileName}.2026-09-22T01-02-03-${String(index).padStart(3, "0")}Z.00000000-0000-4000-8000-000000000000.bak`;
    await fs.writeFile(path.join(backups, id), `## ${date}\n\nrepeated\n\n---\n`);
  }
  await fs.writeFile(path.join(backups, `${fileName}.20260921-010203.bak`), `## ${date}\n\nolder distinct\n\n---\n`);
  const readFile = fs.readFile; let reads = 0;
  fs.readFile = async (file, ...args) => { if (path.dirname(String(file)) === backups) reads++; return readFile(file, ...args); };
  let first;
  try { first = await listDayBackups(date); } finally { fs.readFile = readFile; }
  assert.equal(reads, 64); assert.equal(first.write.length, 1); assert.ok(first.nextCursor);
  const second = await listDayBackups(date, first.nextCursor);
  assert.equal(second.write.length, 1); assert.equal(second.nextCursor, null);
  assert.match((await previewDayBackup(date, "write", second.write[0].id)).historicalContent, /older distinct/);
  assert.equal((await fs.readdir(backups)).length, 71);
  await assert.rejects(listDayBackups("2026-07-02", first.nextCursor), DayBackupInputError);
  await assert.rejects(listDayBackups(date, "not a cursor"), DayBackupInputError);
});

test("invalid kinds, traversal, calendar dates and missing versions fail without changing data", async t => {
  const { backups } = await fixture(t);
  const old = await create("2026-08-01", "old");
  await saveDay({ date: old.date, content: "new", baseVersion: old.version });
  const id = (await listDayBackups(old.date)).write[0].id;
  for (const [date, kind, name] of [[old.date, "daily", id], ["2026-02-30", "write", id], [old.date, "write", "../" + id], ["2026-09-01", "write", id]]) {
    await assert.rejects(previewDayBackup(date, kind, name), DayBackupInputError);
  }
  const preview = await previewDayBackup(old.date, "write", id);
  await assert.rejects(restoreDayBackup({ ...restoreInput(preview), baseVersion: undefined }), DayBackupInputError);
  await assert.rejects(restoreDayBackup({ ...restoreInput(preview), backupVersion: undefined }), DayBackupInputError);
  await fs.unlink(path.join(backups, id));
  await assert.rejects(previewDayBackup(old.date, "write", id), DayBackupNotFoundError);
  assert.match((await getDay(old.date)).content, /new/);
});

test("lists at most twenty distinct versions without pruning archives and rejects ambiguous backup dates", async t => {
  const { backups } = await fixture(t);
  const date = "2026-08-02";
  for (let index = 0; index < 22; index++) {
    const id = `2026-08_学习日志.md.2026-09-22T01-02-03-${String(index).padStart(3, "0")}Z.00000000-0000-4000-8000-000000000000.bak`;
    await fs.writeFile(path.join(backups, id), `## ${date}\n\nversion ${index}\n\n---\n`);
  }
  const list = await listDayBackups(date);
  assert.equal(list.write.length, 20); assert.equal(list.nextCursor, null);
  assert.equal((await fs.readdir(backups)).length, 22);
  const id = list.write[0].id;
  const source = await fs.readFile(path.join(backups, id), "utf8");
  await fs.writeFile(path.join(backups, id), `${source}\n## ${date}\n\nambiguous second day\n`);
  await assert.rejects(previewDayBackup(date, "write", id), LogWriteInputError);
});

test("a linked backup root is rejected and permission errors are not shown as an empty list", async t => {
  const { root, backups } = await fixture(t);
  const link = path.join(root, "linked-backups");
  await fs.symlink(backups, link, process.platform === "win32" ? "junction" : "dir");
  process.env.BACKUP_ROOT = link;
  await assert.rejects(listDayBackups("2026-01-01"), /Linked/);
  process.env.BACKUP_ROOT = backups;
  const readdir = fs.readdir;
  fs.readdir = async (file, ...args) => { if (file === backups) throw Object.assign(new Error("denied"), { code: "EACCES" }); return readdir(file, ...args); };
  try { await assert.rejects(listDayBackups("2026-01-01"), /denied/); } finally { fs.readdir = readdir; }
});

test("delete and restore failures retain source bytes, existing backups and release the write queue", async t => {
  const { data, backups } = await fixture(t);
  const day = await create("2026-09-01", "original");
  const current = await saveDay({ date: day.date, content: "current", baseVersion: day.version });
  const preview = await previewDayBackup(day.date, "write", (await listDayBackups(day.date)).write[0].id);
  const file = path.join(data, day.fileName), original = await fs.readFile(file, "utf8");
  const rename = fs.rename;
  fs.rename = async () => { throw new Error("synthetic rename failure"); };
  try {
    await assert.rejects(deleteDay({ date: day.date, baseVersion: current.version }), /synthetic/);
    await assert.rejects(restoreDayBackup(restoreInput(preview)), /synthetic/);
  } finally { fs.rename = rename; }
  assert.equal(await fs.readFile(file, "utf8"), original);
  assert.equal((await fs.readdir(backups)).length, 3);
  assert.deepEqual(await fs.readdir(data), [day.fileName]);
  assert.equal((await restoreDayBackup(restoreInput(preview))).exists, true);
});

test("backup routes authenticate before parameters and bodies, preserve status and hide storage paths", async t => {
  const { root } = await fixture(t);
  let authorized = false;
  function loadRoute(file) {
    return fs.readFile(new URL(file, import.meta.url), "utf8").then(source => {
      const module = { exports: {} };
      runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
        exports: module.exports, Response,
        require(name) {
          if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
          if (name === "@/lib/day-backup-store") return { listDayBackups, previewDayBackup, restoreDayBackup };
          if (name === "@/lib/day-backup-response") return { dayBackupErrorResponse, dayBackupHeaders };
          throw new Error(`unexpected ${name}`);
        }
      });
      return module.exports;
    });
  }
  const list = await loadRoute("../app/api/backups/route.ts");
  const preview = await loadRoute("../app/api/backups/preview/route.ts");
  const restore = await loadRoute("../app/api/backups/restore/route.ts");
  assert.equal((await list.GET({})).status, 401); assert.equal((await preview.GET({})).status, 401);
  assert.equal((await restore.POST({ json: () => assert.fail("body before auth") })).status, 401);
  authorized = true;
  assert.equal((await list.GET({ nextUrl: new URL("https://example.org?date=invalid") })).status, 400);
  assert.equal((await preview.GET({ nextUrl: new URL("https://example.org?date=2026-01-01&kind=daily&id=unsupported") })).status, 400);
  assert.equal((await restore.POST({ json: async () => { throw new SyntaxError(); } })).status, 400);
  const old = await create("2026-01-01", "historical");
  await saveDay({ date: old.date, content: "current", baseVersion: old.version });
  const listResponse = await list.GET({ nextUrl: new URL(`https://example.org?date=${old.date}`) });
  assert.equal(listResponse.status, 200);
  const id = (await listResponse.json()).backup.write[0].id;
  const previewResponse = await preview.GET({ nextUrl: new URL(`https://example.org?date=${old.date}&kind=write&id=${encodeURIComponent(id)}`) });
  assert.equal(previewResponse.status, 200);
  const payload = (await previewResponse.json()).preview;
  const restored = await restore.POST({ json: async () => restoreInput(payload) });
  assert.equal(restored.status, 200); assert.match((await restored.json()).day.content, /historical/);
  assert.equal((await restore.POST({ json: async () => restoreInput(payload) })).status, 409);
  for (const [error, status] of [[new DayBackupNotFoundError("missing"), 404], [new DayBackupChangedError(), 409], [new Error(`private path ${root}`), 500]]) {
    const response = dayBackupErrorResponse(error);
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes(root));
  }
});

test("DELETE authenticates before the body and exposes version conflicts without raw storage errors", async t => {
  const { root } = await fixture(t);
  let authorized = false, operation = deleteDay;
  const module = { exports: {} };
  const source = await fs.readFile(new URL("../app/api/logs/day/route.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, Response, require(name) {
      if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
      if (name === "@/lib/log-store") return { getDay, saveDay, deleteDay: (...args) => operation(...args), LogConflictError, LogWriteInputError };
      if (["@/lib/log-read-response", "@/lib/day-content", "@/lib/study-date"].includes(name)) return {};
      throw new Error(`unexpected ${name}`);
    }
  });
  assert.equal((await module.exports.DELETE({ json: () => assert.fail("body before authentication") })).status, 401);
  authorized = true;
  assert.equal((await module.exports.DELETE({ json: async () => { throw new SyntaxError(); } })).status, 400);
  assert.equal((await module.exports.DELETE({ json: async () => ({ date: "2026-01-01" }) })).status, 400);
  const day = await create("2026-01-01", "delete me");
  const request = { json: async () => ({ date: day.date, baseVersion: day.version }) };
  const deleted = await module.exports.DELETE(request);
  assert.equal(deleted.status, 200); assert.equal((await deleted.json()).day.exists, false);
  const stale = await module.exports.DELETE(request);
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "LOG_CONFLICT");
  operation = async () => { throw new Error(`sensitive storage ${root}`); };
  const failed = await module.exports.DELETE(request);
  assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes(root));
});
