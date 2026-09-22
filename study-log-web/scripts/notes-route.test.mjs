import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as store from "../lib/notes-store.ts";
import * as types from "../lib/notes-types.ts";
const require = createRequire(import.meta.url);
const next = require("next/server");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-note-route-test-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups");
  await fs.mkdir(data); await fs.mkdir(backups);
  const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-note-route-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function load(relative, dependencies) {
    const source = await fs.readFile(new URL(relative, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { exports: module.exports, Buffer, Response, Error, require(name) {
      if (name === "next/server") return next;
      if (name === "node:crypto") return crypto;
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    } });
    return module.exports;
  }
  const secret = crypto.randomBytes(48).toString("hex");
  const auth = await load("../lib/auth.ts", { "@/lib/config": { getSessionSecret: () => secret, getAppPassword: () => assert.fail("password must not be read"), getCookieSecure: () => false } });
  const route = await load("../app/api/notes/route.ts", { "@/lib/auth": auth, "@/lib/notes-store": store, "@/lib/notes-types": types });
  const cookie = `study_log_session=${auth.createSessionToken()}`;
  function request(method, body, bearer = false) {
    return new next.NextRequest("http://localhost/study-log/api/notes", {
      method, headers: bearer ? { authorization: `Bearer ${auth.createAppToken().token}` } : { cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  return { root, data, backups, route, request };
}

test("actual notes methods authenticate before parsing bodies or touching data", async t => {
  const { data, route } = await fixture(t);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const response = await route[method]({ cookies: new Map(), headers: new Headers(), json() { assert.fail("unauthenticated request body read"); } });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
  assert.deepEqual(await fs.readdir(data), []);
});

test("real cookie/Bearer CRUD preserves the contract and reports missing/stale versions and invalid dates", async t => {
  const { route, request } = await fixture(t);
  const listing = await route.GET(request("GET")); assert.deepEqual(await listing.json(), { notes: [], years: [], tags: [] });
  assert.equal(listing.headers.get("cache-control"), "no-store");
  const created = await route.POST(request("POST", { body: "合成 API 正文", tags: ["API"], recordedAt: "2026-01-15T09:00" }, true));
  assert.equal(created.status, 200); const { note } = await created.json(); assert.ok(note.version);
  const patch = { ...note, body: "API 更新", baseVersion: note.version };
  for (const version of [undefined, null, ""]) {
    assert.equal((await route.PATCH(request("PATCH", { ...patch, baseVersion: version }))).status, 400);
    assert.equal((await route.DELETE(request("DELETE", { id: note.id, baseVersion: version }))).status, 400);
  }
  assert.equal((await route.POST(request("POST", { body: "future", recordedAt: "9999-01-01T00:00" }))).status, 400);
  assert.equal((await route.POST(request("POST", { body: "invalid", recordedAt: "2026-02-30T00:00" }))).status, 400);
  const updated = await route.PATCH(request("PATCH", patch)); assert.equal(updated.status, 200); const saved = (await updated.json()).note;
  const stale = await route.PATCH(request("PATCH", patch)); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "NOTE_CONFLICT");
  assert.equal((await route.DELETE(request("DELETE", { id: note.id, baseVersion: note.version }))).status, 409);
  const removed = await route.DELETE(request("DELETE", { id: note.id, baseVersion: saved.version }, true));
  assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), { ok: true });
  assert.equal((await route.DELETE(request("DELETE", { id: note.id, baseVersion: saved.version }))).status, 404);
  assert.deepEqual((await (await route.GET(request("GET"))).json()).notes, []);
});

test("malformed JSON, source failure and pending recovery produce stable sanitized errors", async t => {
  const { root, data, route, request } = await fixture(t);
  const malformed = request("POST"); malformed.json = async () => { throw new SyntaxError("synthetic invalid JSON"); };
  assert.equal((await route.POST(malformed)).status, 400);
  for (const value of [null, [], 12]) assert.equal((await route.POST(request("POST", value))).status, 400);
  process.env.LOG_ROOT = path.join(root, "missing-directory");
  const failed = await route.GET(request("GET")); assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes(root)); assert.equal(failed.headers.get("cache-control"), "no-store");
  process.env.LOG_ROOT = data;
  await fs.mkdir(path.join(data, "随记"));
  await fs.writeFile(path.join(data, "随记", ".pending-write.json"), "{}");
  const recovery = await route.GET(request("GET")); assert.equal(recovery.status, 503);
  assert.equal((await recovery.json()).code, "NOTES_RECOVERY_REQUIRED");
  assert.equal((await route.POST(request("POST", { body: "blocked", recordedAt: "2026-01-15T09:00" }))).status, 503);
});
