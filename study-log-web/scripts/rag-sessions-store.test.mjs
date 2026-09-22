import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRagSession, updateRagSession, renameRagSession, deleteRagSession, listRagSessions, getRagSession, getRagSessionsFilePath, applyGeneratedRagSessionTitle,
  RagSessionInputError, RagSessionConflictError, RagSessionNotFoundError, RagSessionStorageError, fallbackRagSessionTitle } from "../lib/rag-sessions-store.ts";

let fixture, originalRoot, originalBackup;
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-rag-history-"));
  originalRoot = process.env.LOG_ROOT; originalBackup = process.env.BACKUP_ROOT;
  process.env.LOG_ROOT = path.join(fixture, "data"); process.env.BACKUP_ROOT = path.join(fixture, "backups");
  await fs.mkdir(process.env.LOG_ROOT); await fs.mkdir(process.env.BACKUP_ROOT);
});
afterEach(async () => {
  if (originalRoot === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = originalRoot;
  if (originalBackup === undefined) delete process.env.BACKUP_ROOT; else process.env.BACKUP_ROOT = originalBackup;
  assert.ok(path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith("study-log-rag-history-"));
  await fs.rm(fixture, { recursive: true, force: true });
});
const uuid = () => crypto.randomUUID();
const content = (question = "如何保存问答历史？", answer = "使用独立实例的版本化存储。") => [{ id: uuid(), role: "user", content: question, status: "complete" }, { id: uuid(), role: "assistant", content: answer, status: "complete" }];
const input = (messages = content()) => ({ id: uuid(), mutationId: uuid(), baseVersion: null, answerMode: "logs_only", messages });
const create = () => createRagSession(input());
const raw = () => fs.readFile(getRagSessionsFilePath(), "utf8");
const failure = (operation, error) => assert.rejects(Promise.resolve().then(operation), error);
const backupFiles = () => fs.readdir(path.join(process.env.BACKUP_ROOT, "rag-sessions")).catch(error => { if (error.code === "ENOENT") return []; throw error; });

test("new instance stays empty; stable creation exposes complete summary and fallback title", async () => {
  assert.deepEqual(await listRagSessions(), []);
  await assert.rejects(fs.stat(path.join(process.env.LOG_ROOT, "state")), { code: "ENOENT" });
  const request = input(), result = await createRagSession(request);
  assert.equal(result.id, request.id); assert.equal(result.titleSource, "fallback"); assert.equal(result.title, "如何保存问答历史"); assert.match(result.version, /^[a-f0-9]{64}$/);
  assert.equal(result.messageCount, 2); assert.equal(result.lastQuestion, request.messages[0].content);
  assert.deepEqual(await getRagSession(result.id), result);
  assert.equal((await listRagSessions("保存"))[0].id, result.id); assert.deepEqual(await listRagSessions("仅在不存在的问题中"), []);
  assert.equal(getRagSessionsFilePath(), path.join(process.env.LOG_ROOT, "state", "rag-sessions.json"));
});

test("lost creation response can retry unchanged without another write or backup", async () => {
  const request = input(), first = await createRagSession(request), before = await raw();
  assert.deepEqual(await createRagSession(structuredClone(request)), first); assert.equal(await raw(), before); assert.equal((await backupFiles()).length, 0);
  await failure(() => createRagSession({ ...request, messages: content("不同问题") }), RagSessionConflictError);
  await failure(() => createRagSession({ ...request, mutationId: uuid() }), RagSessionConflictError);
  assert.equal((await listRagSessions()).length, 1);
});

test("snapshot update retries safely; a subsequent mutation makes an old retry conflict", async () => {
  const first = await create(), request = { mutationId: uuid(), baseVersion: first.version, answerMode: "logs_and_general", messages: content("新问题") };
  const updated = await updateRagSession(first.id, request), before = await raw(), backupCount = (await backupFiles()).length;
  assert.notEqual(updated.version, first.version); assert.deepEqual(await updateRagSession(first.id, request), updated); assert.equal(await raw(), before); assert.equal((await backupFiles()).length, backupCount);
  await failure(() => updateRagSession(first.id, { ...request, messages: content("相同操作不同内容") }), RagSessionConflictError);
  const renamed = await renameRagSession(first.id, { mutationId: uuid(), baseVersion: updated.version, title: "人工标题" });
  await failure(() => updateRagSession(first.id, request), RagSessionConflictError); assert.equal((await getRagSession(first.id)).version, renamed.version);
});

test("concurrent writes serialize, exactly one matching-base update wins, concurrent reads remain valid", async () => {
  const first = await create();
  const requests = ["并发甲", "并发乙"].map(question => ({ mutationId: uuid(), baseVersion: first.version, answerMode: "logs_only", messages: content(question) }));
  const results = await Promise.allSettled([...requests.map(request => updateRagSession(first.id, request)), ...Array.from({ length: 12 }, () => getRagSession(first.id))]);
  assert.equal(results.slice(0, 2).filter(item => item.status === "fulfilled").length, 1);
  assert.ok(results.slice(0, 2).find(item => item.status === "rejected").reason instanceof RagSessionConflictError);
  assert.ok(results.slice(2).every(item => item.status === "fulfilled"));
});

test("unrelated session creation does not invalidate this session's version", async () => {
  const first = await create(); await create();
  const renamed = await renameRagSession(first.id, { mutationId: uuid(), baseVersion: first.version, title: "独立版本" });
  assert.equal(renamed.title, "独立版本"); assert.equal((await listRagSessions()).length, 2);
});

test("manual rename is versioned/idempotent; generated title never overwrites it", async () => {
  const first = await create(), request = { mutationId: uuid(), baseVersion: first.version, title: "  手动   标题  " };
  const renamed = await renameRagSession(first.id, request);
  assert.equal(renamed.title, "手动 标题"); assert.equal(renamed.titleSource, "manual");
  assert.deepEqual(await renameRagSession(first.id, request), renamed);
  assert.deepEqual(await applyGeneratedRagSessionTitle(first.id, first.version, "迟到的模型标题"), renamed);
  await failure(() => renameRagSession(first.id, { ...request, title: "不同标题" }), RagSessionConflictError);
});

test("generated title rechecks full snapshot version and updates fallback once", async () => {
  const first = await create();
  const update = await updateRagSession(first.id, { mutationId: uuid(), baseVersion: first.version, answerMode: "logs_only", messages: content("更新后问题") });
  await failure(() => applyGeneratedRagSessionTitle(first.id, first.version, "过期模型标题"), RagSessionConflictError);
  const generated = await applyGeneratedRagSessionTitle(first.id, update.version, "已生成标题"); assert.equal(generated.titleSource, "generated");
  assert.deepEqual(await applyGeneratedRagSessionTitle(first.id, update.version, "第二次标题"), generated);
});

test("delete uses versioned tombstone; identical retry succeeds and delayed creation cannot resurrect", async () => {
  const creation = input(), first = await createRagSession(creation), request = { mutationId: uuid(), baseVersion: first.version };
  await deleteRagSession(first.id, request); const before = await raw(); await deleteRagSession(first.id, request); assert.equal(await raw(), before);
  assert.deepEqual(await listRagSessions(), []); await failure(() => getRagSession(first.id), RagSessionNotFoundError);
  await failure(() => createRagSession(creation), RagSessionConflictError);
  await failure(() => deleteRagSession(first.id, { ...request, mutationId: uuid() }), RagSessionConflictError);
  const stored = JSON.parse(before); assert.equal(stored.tombstones[0].baseVersion, first.version); assert.equal(stored.tombstones.length, 1);
});

test("stale rename/delete and missing baseVersion leave original bytes untouched", async () => {
  const first = await create(), before = await raw();
  for (const operation of [() => deleteRagSession(first.id, { mutationId: uuid(), baseVersion: "a".repeat(64) }), () => renameRagSession(first.id, { mutationId: uuid(), baseVersion: "b".repeat(64), title: "过期" })]) await failure(operation, RagSessionConflictError);
  await failure(() => updateRagSession(first.id, { mutationId: uuid(), answerMode: "logs_only", messages: content() }), RagSessionInputError);
  assert.equal(await raw(), before);
});

test("streaming, duplicate IDs, incomplete pairs and oversized payloads are rejected instead of normalized", async () => {
  for (const mutate of [
    messages => { messages[1].status = "streaming"; },
    messages => { messages[1].id = messages[0].id; },
    messages => { messages[1].content = ""; },
    messages => { messages[0].role = "assistant"; },
    messages => { messages.push(messages[0]); },
    messages => { messages[1].content = "x".repeat(120001); },
    messages => { messages[1].error = "不应混入成功状态"; }
  ]) { const request = input(); mutate(request.messages); await failure(() => createRagSession(request), RagSessionInputError); }
  assert.deepEqual(await listRagSessions(), []);
});

test("stopped/error status retains its exact meaning, including empty interrupted answers", async () => {
  for (const status of ["stopped", "error"]) {
    const request = input(); request.messages[1] = { ...request.messages[1], status, content: "", ...(status === "error" ? { error: "合成失败" } : {}) };
    const saved = await createRagSession(request), loaded = await getRagSession(saved.id);
    assert.equal(loaded.messages[1].status, status); assert.equal(loaded.messages[1].content, "");
  }
});

const source = () => ({ sourceId: "S1", date: "2026-09-14", month: "2026-09", fileName: "2026-09_学习日志.md", heading: null, headingIndex: null, chunkId: "synthetic-chunk", contentHash: "synthetic-hash", excerpt: "日块前言" });
test("log-only citations retain nullable preamble positions and reject private fields/invalid sizes", async () => {
  const request = input(); request.messages[1].citations = [source()];
  assert.deepEqual((await createRagSession(request)).messages[1].citations, [source()]);
  for (const mutation of [item => { item.sourceType = "wiki"; }, item => { item.date = "2026-02-30"; }, item => { item.fileName = "../../private.md"; }, item => { item.fileName = "2025_学习日志.md"; }, item => { item.excerpt = "x".repeat(12001); }, item => { item.headingIndex = -1; }]) {
    const candidate = input(), citation = source(); mutation(citation); candidate.messages[1].citations = [citation]; await failure(() => createRagSession(candidate), RagSessionInputError);
  }
  const repeated = input(); repeated.messages[1].citations = [source(), source()]; await failure(() => createRagSession(repeated), RagSessionInputError);
  const excess = input(); excess.messages[1].citations = Array.from({ length: 31 }, (_, i) => ({ ...source(), sourceId: `S${i + 1}` })); await failure(() => createRagSession(excess), RagSessionInputError);
});

test("malformed JSON/schema/records fail closed without clearing unrelated stored sessions", async () => {
  await create(); const valid = JSON.parse(await raw());
  const cases = ["{", JSON.stringify({ sessions: [] }), JSON.stringify({ ...valid, sessions: [valid.sessions[0], {}] }), JSON.stringify({ ...valid, tombstones: [{}] }), JSON.stringify({ ...valid, sessions: [valid.sessions[0], valid.sessions[0]] })];
  for (const broken of cases) {
    await fs.writeFile(getRagSessionsFilePath(), broken);
    await failure(() => listRagSessions(), RagSessionStorageError); await failure(() => create(), RagSessionStorageError); assert.equal(await raw(), broken);
  }
});

test("every mutation backs up the complete old bytes; identical retries add no backups", async () => {
  const first = await create(), firstBytes = await raw();
  const next = await renameRagSession(first.id, { mutationId: uuid(), baseVersion: first.version, title: "备份标题" }), nextBytes = await raw();
  await deleteRagSession(first.id, { mutationId: uuid(), baseVersion: next.version });
  const backups = await backupFiles(); assert.equal(backups.length, 2);
  const contents = await Promise.all(backups.map(name => fs.readFile(path.join(process.env.BACKUP_ROOT, "rag-sessions", name), "utf8")));
  assert.ok(contents.includes(firstBytes)); assert.ok(contents.includes(nextBytes)); assert.equal(new Set(backups).size, 2);
});

test("backup or final rename failure preserves old snapshot and removes only the owned temp file", async () => {
  const first = await create(), before = await raw();
  await fs.writeFile(path.join(process.env.BACKUP_ROOT, "rag-sessions"), "not a directory");
  await failure(() => renameRagSession(first.id, { mutationId: uuid(), baseVersion: first.version, title: "不会写入" }), RagSessionStorageError); assert.equal(await raw(), before);
  await fs.unlink(path.join(process.env.BACKUP_ROOT, "rag-sessions"));
  const rename = fs.rename;
  try { fs.rename = async () => { const error = new Error("synthetic rename failure"); error.code = "EIO"; throw error; };
    await failure(() => renameRagSession(first.id, { mutationId: uuid(), baseVersion: first.version, title: "仍不会写入" }), RagSessionStorageError);
  } finally { fs.rename = rename; }
  assert.equal(await raw(), before); assert.deepEqual(await fs.readdir(path.join(process.env.LOG_ROOT, "state")), ["rag-sessions.json"]);
});

test("state/backup directory junctions cannot escape the instance boundary", async t => {
  const outside = path.join(fixture, "outside"); await fs.mkdir(outside);
  const state = path.join(process.env.LOG_ROOT, "state");
  try { await fs.symlink(outside, state, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Directory symlinks unavailable"); return; } throw error; }
  await failure(() => create(), RagSessionStorageError); assert.deepEqual(await fs.readdir(outside), []); await fs.unlink(state);
  const first = await create(), before = await raw(); await fs.symlink(outside, path.join(process.env.BACKUP_ROOT, "rag-sessions"), process.platform === "win32" ? "junction" : "dir");
  await failure(() => deleteRagSession(first.id, { mutationId: uuid(), baseVersion: first.version }), RagSessionStorageError); assert.equal(await raw(), before); assert.deepEqual(await fs.readdir(outside), []);
});

test("fallback title keeps source punctuation behavior and limits Unicode characters", () => {
  assert.equal(fallbackRagSessionTitle("## **如何读日志？** 后半句"), "如何读日志");
  assert.equal(Array.from(fallbackRagSessionTitle("😀".repeat(30))).length, 20);
});
