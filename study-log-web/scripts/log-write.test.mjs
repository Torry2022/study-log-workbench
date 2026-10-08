import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { getDay, saveDay, LogConflictError, LogWriteInputError } from "../lib/log-store.ts";
import { getBackupRoot } from "../lib/config.ts";
import { InvalidDayContentError } from "../lib/day-content.ts";
import { FutureLogDateError } from "../lib/study-date.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-write-test-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups");
  await fs.mkdir(data); await fs.mkdir(backups);
  const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-write-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, data, backups };
}
const create = (date, content = "### 1. 合成练习\n\n合成正文") => saveDay({ date, content, baseVersion: null });

test("forbidden root headings fail create, replace and append before any file or history change", async t => {
  const { data, backups } = await fixture(t);
  const invalid = ["# 一级", "一级\n===", "二级\n---", "##"];
  for (const content of invalid) await assert.rejects(create("2026-01-02", content), InvalidDayContentError);
  assert.deepEqual(await fs.readdir(data), []);
  const day = await create("2026-01-02", "### 已保存\n\n保留正文");
  const source = await fs.readFile(path.join(data, day.fileName));
  for (const mode of ["replace", "append"]) {
    for (const content of invalid) {
      await assert.rejects(saveDay({ date: day.date, content, baseVersion: day.version, mode }), InvalidDayContentError);
      assert.deepEqual(await fs.readFile(path.join(data, day.fileName)), source);
      assert.deepEqual(await fs.readdir(backups), []);
      assert.equal((await getDay(day.date)).version, day.version);
    }
  }
});

test("null creates a missing day, returns the actual complete saved snapshot, and does not invent a backup", async t => {
  const { data, backups } = await fixture(t);
  assert.equal((await getDay("2026-01-02")).version, null);
  const day = await create("2026-01-02");
  assert.equal(day.exists, true); assert.equal(day.fileName, "2026-01_学习日志.md");
  assert.deepEqual(day.headings, ["合成练习"]); assert.ok(day.version); assert.ok(day.updatedAt);
  assert.deepEqual(await getDay(day.date), day);
  assert.equal(await fs.readFile(path.join(data, day.fileName), "utf8"), "## 2026-01-02\n\n### 1. 合成练习\n\n合成正文\n\n---\n");
  assert.deepEqual(await fs.readdir(backups), []);
  await assert.rejects(create(day.date, "another draft"), LogConflictError);
});

test("yearly/monthly selection preserves existing ownership and unrelated day bytes", async t => {
  const { data, backups } = await fixture(t);
  const prefix = "# 合成年份\r\n\r\n## 2026-01-01\r\n\r\nA  \r\n\r\n---\r\n\r\n";
  const originalTarget = "## 2026-01-03\r\n\r\nold\r\n\r\n---\r\n\r\n";
  const suffix = "## 2026-01-05\r\n\r\nB  \r\n\r\n---\r\n";
  const yearPath = path.join(data, "2026_学习日志.md");
  const original = prefix + originalTarget + suffix;
  await fs.writeFile(yearPath, original);
  // An existing monthly file must not move an already-owned yearly day.
  await fs.writeFile(path.join(data, "2026-01_学习日志.md"), "## 2026-01-10\n\nmonthly\n\n---\n");
  const before = await getDay("2026-01-03");
  const saved = await saveDay({ date: before.date, content: "changed", baseVersion: before.version });
  assert.equal(saved.fileName, "2026_学习日志.md");
  const after = await fs.readFile(yearPath, "utf8");
  assert.ok(after.startsWith(prefix)); assert.ok(after.endsWith(suffix));
  assert.ok(after.includes("## 2026-01-03\r\n\r\nchanged\r\n\r\n---\r\n\r\n"));
  assert.equal(await fs.readFile(path.join(backups, (await fs.readdir(backups))[0]), "utf8"), original);
  assert.equal((await create("2026-01-11")).fileName, "2026-01_学习日志.md");
  assert.equal((await create("2026-02-01")).fileName, "2026_学习日志.md");
});

