import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as store from "../lib/rag-sessions-store.ts";
import * as sessionHttp from "../lib/rag-session-http.ts";
import * as titleService from "../lib/rag-session-title.ts";
import * as chat from "../lib/ai-chat.ts";
import * as config from "../lib/ai-config.ts";
const require = createRequire(import.meta.url), next = require("next/server"), uuid = () => crypto.randomUUID();

test("actual session routes preserve versioned history and title priority with only a local mock model", async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-rag-route-"));
  const keys = ["LOG_ROOT", "BACKUP_ROOT", "CHAT_API_KEY", "CHAT_API_URL", "CHAT_MODEL", "CHAT_LIGHT_MODEL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let calls = 0, mode = "ok", started, release;
  const server = http.createServer(async (request, response) => {
    calls++; let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); assert.equal(body.model, "synthetic-title-light"); assert.equal(body.messages[0].role, "system"); assert.ok(body.messages[1].content.length <= 8000);
    response.setHeader("Content-Type", "application/json");
    if (mode === "delayed") { started(); await new Promise(resolve => { release = resolve; }); }
    if (mode === "stall") { response.write("{"); started(); return; }
    if (mode === "429" || mode === "500") { response.statusCode = Number(mode); response.end("sensitive-provider-body-DO-NOT-RETURN"); return; }
    response.end(JSON.stringify({ choices: [{ message: { content: mode === "invalid" ? "私密模型响应".repeat(30) : "```text\n“合成问答标题。”\n```" } }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, { LOG_ROOT: path.join(fixture, "data"), BACKUP_ROOT: path.join(fixture, "backups"), CHAT_API_KEY: "synthetic-title-key", CHAT_API_URL: `http://127.0.0.1:${server.address().port}/chat`, CHAT_MODEL: "synthetic-main", CHAT_LIGHT_MODEL: "synthetic-title-light" });
  await fs.mkdir(process.env.LOG_ROOT); await fs.mkdir(process.env.BACKUP_ROOT);
  t.after(async () => { release?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; assert.equal(path.dirname(fixture), path.resolve(os.tmpdir())); assert.ok(path.basename(fixture).startsWith("workbench-rag-route-")); await fs.rm(fixture, { recursive: true, force: true }); });
  async function load(relative, dependencies) {
    const source = await fs.readFile(new URL(relative, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { exports: module.exports, Buffer, Response, TextDecoder, Uint8Array, Error, require(name) { if (name === "next/server") return next; if (name === "node:crypto") return crypto; if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected dependency ${name}`); } });
    return module.exports;
  }
  const secret = crypto.randomBytes(48).toString("hex");
  const auth = await load("../lib/auth.ts", { "@/lib/config": { getSessionSecret: () => secret, getAppPassword: () => assert.fail("Password read"), getCookieSecure: () => false } });
  const dependencies = { "@/lib/auth": auth, "@/lib/rag-sessions-store": store, "@/lib/rag-session-http": sessionHttp, "@/lib/rag-session-title": titleService, "@/lib/ai-chat": chat, "@/lib/ai-config": config };
  const collection = await load("../app/api/rag/sessions/route.ts", dependencies), item = await load("../app/api/rag/sessions/[id]/route.ts", dependencies), title = await load("../app/api/rag/sessions/[id]/title/route.ts", dependencies);
  const context = id => ({ params: Promise.resolve({ id }) });
  const request = (method, input, options = {}) => new next.NextRequest(`http://localhost/study-log/api/rag/sessions${options.query || ""}`, { method, ...(input === undefined ? {} : { body: typeof input === "string" || Buffer.isBuffer(input) ? input : JSON.stringify(input) }), signal: options.signal, headers: { cookie: `study_log_session=${auth.createSessionToken()}`, ...options.headers } });
  const messages = () => [{ id: uuid(), role: "user", content: "合成问答如何保证幂等？", status: "complete" }, { id: uuid(), role: "assistant", content: "使用稳定标识与版本核验。", status: "complete" }];
  const creation = () => ({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: "logs_only", messages: messages() });
  const create = async () => { const input = creation(); const response = await collection.POST(request("POST", input)); assert.equal(response.status, 200); return { input, session: (await response.json()).session }; };
  const check = async (response, expected, code) => { assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "no-store"); const json = await response.json(); if (code) assert.equal(json.code, code); return json; };

  await t.test("all methods authorize before reading parameters/body or invoking the model", async () => {
    const unauthorized = { cookies: new Map(), headers: new Headers(), get body() { assert.fail("Read unauthenticated body"); }, get nextUrl() { assert.fail("Read unauthenticated URL"); } };
    const forbidden = { get params() { assert.fail("Read unauthenticated parameters"); } };
    for (const [route, method] of [[collection, "GET"], [collection, "POST"], [item, "GET"], [item, "PUT"], [item, "PATCH"], [item, "DELETE"], [title, "POST"]]) await check(await route[method](unauthorized, forbidden), 401);
    assert.equal(calls, 0); assert.deepEqual(await fs.readdir(process.env.LOG_ROOT), []);
  });

  await t.test("create/read/search expose exact public payloads and support cookie/Bearer auth", async () => {
    const { input, session } = await create();
    assert.deepEqual(Object.keys(session).sort(), ["answerMode", "createdAt", "id", "lastQuestion", "messageCount", "messages", "title", "titleSource", "updatedAt", "version"].sort());
    assert.equal(session.id, input.id); assert.equal(session.titleSource, "fallback"); assert.equal(session.messages[1].status, "complete"); assert.match(session.version, /^[a-f0-9]{64}$/);
    const again = await check(await collection.POST(request("POST", input)), 200); assert.deepEqual(again.session, session);
    const found = await check(await item.GET(request("GET", undefined, { headers: { cookie: "", authorization: `Bearer ${auth.createAppToken().token}` } }), context(session.id)), 200); assert.deepEqual(found.session, session);
    const result = await check(await collection.GET(request("GET", undefined, { query: "?q=幂等" })), 200); assert.ok(result.sessions.some(value => value.id === session.id)); assert.equal("messages" in result.sessions[0], false); assert.ok(result.sessions[0].version); assert.ok(result.sessions[0].titleSource);
    await check(await item.GET(request("GET"), context(uuid())), 404, "RAG_SESSION_NOT_FOUND");
    await check(await item.GET(request("GET"), context("../private")), 400, "RAG_SESSION_INVALID_INPUT");
  });

  await t.test("full update/manual rename/delete enforce versions and retry the same mutation without duplication", async () => {
    const { input, session } = await create(), update = { mutationId: uuid(), baseVersion: session.version, answerMode: "logs_and_general", messages: messages() };
    const saved = (await check(await item.PUT(request("PUT", update), context(session.id)), 200)).session;
    assert.equal(saved.answerMode, "logs_and_general"); assert.deepEqual((await check(await item.PUT(request("PUT", update), context(session.id)), 200)).session, saved);
    await check(await item.PUT(request("PUT", { ...update, messages: messages() }), context(session.id)), 409, "RAG_SESSION_CONFLICT");
    const rename = { mutationId: uuid(), baseVersion: saved.version, title: "合成手工标题" };
    const renamed = (await check(await item.PATCH(request("PATCH", rename), context(session.id)), 200)).session;
    assert.equal(renamed.titleSource, "manual"); assert.deepEqual((await check(await item.PATCH(request("PATCH", rename), context(session.id)), 200)).session, renamed);
    await check(await item.DELETE(request("DELETE", { mutationId: uuid(), baseVersion: saved.version }), context(session.id)), 409, "RAG_SESSION_CONFLICT");
    const deletion = { mutationId: uuid(), baseVersion: renamed.version };
    assert.deepEqual(await check(await item.DELETE(request("DELETE", deletion), context(session.id)), 200), { ok: true }); assert.deepEqual(await check(await item.DELETE(request("DELETE", deletion), context(session.id)), 200), { ok: true });
    await check(await collection.POST(request("POST", input)), 409, "RAG_SESSION_CONFLICT");
  });

  await t.test("JSON, UTF-8, shape, unknown fields, message state and request size are validated before writes", async () => {
    const before = await fs.readFile(store.getRagSessionsFilePath(), "utf8");
    for (const input of ["{", null, [], {}, Buffer.from([0xff]), { ...creation(), privateRoot: "not-allowed" }, { ...creation(), messages: [{ id: uuid(), role: "assistant", content: "invalid", status: "streaming" }] }]) await check(await collection.POST(request("POST", input)), 400, "RAG_SESSION_INVALID_INPUT");
    await check(await collection.POST(request("POST", " ".repeat(4 * 1024 * 1024 + 1))), 413, "RAG_SESSION_BODY_TOO_LARGE");
    const id = uuid(); for (const method of ["PUT", "PATCH", "DELETE"]) await check(await item[method](request(method, {}), context(id)), 400, "RAG_SESSION_INVALID_INPUT");
    for (const input of [{}, { baseVersion: "invalid" }, { baseVersion: "a".repeat(64), title: "client choice" }]) await check(await title.POST(request("POST", input), context(id)), 400, "RAG_SESSION_INVALID_INPUT");
    assert.equal(await fs.readFile(store.getRagSessionsFilePath(), "utf8"), before);
  });

  await t.test("generated/manual title precheck skips the model even for a stale request version", async () => {
    const { session } = await create(); const count = calls;
    const response = await check(await title.POST(request("POST", { baseVersion: session.version }), context(session.id)), 200);
    assert.equal(response.session.title, "合成问答标题"); assert.equal(response.session.titleSource, "generated"); assert.equal(calls, count + 1); assert.deepEqual(response.session.messages, session.messages);
    assert.deepEqual((await check(await title.POST(request("POST", { baseVersion: session.version }), context(session.id)), 200)).session, response.session); assert.equal(calls, count + 1);
    const manual = (await create()).session; const renamed = await store.renameRagSession(manual.id, { mutationId: uuid(), baseVersion: manual.version, title: "手工优先" });
    assert.deepEqual((await check(await title.POST(request("POST", { baseVersion: manual.version }), context(manual.id)), 200)).session, renamed); assert.equal(calls, count + 1);
    const fresh = (await create()).session; await check(await title.POST(request("POST", { baseVersion: "a".repeat(64) }), context(fresh.id)), 409, "RAG_SESSION_CONFLICT"); assert.equal(calls, count + 1);
  });

  await t.test("title completion rechecks manual priority and a newer dialogue version", async () => {
    for (const action of ["rename", "update"]) {
      const { session } = await create(); mode = "delayed"; const underway = new Promise(resolve => { started = resolve; });
      const pending = title.POST(request("POST", { baseVersion: session.version }), context(session.id)); await underway;
      const changed = action === "rename" ? await store.renameRagSession(session.id, { mutationId: uuid(), baseVersion: session.version, title: "生成期间手改" }) : await store.updateRagSession(session.id, { mutationId: uuid(), baseVersion: session.version, answerMode: "logs_only", messages: messages() });
      release(); const response = await pending;
      if (action === "rename") assert.deepEqual((await check(response, 200)).session, changed); else await check(response, 409, "RAG_SESSION_CONFLICT");
      assert.deepEqual(await store.getRagSession(session.id), changed);
    }
    mode = "ok";
  });

  await t.test("title model failures/cancellation are sanitized and never change persisted conversation", async () => {
    const { session } = await create(), before = await fs.readFile(store.getRagSessionsFilePath(), "utf8");
    for (const [behavior, status, code] of [["429", 429, "AI_RATE_LIMITED"], ["500", 502, "AI_PROVIDER_FAILED"], ["invalid", 502, "AI_INVALID_TITLE"]]) {
      mode = behavior; const response = await check(await title.POST(request("POST", { baseVersion: session.version }), context(session.id)), status, code); assert.doesNotMatch(JSON.stringify(response), /sensitive-provider|synthetic-title-key|私密模型|127\.0\.0\.1/);
    }
    delete process.env.CHAT_API_KEY; await check(await title.POST(request("POST", { baseVersion: session.version }), context(session.id)), 503, "AI_CONFIGURATION_INVALID"); process.env.CHAT_API_KEY = "synthetic-title-key";
    const cancelled = new AbortController(); cancelled.abort(); const count = calls; await check(await title.POST(request("POST", { baseVersion: session.version }, { signal: cancelled.signal }), context(session.id)), 499, "RAG_SESSION_CANCELLED"); assert.equal(calls, count);
    mode = "stall"; const underway = new Promise(resolve => { started = resolve; }), controller = new AbortController(); const pending = title.POST(request("POST", { baseVersion: session.version }, { signal: controller.signal }), context(session.id)); await underway; controller.abort(); await check(await pending, 499, "AI_CANCELLED");
    assert.equal(await fs.readFile(store.getRagSessionsFilePath(), "utf8"), before); mode = "ok";
  });

  await t.test("corrupted storage returns sanitized 500 for list/read/write without resetting the file", async () => {
    const { session } = await create(), target = store.getRagSessionsFilePath(), broken = '{"sensitive-private-marker":'; await fs.writeFile(target, broken);
    for (const response of [await collection.GET(request("GET")), await item.GET(request("GET"), context(session.id)), await collection.POST(request("POST", creation()))]) {
      const result = await check(response, 500, "RAG_SESSION_STORAGE_ERROR"); assert.doesNotMatch(JSON.stringify(result), /sensitive-private|workbench-rag-route|state\//);
    }
    assert.equal(await fs.readFile(target, "utf8"), broken);
  });
});
