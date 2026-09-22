import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StudyLogStore } from "../src/log-store.mjs";
import { resolveRoots, readSourceText } from "../src/paths.mjs";
import { parseDayBlocks, parseSections } from "../src/markdown-source.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-raw-fixture-"));
  const data = path.join(root, "data"), index = path.join(root, "derived-index");
  await fs.mkdir(data);
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("mcp-raw-fixture-")); await fs.rm(root, { recursive: true, force: true }); });
  return { root, data, index, store: new StudyLogStore(data, { indexRoot: index }) };
}

test("instance roots are mandatory absolute separate paths, without legacy or cwd inference", () => {
  const before = Object.fromEntries(["LOG_ROOT", "INDEX_ROOT", "STUDY_LOG_ROOT", "STUDY_LOG_INDEX_ROOT"].map(key => [key, process.env[key]]));
  try {
    for (const key of Object.keys(before)) delete process.env[key];
    process.env.STUDY_LOG_ROOT = path.resolve("legacy-source"); process.env.STUDY_LOG_INDEX_ROOT = path.resolve("legacy-index");
    assert.throws(() => new StudyLogStore(), /LOG_ROOT/);
    assert.throws(() => resolveRoots({ logRoot: "relative", indexRoot: path.resolve("index") }), /absolute/);
    assert.throws(() => resolveRoots({ logRoot: path.resolve("data") }), /INDEX_ROOT/);
    for (const indexRoot of [path.resolve("data"), path.resolve("data/index"), path.resolve(".")]) assert.throws(() => resolveRoots({ logRoot: path.resolve("data"), indexRoot }), /non-overlapping/);
    process.env.LOG_ROOT = path.resolve("data"); process.env.INDEX_ROOT = path.resolve("index");
    assert.deepEqual(resolveRoots(), { logRoot: process.env.LOG_ROOT, indexRoot: process.env.INDEX_ROOT });
  } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("empty instance lists nothing, style samples are empty, and keyword retrieval does not create an index", async t => {
  const { root, store } = await fixture(t);
  assert.deepEqual(await store.listMonths(), []); assert.deepEqual(await store.listDays("2026-01"), []);
  assert.deepEqual(await store.getStyleExamples(), []);
  const result = await store.retrieveContexts("synthetic topic");
  assert.deepEqual(result.contexts, []); assert.equal(result.retrieval.mode, "lexical_fallback");
  assert.deepEqual(await fs.readdir(root), ["data"]);
});

test("year/month sources preserve real days and source text while excluding other files and directories", async t => {
  const { root, data, store } = await fixture(t);
  const a = "# 年度\r\n\r\n## 2025-12-31\r\n\r\n### 1. 旧主题\r\n\r\nOldEvidence\r\n\r\n---\r\n";
  const b = "## 2026-01-01\n\n### 新主题\n\nNewEvidence\n\n---\n\n## 2026-01-02\n\n### 后续\n\nNewEvidence continued.\n";
  await fs.writeFile(path.join(data, "2025_学习日志.md"), a); await fs.writeFile(path.join(data, "2026-01_学习日志.md"), b);
  for (const dir of ["随记", "知识库", "assets"]) { await fs.mkdir(path.join(data, dir)); await fs.writeFile(path.join(data, dir, "2026_学习日志.md"), "HiddenEvidence"); }
  for (const file of ["other.md", "2026-13_学习日志.md", ".env"]) await fs.writeFile(path.join(data, file), "HiddenEvidence");
  const files = ["2025_学习日志.md", "2026-01_学习日志.md"];
  const before = await Promise.all(files.map(file => fs.stat(path.join(data, file))));
  assert.deepEqual((await store.listMonths()).map(month => [month.id, month.dayCount]), [["2026-01", 2], ["2025-12", 1]]);
  assert.deepEqual((await store.listDays("2026-01")).map(day => day.date), ["2026-01-02", "2026-01-01"]);
  assert.equal((await store.getDay("2025-12-31")).content, "## 2025-12-31\r\n\r\n### 1. 旧主题\r\n\r\nOldEvidence");
  assert.equal((await store.getDay("2025-12-31")).fileName, files[0]);
  assert.deepEqual(await store.searchLogs("HiddenEvidence"), []);
  assert.equal((await store.searchLogs("NewEvidence", { contextLines: 0 }))[0].matches[0].split("\n").length, 1);
  assert.deepEqual(await store.searchLogs("newevidence", { ignoreCase: false }), []);
  assert.equal((await store.searchLogs("newevidence"))[0].date, "2026-01-02");
  assert.equal((await store.getStyleExamples())[0].date, "2026-01-02");
  assert.equal((await store.getStyleExamples({ dates: ["2025-12-31", "2025-12-30"] }))[0].date, "2025-12-31");
  assert.equal(await fs.readFile(path.join(data, files[0]), "utf8"), a); assert.equal(await fs.readFile(path.join(data, files[1]), "utf8"), b);
  for (let i = 0; i < files.length; i++) assert.equal((await fs.stat(path.join(data, files[i]))).mtimeMs, before[i].mtimeMs);
  assert.deepEqual(await fs.readdir(root), ["data"]);
});

test("AST day and H3 parsing ignores nested/mismatched fence markers, quotes, lists and indented code", () => {
  const content = "## 2026-02-01\n\n### 1. RealSection\n\n````md\n## 2026-02-10\n### FakeShortFence\n```\n~~~\n## 2026-02-11\n````\n\n~~~md\n## 2026-02-12\n### FakeTilde\n~~~\n\n> ## 2026-02-13\n> ### Quoted\n\n- ## 2026-02-14\n\n    ## 2026-02-15\n\n### 2. NextSection\n\n正文\n\n---\n\n## 2026-02-02\n\n### SecondDay\n\nend";
  const blocks = parseDayBlocks(content, "2026-02_学习日志.md");
  assert.deepEqual(blocks.map(block => block.date), ["2026-02-01", "2026-02-02"]);
  assert.deepEqual(blocks[0].headings, ["RealSection", "NextSection"]);
  const sections = parseSections(blocks[0]);
  assert.deepEqual(sections.map(section => [section.heading, section.headingIndex]), [["RealSection", 0], ["NextSection", 1]]);
  assert.match(sections[0].body, /## 2026-02-10/); assert.match(sections[0].body, /## 2026-02-12/);
  const unclosed = parseDayBlocks("## 2026-02-01\n\n### Topic\n\n```md\n## 2026-02-02\n---", "2026-02_学习日志.md");
  assert.equal(unclosed.length, 1); assert.ok(unclosed[0].content.endsWith("---"));
});

test("bad calendar dates, source/date mismatches and duplicate dates fail clearly", async t => {
  const { data, store } = await fixture(t), file = path.join(data, "2026-02_学习日志.md");
  for (const content of ["## 2026-02-30\nBad", "## 2025-02-01\nWrong year", "## 2026-03-01\nWrong month", "## 2026-02-01\nOne\n\n## 2026-02-01\nDuplicate"]) {
    await fs.writeFile(file, content); await assert.rejects(store.listMonths());
  }
  await fs.writeFile(file, "## 2026-02-01\nOne"); await fs.writeFile(path.join(data, "2026_学习日志.md"), "## 2026-02-01\nDuplicate");
  await assert.rejects(store.getDay("2026-02-01"), error => error.code === "DUPLICATE_DATE");
  await assert.rejects(store.getDay("2026-02-30"), /calendar date/); await assert.rejects(store.listDays("2026-99"), /Invalid month/);
  await assert.rejects(store.getStyleExamples({ dates: ["invalid"] }), /calendar date/);
});

test("matching links, linked roots and linked index locations are rejected without following data", async t => {
  const { root, data, store } = await fixture(t);
  const outside = path.join(root, "outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "2026_学习日志.md"), "## 2026-01-01\nExternal source");
  const linked = path.join(root, "linked-root"); await fs.symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(new StudyLogStore(linked, { indexRoot: path.join(root, "index") }).listMonths(), error => error.code === "UNSAFE_PATH");
  await assert.rejects(new StudyLogStore(data, { indexRoot: linked }).listMonths(), error => error.code === "UNSAFE_PATH");
  await t.test("matching file symlink", async subtest => {
    try { await fs.symlink(path.join(outside, "2026_学习日志.md"), path.join(data, "2026_学习日志.md")); }
    catch (error) { if (error.code === "EPERM") { subtest.skip("File symlinks require platform privilege; directory junction cases passed."); return; } throw error; }
    await assert.rejects(store.listMonths(), error => error.code === "UNSAFE_PATH");
  });
});

test("invalid UTF-8 and a source changed during the read fail without leaking paths", async t => {
  const { data, store } = await fixture(t), file = path.join(data, "2026_学习日志.md");
  await fs.writeFile(file, Buffer.from([0xff, 0xfe]));
  await assert.rejects(store.listMonths(), error => error.code === "INVALID_SOURCE" && !error.message.includes(data));
  await fs.writeFile(file, "## 2026-01-01\nOriginal");
  const open = fs.open;
  fs.open = async (...args) => {
    const handle = await open(...args), read = handle.readFile.bind(handle);
    handle.readFile = async (...readArgs) => { const bytes = await read(...readArgs); await fs.writeFile(file, "## 2026-01-01\nChanged source length"); return bytes; };
    return handle;
  };
  try { await assert.rejects(readSourceText(file), error => error.code === "SOURCE_CHANGED"); }
  finally { fs.open = open; }
});