test("null can insert into an existing source but two writers cannot create the same day", async t => {
  await fixture(t);
  await create("2026-03-01");
  assert.equal((await getDay("2026-03-02")).version, null);
  const sameDay = await Promise.allSettled([create("2026-03-02", "one"), create("2026-03-02", "two")]);
  assert.equal(sameDay.filter(item => item.status === "fulfilled").length, 1);
  assert.ok(sameDay.find(item => item.status === "rejected").reason instanceof LogConflictError);
  const otherDays = await Promise.all([create("2026-03-03", "three"), create("2026-03-04", "four")]);
  assert.equal(otherDays.length, 2);
  assert.match((await getDay("2026-03-03")).content, /three/);
  assert.match((await getDay("2026-03-04")).content, /four/);
});

test("existing-day versions conflict after another day changes, and deleted days cannot be resurrected", async t => {
  const { data } = await fixture(t);
  const old = await create("2026-04-01", "original");
  await create("2026-04-02", "other day");
  await assert.rejects(saveDay({ date: old.date, content: "stale", baseVersion: old.version }), LogConflictError);
  assert.match((await getDay(old.date)).content, /original/);
  const fresh = await getDay(old.date);
  await fs.writeFile(path.join(data, fresh.fileName), "## 2026-04-02\n\nother day\n\n---\n");
  await assert.rejects(saveDay({ date: fresh.date, content: "resurrected", baseVersion: fresh.version }), LogConflictError);
  assert.equal((await getDay(fresh.date)).exists, false);
});

test("rejects missing versions, invalid modes/dates/structure and future writes before creating source files", async t => {
  const { data } = await fixture(t);
  for (const input of [null, {}, { date: "2026-01-01", content: "x" },
    { date: "2026-01-01", content: "x", baseVersion: "" },
    { date: "2026-02-30", content: "x", baseVersion: null },
    { date: "2026-01-01", content: "x", baseVersion: null, mode: "unsupported" }]) {
    await assert.rejects(saveDay(input), LogWriteInputError);
  }
  await assert.rejects(create("9999-01-01"), FutureLogDateError);
  await assert.rejects(create("2026-01-01", "text\n\n## 2026-01-02\n\nother day"), InvalidDayContentError);
  await assert.rejects(create("2026-01-01", "## 2026-01-02\n\nwrong top date"), InvalidDayContentError);
  assert.deepEqual(await fs.readdir(data), []);
});

test("same-timestamp write-before backups are unique and retain each overwritten snapshot", async t => {
  const { backups } = await fixture(t);
  let day = await create("2026-05-01", "first");
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ["2026-09-22T01:02:03.004Z"])); }
    static now() { return new RealDate("2026-09-22T01:02:03.004Z").getTime(); }
  };
  try {
    day = await saveDay({ date: day.date, content: "second", baseVersion: day.version });
    await saveDay({ date: day.date, content: "third", baseVersion: day.version });
  } finally { globalThis.Date = RealDate; }
  const names = await fs.readdir(backups);
  assert.equal(names.length, 2); assert.notEqual(names[0], names[1]);
  assert.ok(names.every(name => name.includes("2026-09-22T01-02-03-004Z")));
  const bodies = await Promise.all(names.map(name => fs.readFile(path.join(backups, name), "utf8")));
  assert.ok(bodies.some(body => body.includes("first"))); assert.ok(bodies.some(body => body.includes("second")));
});

test("failed atomic replacement preserves original bytes and backup, then permits a later successful write", async t => {
  const { data, backups } = await fixture(t);
  const day = await create("2026-06-01", "original");
  const file = path.join(data, day.fileName), original = await fs.readFile(file, "utf8");
  const rename = fs.rename;
  try {
    fs.rename = async () => { throw Object.assign(new Error("synthetic rename failure"), { code: "EACCES" }); };
    await assert.rejects(saveDay({ date: day.date, content: "new", baseVersion: day.version }), /synthetic/);
  } finally { fs.rename = rename; }
  assert.equal(await fs.readFile(file, "utf8"), original);
  assert.deepEqual(await fs.readdir(data), [day.fileName]);
  assert.equal(await fs.readFile(path.join(backups, (await fs.readdir(backups))[0]), "utf8"), original);
  assert.match((await saveDay({ date: day.date, content: "retry", baseVersion: day.version })).content, /retry/);
});

