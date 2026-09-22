import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { searchInternalLinkCandidates } from "../lib/internal-link-search.ts";
import { buildInternalLinkMarkup, normalizeInternalLinkAlias, findInternalLinkHeading } from "../lib/internal-links.ts";
import { buildMarkdownOutline } from "../lib/markdown-outline.ts";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");

test("navigation prefers exact id or full title before unnumbered text, keeping the first duplicate", () => {
  const headings = buildMarkdownOutline("### 1. **并发控制**\n\n### 并发控制\n\n### 2. 并发控制\n\n### 3. 其他标题");
  assert.equal(findInternalLinkHeading(headings, headings[2].id), headings[2]);
  assert.equal(findInternalLinkHeading(headings, "2. 并发控制"), headings[2]);
  assert.equal(findInternalLinkHeading(headings, "并发控制"), headings[1]);
  assert.equal(findInternalLinkHeading([headings[0], headings[2]], "并发控制"), headings[0]);
  assert.equal(findInternalLinkHeading(headings, "99. 其他标题"), headings[3]);
  assert.equal(findInternalLinkHeading(headings, ""), undefined);
  assert.equal(findInternalLinkHeading(headings, "不存在"), undefined);
});

test("ordinary internal links preserve date, section and selected aliases", () => {
  const day = { kind: "day", date: "2026-01-15", heading: null, preview: "" };
  const section = { ...day, kind: "heading", heading: "并发控制" };
  assert.equal(buildInternalLinkMarkup(day), "[[2026-01-15]]");
  assert.equal(buildInternalLinkMarkup(section), "[[2026-01-15#并发控制]]");
  assert.equal(buildInternalLinkMarkup(section, "  所选\n 内容  "), "[[2026-01-15#并发控制|所选 内容]]");
  assert.equal(buildInternalLinkMarkup(section, "并发控制"), "[[2026-01-15#并发控制]]");
  assert.equal(normalizeInternalLinkAlias(" \t换行\n别名 "), "换行 别名");
  assert.throws(() => buildInternalLinkMarkup(day, "别名|注入"), /显示文字/);
  assert.throws(() => buildInternalLinkMarkup(day, "别名]]注入"), /显示文字/);
  for (const heading of ["标题|注入", "标题]]注入", "标题#注入", "标题\n注入"]) {
    assert.throws(() => buildInternalLinkMarkup({ ...section, heading }), /目标标题/);
  }
  assert.throws(() => buildInternalLinkMarkup({ ...day, date: "2026-02-30" }), /日期无效/);
});

test("link search reads only explicit synthetic source files, ranks targets and never mutates sources", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-links-test-"));
  const oldRoot = process.env.LOG_ROOT;
  process.env.LOG_ROOT = root;
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = oldRoot;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-links-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.deepEqual(await searchInternalLinkCandidates(""), []);
  const sources = {
    "2025_学习日志.md": "## 2025-12-31\n\n### 1. 年度样本\n\n只用于合成测试。\n",
    "2026-01_学习日志.md": [
      "## 2026-01-15", "", "### 1. **并发控制**", "", "事务回滚和 AtomicUpdate。", "",
      "```md", "## 2026-01-16", "### 2. 围栏伪标题", "```", "",
      "> ### 3. 引用伪标题", "", "- 列表", "  ### 4. 列表伪标题", "",
      "### 无编号小节", "", "无编号正文样本。", "",
      "### 5. 不支持|目标", "", "这段不应该进入上一小节预览。", "",
      "---", "", "## 2026-01-17", "", "### 1. 并发控制实践", "", "另一天的例子。", ""
    ].join("\n")
  };
  for (const [name, content] of Object.entries(sources)) await fs.writeFile(path.join(root, name), content);
  await fs.writeFile(path.join(root, "ignored.md"), "## 2026-01-18\n\n### 1. 非源文件");
  await fs.mkdir(path.join(root, "随记"));
  await fs.writeFile(path.join(root, "随记", "2026-01_学习日志.md"), "## 2026-01-19\n\n### 1. 随记不属于日块目标");

  const all = await searchInternalLinkCandidates("");
  assert.deepEqual(all.filter(row => row.kind === "day").map(row => row.date), ["2026-01-17", "2026-01-15", "2025-12-31"]);
  assert.deepEqual(all.filter(row => row.kind === "heading").map(row => row.heading), ["并发控制实践", "并发控制", "无编号小节", "年度样本"]);
  assert.equal((await searchInternalLinkCandidates("2026-01-15"))[0].kind, "day");
  assert.equal((await searchInternalLinkCandidates("并发控制"))[0].heading, "并发控制");
  const body = await searchInternalLinkCandidates("atomicupdate");
  assert.equal(body[0].heading, "并发控制");
  assert.ok(body.some(row => row.kind === "day"));
  assert.equal((await searchInternalLinkCandidates("无编号正文"))[0].heading, "无编号小节");
  assert.deepEqual(await searchInternalLinkCandidates("肯定不存在的样本词"), []);
  assert.equal((await searchInternalLinkCandidates("", 1)).length, 1);
  assert.equal((await searchInternalLinkCandidates("", Number.NaN)).length, all.length);
  assert.ok(all.every(row => row.preview.length <= 180));
  assert.ok(!all.find(row => row.heading === "无编号小节").preview.includes("上一小节预览"));
  for (const [name, content] of Object.entries(sources)) assert.equal(await fs.readFile(path.join(root, name), "utf8"), content);

  await fs.writeFile(path.join(root, "2026_学习日志.md"), "## 2026-01-15\n\n重复日期");
  await assert.rejects(searchInternalLinkCandidates(""), /重复日期/);
});

