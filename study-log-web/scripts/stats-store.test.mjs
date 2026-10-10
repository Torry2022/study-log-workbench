import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as stats from "../lib/stats-store.ts";
import * as taxonomy from "../lib/taxonomy-store.ts";
import * as logs from "../lib/log-store.ts";
import { normalizeHeading, headingTextOf } from "../lib/stats-tags.ts";

const previous = "## 2025-12-31\n### 1. Alpha(old)\nbody\n### 2. Gamma\nbody";
const current = "## 2026-01-01\n### 1. Alpha(detail)\nbody\n```md\n## 1999-02-03\n### Pretend\n```\n> ### Quote\n- item\n  ### List\n\n### 2. Alpha(other)\nbody\n### 3. 组会\nbody\n### 4. 3D\n\n## 2026-01-02\nOnly prose\n\n## 2026-01-03\n### 1. Beta\nbody";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-stats-test-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups");
  await fs.mkdir(data); await fs.mkdir(backups);
  const oldRoot = process.env.LOG_ROOT, oldBackups = process.env.BACKUP_ROOT;
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = oldRoot;
    if (oldBackups === undefined) delete process.env.BACKUP_ROOT; else process.env.BACKUP_ROOT = oldBackups;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-stats-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(data, "2025_学习日志.md"), previous);
  await fs.writeFile(path.join(data, "2026-01_学习日志.md"), current);
  return { root, data, backups, file: path.join(data, ".study-log-taxonomy.json") };
}
const save = (baseVersion, domains = ["Custom"], mappings = { Alpha: "Custom" }) => taxonomy.writeTaxonomy({ domains, mappings, baseVersion });

test("statistics count authoritative AST days and topics exactly, including previously excluded activities", async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, "2026_学习日志.md"), "## 2026-01-04\n### outside source");
  await save(null);
  const result = await stats.getMonthlyStats("2026-01");
  assert.equal(result.classificationReady, true);
  assert.equal(result.dayCount, 3); assert.equal(result.technicalDayCount, 2); assert.equal(result.topicCount, 5); assert.equal(result.total, 5);
  assert.equal(result.previousMonth, "2025-12");
  assert.deepEqual(result.comparison, { dayCount: 1, technicalDayCount: 1, topicCount: 2, activeDomains: 1 });
  const alpha = result.tags.find(item => item.tag === "Alpha(detail)");
  assert.equal(alpha.count, 1); assert.equal(alpha.percentage, 20); assert.equal(alpha.activeDays, 1); assert.equal(alpha.previousCount, 0); assert.equal(alpha.delta, 1);
  assert.equal(result.tags.find(item => item.tag === "Alpha(other)").domain, "Custom");
  assert.deepEqual(alpha.dates, ["2026-01-01"]);
  assert.deepEqual(result.days.map(day => day.topicCount), [4, 0, 1]);
  assert.deepEqual(result.entries.map(entry => entry.headingIndex), [0, 1, 2, 3, 0]);
  assert.ok(result.tags.some(item => item.tag === "组会")); assert.ok(result.tags.some(item => item.tag === "3D"));
  assert.ok(!result.tags.some(item => /Pretend|Quote|List|outside/.test(item.tag)));
  const custom = result.domainCounts.find(item => item.domain === "Custom");
  assert.equal(custom.count, 2); assert.equal(custom.percentagePointDelta, -10);
  assert.equal(result.unclassifiedTags.length, 3);
});

test("empty months, legitimate calendar bounds and AST pseudo-headings have explicit semantics", async t => {
  await fixture(t);
  const empty = await stats.getMonthlyStats("2026-03");
  assert.equal(empty.classificationReady, false);
  assert.equal(empty.dayCount, 0); assert.equal(empty.topicCount, 0); assert.equal(empty.comparison, null); assert.deepEqual(empty.tags, []);
  for (const month of ["2026-00", "2026-13", "26-01", "2026-1", "2026-01/path"]) await assert.rejects(stats.getMonthlyStats(month), taxonomy.TaxonomyInputError);
  const parsed = stats.parseStatsDays([{ date: "2026-01-01", content: "## 2026-01-01\n~~~md\n### fake\n~~~\n\n    ### indented code\n\n   ### actual\n#### child" }]);
  assert.deepEqual(parsed[0].headings.map(item => item.tag), ["actual"]);
  assert.equal(await stats.getDefaultStatsMonth(), "2026-01");
});

