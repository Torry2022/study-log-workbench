import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { searchDayContents, searchLogs } from "../lib/log-search.ts";

const day = (date, content, fileName = `${date.slice(0, 7)}_学习日志.md`) => ({ date, content, fileName });

test("literal search groups by day, keeps first five lines, and sorts dates descending", () => {
  const blocks = [day("2025-12-31", "## 2025-12-31\n### 1. C++\n C++ one \nC++ two\nC++ three\nC++ four\nC++ five\nC++ six", "2025_学习日志.md"),
    day("2026-01-02", "## 2026-01-02\n### C++ and Regex [a-z]+\nbody"),
    day("2026-01-01", "No match")];
  const copy = JSON.stringify(blocks);
  const results = searchDayContents(blocks, "  C++  ");
  assert.deepEqual(results.map(result => result.date), ["2026-01-02", "2025-12-31"]);
  assert.equal(results[1].fileName, "2025_学习日志.md");
  assert.equal(results[1].month, "2025-12");
  assert.deepEqual(results[1].headings, ["C++"]);
  assert.deepEqual(results[1].matches, ["### 1. C++", "C++ one", "C++ two", "C++ three", "C++ four"]);
  assert.equal(searchDayContents(blocks, "[a-z]+").length, 1);
  assert.equal(JSON.stringify(blocks), copy);
});

test("heading scope uses true root H3 only while full-text includes code examples", () => {
  const content = ["## 2026-01-01", "### 1. Genuine Key", "### Unnumbered Key ###", "   ### Indented Key", "#### Deep Key", "```md", "### 2. Fenced Key", "```",
    "~~~md", "### Tilde Key", "~~~", "> ### Quote Key", "- item", "  ### List Key", "", "    ### Code Key", "", "body Key"].join("\r\n");
  const blocks = [day("2026-01-01", content)];
  assert.deepEqual(searchDayContents(blocks, "key", { headingsOnly: true })[0].matches,
    ["### 1. Genuine Key", "### Unnumbered Key ###", "### Indented Key"]);
  assert.deepEqual(searchDayContents(blocks, "key")[0].headings, ["Genuine Key", "Unnumbered Key", "Indented Key"]);
  for (const query of ["Fenced", "Tilde", "Quote", "List", "Code", "Deep", "body"]) {
    assert.equal(searchDayContents(blocks, query, { headingsOnly: true }).length, 0, query);
    assert.equal(searchDayContents(blocks, query).length, 1, query);
  }
});

test("case sensitivity, empty queries and date lines retain original search behavior", () => {
  const blocks = [day("2026-01-01", "## 2026-01-01\n### TypeScript 中文\ntypescript lower")];
  assert.equal(searchDayContents(blocks, "typescript")[0].matches.length, 2);
  assert.deepEqual(searchDayContents(blocks, "typescript", { ignoreCase: false })[0].matches, ["typescript lower"]);
  assert.equal(searchDayContents(blocks, "TYPESCRIPT", { ignoreCase: false }).length, 0);
  assert.equal(searchDayContents(blocks, "中文", { headingsOnly: true }).length, 1);
  assert.deepEqual(searchDayContents(blocks, " \n\t"), []);
  assert.deepEqual(searchDayContents(blocks, "2026-01-01")[0].matches, ["## 2026-01-01"]);
  assert.deepEqual(searchDayContents(blocks, "2026-01-01", { headingsOnly: true }), []);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-search-test-"));
  const previous = process.env.LOG_ROOT;
  const data = path.join(root, "data"); await fs.mkdir(data);
  process.env.LOG_ROOT = data;
  t.after(async () => {
    if (previous === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-search-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, data };
}

test("service reads only explicit instance year/month sources and sees source updates", async t => {
  const { root, data } = await fixture(t);
  await fs.writeFile(path.join(root, "2024_学习日志.md"), "## 2024-01-01\n### outside token");
  await fs.writeFile(path.join(data, "2025_学习日志.md"), "## 2025-06-01\n### annual token");
  const monthly = path.join(data, "2026-01_学习日志.md");
  await fs.writeFile(monthly, "## 2026-01-02\n### monthly token");
  const results = await searchLogs("token");
  assert.deepEqual(results.map(result => result.fileName), ["2026-01_学习日志.md", "2025_学习日志.md"]);
  await fs.writeFile(monthly, "## 2026-01-02\n### replacement other text");
  assert.deepEqual((await searchLogs("token")).map(result => result.date), ["2025-06-01"]);
  assert.deepEqual(await searchLogs("outside"), []);
});

test("route guards before reading parameters, validates options, and hides actual storage errors", async t => {
  const { root, data } = await fixture(t);
  const source = await fs.readFile(new URL("../app/api/search/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} }; let authorized = false;
  runInNewContext(outputText, { Response, exports: module.exports, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/log-search") return { searchLogs };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  assert.equal((await module.exports.GET({ get nextUrl() { assert.fail("anonymous parameter access"); } })).status, 401);
  authorized = true;
  const get = query => module.exports.GET({ nextUrl: new URL(`http://localhost/api/search?${query}`) });
  await fs.writeFile(path.join(data, "2026_学习日志.md"), "## 2026-01-01\n### Title\nbody needle");
  const response = await get("q=needle");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).results.length, 1);
  assert.deepEqual(await (await get("q=needle&scope=heading")).json(), { results: [] });
  assert.deepEqual(await (await get("q=TITLE&ignoreCase=false")).json(), { results: [] });
  for (const query of ["scope=wiki", "scope=", "ignoreCase=no", "ignoreCase="]) assert.equal((await get(query)).status, 400);
  await fs.writeFile(path.join(data, "2026-01_学习日志.md"), "## 2026-01-01\n### duplicate");
  const failed = await get("q=needle");
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes(root));
});
