import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import AdmZip from "adm-zip";
import * as store from "../lib/export-store.ts";
import { NoteRecoveryError } from "../lib/notes-types.ts";
const require = createRequire(import.meta.url);
const next = require("next/server");

test("actual export route authenticates first, returns verified ZIP bytes/Chinese disposition/warnings, and sanitizes failures", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-export-route-test-"));
  const previous = process.env.LOG_ROOT; process.env.LOG_ROOT = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-export-route-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function load(relative, dependencies) {
    const source = await fs.readFile(new URL(relative, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { exports: module.exports, Buffer, Response, Uint8Array, Error, require(name) {
      if (name === "next/server") return next;
      if (name === "node:crypto") return crypto;
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    } });
    return module.exports;
  }
  const secret = crypto.randomBytes(48).toString("hex");
  const auth = await load("../lib/auth.ts", { "@/lib/config": { getSessionSecret: () => secret, getAppPassword: () => assert.fail("password read"), getCookieSecure: () => false } });
  const route = await load("../app/api/export/route.ts", { "@/lib/auth": auth, "@/lib/export-store": store, "@/lib/notes-types": { NoteRecoveryError } });
  assert.equal((await route.GET({ cookies: new Map(), headers: new Headers(), get nextUrl() { assert.fail("unauthenticated query read"); } })).status, 401);
  const request = (query, bearer = false) => new next.NextRequest(`http://localhost/study-log/api/export?${query}`, { headers: bearer
    ? { authorization: `Bearer ${auth.createAppToken().token}` } : { cookie: `study_log_session=${auth.createSessionToken()}` } });
  const markdown = "## 2026-01-15\n\n### 1. 中文标题\n\n![缺失](./assets/missing.png)\n";
  await fs.writeFile(path.join(root, "2026-01_学习日志.md"), markdown);
  for (const bearer of [false, true]) {
    const response = await route.GET(request("scope=file&date=2026-01-15", bearer));
    assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-export-warning-count"), "1");
    const disposition = response.headers.get("content-disposition");
    assert.match(disposition, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), "2026-01_学习日志.zip");
    const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(zip.getEntries().map(entry => entry.entryName).sort(), ["2026-01_学习日志/2026-01_学习日志.md", "2026-01_学习日志/导出说明.txt"].sort());
    assert.equal(zip.readAsText("2026-01_学习日志/2026-01_学习日志.md"), markdown);
    assert.match(zip.readAsText("2026-01_学习日志/导出说明.txt"), /missing.png/);
  }
  assert.equal((await route.GET(request("scope=backup"))).status, 400);
  assert.equal((await route.GET(request("scope=day&date=2026-02-30"))).status, 400);
  assert.equal((await route.GET(request("scope=day&date=2026-01-16"))).status, 404);
  await fs.mkdir(path.join(root, "随记")); await fs.writeFile(path.join(root, "随记/.pending-write.json"), "{}");
  assert.equal((await route.GET(request("scope=notes"))).status, 503);
  process.env.LOG_ROOT = path.join(root, "missing-root");
  const failed = await route.GET(request("scope=all")); assert.equal(failed.status, 500);
  const body = await failed.text(); assert.ok(!body.includes(root)); assert.ok(!body.includes("ENOENT"));
});
