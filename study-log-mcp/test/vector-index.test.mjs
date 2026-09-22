import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { VectorIndex, CHUNKING_VERSION } from "../src/vector-index.mjs";
import { EmbeddingClient } from "../src/providers.mjs";
import { buildSectionChunks } from "../src/retrieval.mjs";
import { parseDayBlocks } from "../src/markdown-source.mjs";

function chunks(text = "Synthetic source not stored verbatim.") {
  return buildSectionChunks(parseDayBlocks(`## 2026-01-01\n\n### Alpha\n${text}\n\n### Beta\nOther source.`, "2026-01_学习日志.md"));
}
async function fixture(t, respond) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-vector-fixture-"));
  const logRoot = path.join(root, "data"), indexRoot = path.join(root, "index"); await fs.mkdir(logRoot);
  await fs.writeFile(path.join(logRoot, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const raw = []; for await (const chunk of req) raw.push(chunk);
    const input = JSON.parse(Buffer.concat(raw).toString()); requests.push({ url: req.url, input });
    if (respond && await respond(req, res, input)) return;
    res.end(JSON.stringify({ data: input.input.map((_, index) => ({ index, embedding: Array(input.dimensions).fill(input.model === "model-B" ? 0.25 : 0.75) })) }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("mcp-vector-fixture-")); await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { root, logRoot, indexRoot, requests, index: new VectorIndex({ logRoot, indexRoot }),
    client: options => new EmbeddingClient({ apiUrl: url + "/embedding?secret=endpoint-private-value", apiKey: "vector-private-key", model: "model-A", dimensions: 2, ...options }), url };
}

test("index reuses exact vectors, replaces changed/removed chunks, and persists no keys, endpoints or source text", async t => {
  const f = await fixture(t); const client = f.client();
  const original = chunks();
  const first = await f.index.sync(original, client); const raw = await fs.readFile(f.index.file, "utf8");
  assert.equal(f.requests.length, 1); assert.equal(Object.keys(first.chunks).length, 2);
  assert.equal((await f.index.sync(original, client)).updatedAt, first.updatedAt); assert.equal(f.requests.length, 1);
  const updated = await f.index.sync(chunks("Changed synthetic source."), client);
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].input.input.length, 1);
  assert.deepEqual(updated.chunks[original[1].id], first.chunks[original[1].id]);
  const removed = await f.index.sync(chunks("Changed synthetic source.").slice(0, 1), client);
  assert.equal(f.requests.length, 2); assert.equal(Object.keys(removed.chunks).length, 1);
  assert.doesNotMatch(raw, /vector-private-key|endpoint-private-value|http:|Synthetic source|Other source/);
  assert.equal(first.config.chunkingVersion, CHUNKING_VERSION);
  assert.deepEqual(await fs.readdir(f.indexRoot), ["index-v3.json"]);
});