test("real GET route authenticates cookie and Bearer, rejects long queries, and sanitizes source failures", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-link-route-test-"));
  const previous = process.env.LOG_ROOT;
  process.env.LOG_ROOT = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-link-route-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, "2026-01_学习日志.md"), "## 2026-01-15\n\n### 1. 合成目标\n\n测试正文");
  const secret = crypto.randomBytes(48).toString("hex");
  const warnings = [];
  async function load(relative, dependencies) {
    const source = await fs.readFile(new URL(relative, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { exports: module.exports, Buffer, Error, performance, console: { warn: value => warnings.push(value) }, require(name) {
      if (name === "next/server") return { NextRequest, NextResponse };
      if (name === "node:crypto") return crypto;
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    } });
    return module.exports;
  }
  const auth = await load("../lib/auth.ts", { "@/lib/config": {
    getSessionSecret: () => secret,
    getAppPassword: () => assert.fail("search must not read owner password"),
    getCookieSecure: () => false
  } });
  const readResponse = await load("../lib/log-read-response.ts", {});
  let calls = 0;
  const route = await load("../app/api/links/route.ts", {
    "@/lib/auth": auth,
    "@/lib/log-read-response": readResponse,
    "@/lib/internal-link-search": { searchInternalLinkCandidates: query => { calls++; return searchInternalLinkCandidates(query); } }
  });
  const request = (query = "", headers = {}) => new NextRequest(`http://localhost/study-log/api/links?query=${encodeURIComponent(query)}`, { headers });
  for (const headers of [{}, { authorization: "Bearer invalid" }, { cookie: "study_log_session=invalid" }]) {
    const response = await route.GET(request("合成", headers));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
  assert.equal(calls, 0);
  const cookie = { cookie: `study_log_session=${auth.createSessionToken()}` };
  const bearer = { authorization: `Bearer ${auth.createAppToken().token}` };
  for (const headers of [cookie, bearer]) {
    const response = await route.GET(request("合成目标", headers));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).results[0].heading, "合成目标");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("server-timing"), /^log_read;dur=\d+/);
  }
  // A web cookie token is not an app token and vice versa.
  assert.equal((await route.GET(request("", { authorization: `Bearer ${auth.createSessionToken()}` }))).status, 401);
  assert.equal((await route.GET(request("", { cookie: `study_log_session=${auth.createAppToken().token}` }))).status, 401);
  const beforeInvalid = calls;
  const invalid = await route.GET(request("字".repeat(501), cookie));
  assert.equal(invalid.status, 400);
  assert.equal(calls, beforeInvalid);
  assert.match((await invalid.json()).error, /500/);
  process.env.LOG_ROOT = path.join(root, "missing-synthetic-directory");
  const failed = await route.GET(request("", cookie));
  assert.equal(failed.status, 500);
  const body = await failed.text();
  assert.ok(!body.includes(root)); assert.ok(!body.includes("ENOENT"));
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.ok(warnings.length > 0);
});