test("topic normalization preserves numerical technical names and explicit grouping behavior", () => {
  for (const name of ["3D", "2026计划", "3.14 release", "C++", "HTTP/2"]) assert.equal(normalizeHeading(name), name);
  assert.equal(normalizeHeading("### 1. Alpha(one(nested))"), "Alpha(one(nested))");
  assert.equal(normalizeHeading("2、 Alpha（注释）"), "Alpha（注释）");
  assert.equal(headingTextOf("1.2. Alpha(detail)"), "Alpha(detail)");
});

test("catalog spans source months, reports explicit mappings, and contains no built-in inference", async t => {
  await fixture(t);
  assert.deepEqual(await taxonomy.readTaxonomy(), { domains: ["其他"], mappings: {}, updatedAt: null, version: null });
  let catalog = await stats.getTaxonomyCatalog();
  assert.ok(catalog.every(item => item.domain === "其他" && !item.explicitlyMapped));
  await save(null);
  catalog = await stats.getTaxonomyCatalog();
  const alpha = catalog.find(item => item.tag === "Alpha(detail)");
  assert.equal(alpha.count, 1); assert.equal(alpha.explicitlyMapped, true); assert.equal(alpha.domain, "Custom");
  assert.deepEqual(alpha.months, ["2026-01"]); assert.equal(alpha.sources.length, 1);
  assert.equal(catalog.filter(item => item.tag.startsWith("Alpha")).length, 3);
});

test("taxonomy version conflicts serialize creation and modification without overwriting other clients", async t => {
  const { backups, file } = await fixture(t);
  const first = await Promise.allSettled([save(null), save(null, ["Other client"], {})]);
  assert.equal(first.filter(item => item.status === "fulfilled").length, 1);
  assert.ok(first.find(item => item.status === "rejected").reason instanceof taxonomy.TaxonomyConflictError);
  assert.deepEqual(await fs.readdir(backups), []);
  const before = await taxonomy.readTaxonomy();
  const original = await fs.readFile(file, "utf8");
  const updates = await Promise.allSettled([save(before.version, ["First"], {}), save(before.version, ["Second"], {})]);
  assert.equal(updates.filter(item => item.status === "fulfilled").length, 1);
  assert.ok(updates.find(item => item.status === "rejected").reason instanceof taxonomy.TaxonomyConflictError);
  const names = await fs.readdir(backups); assert.equal(names.length, 1);
  assert.equal(await fs.readFile(path.join(backups, names[0]), "utf8"), original);
  await assert.rejects(save(null), taxonomy.TaxonomyConflictError);
});

test("full titles can override inherited legacy grouping without rewriting source or other mappings", async t => {
  const { file, data } = await fixture(t);
  const source = await fs.readFile(path.join(data, "2026-01_学习日志.md"), "utf8");
  const first = await save(null);
  const raw = await fs.readFile(file, "utf8");
  await stats.getTaxonomyCatalog(); assert.equal(await fs.readFile(file, "utf8"), raw);
  await save(first.version, ["Custom", "Another"], { Alpha: "Custom", "Alpha(detail)": "Another" });
  const catalog = await stats.getTaxonomyCatalog();
  assert.equal(catalog.find(item => item.tag === "Alpha(detail)").domain, "Another");
  assert.equal(catalog.find(item => item.tag === "Alpha(other)").domain, "Custom");
  assert.equal(catalog.find(item => item.tag === "Alpha(old)").domain, "Custom");
  assert.equal(await fs.readFile(path.join(data, "2026-01_学习日志.md"), "utf8"), source);
});

test("custom domains persist and deleting one remaps its tags to Other without restoring private defaults", async t => {
  await fixture(t);
  const created = await save(null, [" Software ", "Software", "其他", "My Domain"], { "Alpha(note)": "Software", Beta: "My Domain", constructor: "Software", "组会": "其他" });
  assert.deepEqual(created.domains, ["Software", "My Domain", "其他"]);
  assert.equal(created.mappings["Alpha(note)"], "Software");
  const deleted = await save(created.version, ["My Domain"], created.mappings);
  assert.equal(deleted.mappings["Alpha(note)"], "其他");
  assert.deepEqual((await taxonomy.readTaxonomy()).domains, ["My Domain", "其他"]);
  const result = await stats.getMonthlyStats("2026-01");
  assert.ok(!result.unclassifiedTags.some(item => item.tag === "Alpha" || item.tag === "组会"));
});