test("endpoint/model/dimensions/chunk-version and instance identity changes each invalidate cached vectors", async t => {
  const f = await fixture(t), source = chunks();
  await f.index.sync(source, f.client());
  let count = f.requests.length;
  for (const options of [{ apiUrl: f.url + "/other-endpoint" }, { model: "model-B" }, { dimensions: 3 }]) {
    await f.index.sync(source, f.client(options)); assert.equal(f.requests.length, ++count);
  }
  const current = JSON.parse(await fs.readFile(f.index.file, "utf8")); current.config.chunkingVersion--;
  await fs.writeFile(f.index.file, JSON.stringify(current)); await f.index.sync(source, f.client({ dimensions: 3 })); assert.equal(f.requests.length, ++count);
  const otherRoot = path.join(f.root, "other-data"); await fs.mkdir(otherRoot);
  await fs.copyFile(path.join(f.logRoot, ".instance.json"), path.join(otherRoot, ".instance.json"));
  const other = new VectorIndex({ logRoot: otherRoot, indexRoot: f.indexRoot });
  const otherSnapshot = await other.sync(source, f.client({ dimensions: 3 })); assert.equal(f.requests.length, ++count);
  assert.notEqual(otherSnapshot.config.instanceHash, current.config.instanceHash);
  await fs.writeFile(path.join(otherRoot, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
  const replaced = await other.sync(source, f.client({ dimensions: 3 }));
  assert.equal(f.requests.length, ++count); assert.notEqual(replaced.config.instanceHash, otherSnapshot.config.instanceHash);
});

test("invalid, missing and linked instance identities fail before provider calls or index writes", async t => {
  const f = await fixture(t), file = path.join(f.logRoot, ".instance.json");
  for (const raw of ["{broken", "null", '{"schemaVersion":2,"id":"00000000-0000-0000-0000-000000000001"}', '{"schemaVersion":1,"id":"bad"}', "x".repeat(4097)]) {
    await fs.writeFile(file, raw);
    await assert.rejects(f.index.sync(chunks(), f.client()), error => error.code === "instance_identity_unavailable");
  }
  await fs.unlink(file);
  await assert.rejects(f.index.sync(chunks(), f.client()), error => error.code === "instance_identity_unavailable");
  const outside = path.join(f.root, "outside"); await fs.mkdir(outside);
  await fs.symlink(outside, file, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(f.index.sync(chunks(), f.client()), error => error.code === "instance_identity_unavailable");
  assert.equal(f.requests.length, 0); await assert.rejects(fs.stat(f.indexRoot), { code: "ENOENT" });
});

test("non-regular index files are rejected before open", async t => {
  const f = await fixture(t); await fs.mkdir(f.indexRoot); await fs.mkdir(f.index.file);
  const open = fs.open; let attempted = false;
  fs.open = async (file, ...args) => { if (file === f.index.file) { attempted = true; throw Error("must not open"); } return open(file, ...args); };
  try { await assert.rejects(f.index.sync(chunks(), f.client()), error => error.code === "unsafe_index"); }
  finally { fs.open = open; }
  assert.equal(attempted, false); assert.equal(f.requests.length, 0);
});

test("replacing instance identity during embedding does not publish a stale snapshot", async t => {
  let changeIdentity = false;
  const f = await fixture(t, async () => {
    if (changeIdentity) await fs.writeFile(path.join(f.logRoot, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
    return false;
  });
  await f.index.sync(chunks(), f.client());
  const before = await fs.readFile(f.index.file, "utf8"); changeIdentity = true;
  await assert.rejects(f.index.sync(chunks("changed"), f.client()), error => error.code === "instance_identity_unavailable");
  assert.equal(await fs.readFile(f.index.file, "utf8"), before);
});

test("malformed JSON and invalid vectors are rebuilt instead of entering similarity scoring", async t => {
  const f = await fixture(t), source = chunks(), client = f.client();
  await f.index.sync(source, client); let count = f.requests.length;
  await fs.writeFile(f.index.file, "{corrupted"); await f.index.sync(source, client); assert.equal(f.requests.length, ++count);
  for (const vector of [[1], [1, null], ["1", 0]]) {
    const current = JSON.parse(await fs.readFile(f.index.file, "utf8")); current.chunks[source[0].id].vector = vector;
    await fs.writeFile(f.index.file, JSON.stringify(current)); await f.index.sync(source, client);
    assert.equal(f.requests.length, ++count); assert.equal(f.requests.at(-1).input.input.length, 1);
  }
});

test("rename failure preserves the complete previous index and removes only its own temporary file", async t => {
  const f = await fixture(t), client = f.client(); await f.index.sync(chunks(), client);
  const before = await fs.readFile(f.index.file, "utf8"), rename = fs.rename;
  fs.rename = async (from, to) => { if (to === f.index.file) throw Object.assign(Error("synthetic permission failure"), { code: "EPERM" }); return rename(from, to); };
  try { await assert.rejects(f.index.sync(chunks("changed"), client), error => error.code === "index_write_failed"); }
  finally { fs.rename = rename; }
  assert.equal(await fs.readFile(f.index.file, "utf8"), before); assert.deepEqual(await fs.readdir(f.indexRoot), ["index-v3.json"]);
  await f.index.sync(chunks("changed"), client); assert.notEqual(await fs.readFile(f.index.file, "utf8"), before);
});

test("same-index concurrent provider configurations stay serialized with independent immutable snapshots", async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
  let first = true;
  const f = await fixture(t, async () => { if (first) { first = false; started(); await gate; } return false; });
  const source = chunks(), initialHash = source[0].hash;
  const a = f.index.sync(source, f.client()); await seen;
  source[0].hash = "caller-mutated-after-start"; source[0].embeddingText = "caller-mutated-after-start";
  const b = new VectorIndex({ logRoot: f.logRoot, indexRoot: f.indexRoot }).sync(chunks(), f.client({ model: "model-B", dimensions: 3 }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 1);
  release(); const [left, right] = await Promise.all([a, b]);
  assert.equal(left.config.model, "model-A"); assert.equal(left.chunks[source[0].id].hash, initialHash);
  assert.equal(left.chunks[source[0].id].vector.length, 2);
  assert.equal(right.config.model, "model-B"); assert.equal(right.chunks[source[0].id].vector.length, 3);
  assert.equal(JSON.parse(await fs.readFile(f.index.file, "utf8")).config.model, "model-B");
});

test("a queued cancellation is prompt and makes no provider request; the queue remains usable", async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
  let first = true;
  const f = await fixture(t, async () => { if (first) { first = false; started(); await gate; } return false; });
  const running = f.index.sync(chunks(), f.client()); await seen;
  const controller = new AbortController();
  const waiting = f.index.sync(chunks(), f.client({ model: "model-B" }), { signal: controller.signal }); controller.abort();
  await assert.rejects(waiting, error => error.code === "cancelled"); assert.equal(f.requests.length, 1);
  release(); await running; await f.index.sync(chunks(), f.client({ model: "model-B" })); assert.equal(f.requests.length, 2);
});

test("linked index roots and matching index links are never followed", async t => {
  const f = await fixture(t); const outside = path.join(f.root, "outside"); await fs.mkdir(outside);
  await fs.symlink(outside, f.indexRoot, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(f.index.sync(chunks(), f.client()), error => error.code === "UNSAFE_PATH");
  assert.equal(f.requests.length, 0); assert.deepEqual(await fs.readdir(outside), []);
  const second = path.join(f.root, "second-index"); await fs.mkdir(second);
  await fs.symlink(outside, path.join(second, "index-v3.json"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(new VectorIndex({ logRoot: f.logRoot, indexRoot: second }).sync(chunks(), f.client()), error => error.code === "UNSAFE_PATH");
  assert.equal(f.requests.length, 0);
});