test("backup failure prevents source replacement and missing BACKUP_ROOT never falls back to source", async t => {
  const { data, backups } = await fixture(t);
  const day = await create("2026-07-01", "original");
  const original = await fs.readFile(path.join(data, day.fileName), "utf8");
  const writeFile = fs.writeFile;
  try {
    fs.writeFile = async (file, ...args) => {
      if (path.dirname(file) === backups) throw new Error("synthetic backup failure");
      return writeFile(file, ...args);
    };
    await assert.rejects(saveDay({ date: day.date, content: "new", baseVersion: day.version }), /backup failure/);
  } finally { fs.writeFile = writeFile; }
  assert.equal(await fs.readFile(path.join(data, day.fileName), "utf8"), original);
  delete process.env.BACKUP_ROOT;
  assert.throws(() => getBackupRoot(), /BACKUP_ROOT/);
  await assert.rejects(create("2026-07-02"), /BACKUP_ROOT/);
  process.env.BACKUP_ROOT = "relative";
  assert.throws(() => getBackupRoot(), /absolute/);
});

test("an external update during temporary-file preparation is retained and returns conflict", async t => {
  const { data } = await fixture(t);
  const day = await create("2026-08-01", "original");
  const target = path.join(data, day.fileName);
  const external = "## 2026-08-01\n\nexternal update\n\n---\n";
  const writeFile = fs.writeFile;
  try {
    fs.writeFile = async (file, ...args) => {
      const value = await writeFile(file, ...args);
      if (String(file).endsWith(".tmp")) await writeFile(target, external, "utf8");
      return value;
    };
    await assert.rejects(saveDay({ date: day.date, content: "stale write", baseVersion: day.version }), LogConflictError);
  } finally { fs.writeFile = writeFile; }
  assert.equal(await fs.readFile(target, "utf8"), external);
  assert.deepEqual(await fs.readdir(data), [day.fileName]);
});

test("linked backup roots cannot write into another instance", async t => {
  const { root, data } = await fixture(t);
  const day = await create("2026-08-02", "original");
  const outside = path.join(root, "outside"); await fs.mkdir(outside);
  const link = path.join(root, "backup-link");
  await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  process.env.BACKUP_ROOT = link;
  await assert.rejects(saveDay({ date: day.date, content: "new", baseVersion: day.version }), /Linked/);
  assert.deepEqual(await fs.readdir(outside), []);
  assert.match(await fs.readFile(path.join(data, day.fileName), "utf8"), /original/);
});

test("PUT authenticates before reading body and returns stable 400/409/500 without leaking paths", async t => {
  const { root } = await fixture(t);
  const source = await fs.readFile(new URL("../app/api/logs/day/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  let authorized = false, operation = saveDay;
  runInNewContext(code, { exports: module.exports, Response, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/log-store") return { getDay, saveDay: (...args) => operation(...args), LogWriteInputError, LogConflictError };
    if (name === "@/lib/log-read-response") return { logReadResponse: () => assert.fail("PUT used read helper") };
    if (name === "@/lib/day-content") return { InvalidDayContentError };
    if (name === "@/lib/study-date") return { FutureLogDateError };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  assert.equal((await module.exports.PUT({ json: () => assert.fail("unauthenticated body read") })).status, 401);
  authorized = true;
  assert.equal((await module.exports.PUT({ json: async () => { throw new SyntaxError(); } })).status, 400);
  assert.equal((await module.exports.PUT({ json: async () => ({ date: "2026-01-01", content: "x" }) })).status, 400);
  const request = { json: async () => ({ date: "2026-01-01", content: "x", baseVersion: null }) };
  const saved = await module.exports.PUT(request);
  assert.equal(saved.status, 200); assert.ok((await saved.json()).day.version);
  const conflict = await module.exports.PUT(request);
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "LOG_CONFLICT");
  operation = async () => { throw new Error(`synthetic error at ${root}`); };
  const failed = await module.exports.PUT(request);
  assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes(root));
});