test("partial temp write and rename failures preserve source JSON and unique full backups", async t => {
  const { data, backups, file } = await fixture(t);
  const before = await save(null); const original = await fs.readFile(file);
  const open = fs.open, rename = fs.rename;
  t.after(() => { fs.open = open; fs.rename = rename; });
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    if (String(target).endsWith(".tmp")) {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => { await write("partial"); throw Object.assign(new Error("synthetic disk full"), { code: "ENOSPC" }); };
    }
    return handle;
  };
  await assert.rejects(save(before.version), { code: "ENOSPC" });
  assert.deepEqual(await fs.readFile(file), original);
  fs.open = open;
  fs.rename = async () => { throw Object.assign(new Error("synthetic rename failure"), { code: "EACCES" }); };
  await assert.rejects(save(before.version), { code: "EACCES" });
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal((await fs.readdir(data)).filter(name => name.endsWith(".tmp")).length, 0);
  const names = await fs.readdir(backups); assert.equal(names.length, 2); assert.equal(new Set(names).size, 2);
  for (const name of names) assert.deepEqual(await fs.readFile(path.join(backups, name)), original);
  fs.rename = rename;
  assert.notEqual((await save(before.version, ["Recovered"], {})).version, before.version);
});

test("malformed storage fails closed; missing base version and malformed requests create no JSON", async t => {
  const { file } = await fixture(t);
  for (const input of [null, {}, { domains: [], mappings: {} }, { domains: [], mappings: {}, baseVersion: undefined }, { domains: "bad", mappings: {}, baseVersion: null }]) {
    await assert.rejects(taxonomy.writeTaxonomy(input), taxonomy.TaxonomyInputError);
  }
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
  for (const content of ["{broken", '{"domains":[],"mappings":null,"updatedAt":null}']) {
    await fs.writeFile(file, content); await assert.rejects(taxonomy.readTaxonomy()); await assert.rejects(save(null));
    assert.equal(await fs.readFile(file, "utf8"), content);
  }
});

test("instance and backup junctions are refused without writing outside the configured directory", async t => {
  const { root, file } = await fixture(t);
  const before = await save(null); const original = await fs.readFile(file);
  const outside = path.join(root, "outside"); await fs.mkdir(outside);
  const alias = path.join(root, "alias"); await fs.symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  process.env.BACKUP_ROOT = alias;
  await assert.rejects(save(before.version)); assert.deepEqual(await fs.readFile(file), original); assert.deepEqual(await fs.readdir(outside), []);
  process.env.LOG_ROOT = alias;
  await assert.rejects(taxonomy.readTaxonomy()); assert.deepEqual(await fs.readdir(outside), []);
});

test("routes gate first, enforce API version conflicts and return sanitized storage errors", async t => {
  const { root, file } = await fixture(t); let authorized = false;
  async function route(relative) {
    const source = await fs.readFile(new URL(relative, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    const module = { exports: {} };
    runInNewContext(outputText, { Response, exports: module.exports, require(name) {
      if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
      if (name === "@/lib/stats-store") return stats;
      if (name === "@/lib/taxonomy-store") return taxonomy;
      if (name === "@/lib/log-store") return logs;
      throw new Error(`Unexpected dependency ${name}`);
    } }); return module.exports;
  }
  const statRoute = await route("../app/api/stats/route.ts"), taxonomyRoute = await route("../app/api/taxonomy/route.ts");
  const denied = { get nextUrl() { assert.fail("anonymous URL access"); }, json() { assert.fail("anonymous body access"); } };
  for (const action of [statRoute.GET, taxonomyRoute.GET, taxonomyRoute.PUT]) assert.equal((await action(denied)).status, 401);
  authorized = true;
  assert.equal((await statRoute.GET({ nextUrl: new URL("http://localhost?month=2026-13") })).status, 400);
  const listing = await taxonomyRoute.GET({}); assert.equal(listing.headers.get("cache-control"), "no-store");
  assert.equal((await listing.json()).taxonomy.version, null);
  const request = { json: async () => ({ domains: ["Custom"], mappings: { Alpha: "Custom" }, baseVersion: null }) };
  assert.equal((await taxonomyRoute.PUT(request)).status, 200);
  const conflict = await taxonomyRoute.PUT(request); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "TAXONOMY_CONFLICT");
  await fs.writeFile(file, `{broken ${root}`);
  for (const response of [await taxonomyRoute.GET({}), await statRoute.GET({ nextUrl: new URL("http://localhost?month=2026-01") })]) {
    assert.equal(response.status, 500); assert.ok(!(await response.text()).includes(root));
  }
});
