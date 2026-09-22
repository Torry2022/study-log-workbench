import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startHttpServer } from "../src/http-server.mjs";
import { MAX_REQUEST_BYTES } from "../src/server.mjs";
import { acquireIndexGuard } from "../src/index-guard.mjs";

const source = "## 2026-01-01\n\nSynthetic preamble.\n\n### Alpha\nSyntheticAlpha source evidence.\n\n---\n\n## 2026-01-02\n\n### Beta\nSyntheticBeta other evidence.";
const noModels = { embedding: { apiKey: "", apiUrl: "", model: "" }, reranker: { apiKey: "", apiUrl: "", model: "" }, rerankEnabled: false };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-protocol-fixture-"));
  const logRoot = path.join(root, "data"), indexRoot = path.join(root, "index"); await fs.mkdir(logRoot);
  await fs.writeFile(path.join(logRoot, "2026-01_学习日志.md"), source);
  await fs.writeFile(path.join(logRoot, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("mcp-protocol-fixture-")); await fs.rm(root, { recursive: true, force: true }); });
  return { root, logRoot, indexRoot, retrieval: noModels, token: "synthetic-protocol-token", port: 0 };
}
function client(era = "modern") {
  return new Client({ name: "synthetic-test", version: "1" }, era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : { supportedProtocolVersions: ["2025-11-25"] });
}
function data(result) { assert.notEqual(result.isError, true, JSON.stringify(result)); return JSON.parse(result.content[0].text); }
async function checkTools(c) {
  const { tools } = await c.listTools(); assert.equal(tools.length, 8);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  const call = async (name, args = {}) => data(await c.callTool({ name, arguments: args }));
  assert.equal((await call("list_months")).months[0].id, "2026-01");
  assert.equal((await call("list_days", { month: "2026-01" })).days.length, 2);
  assert.match((await call("get_day", { date: "2026-01-01" })).day.content, /SyntheticAlpha/);
  assert.equal((await call("search_logs", { query: "SyntheticAlpha" })).results.length, 1);
  assert.ok((await call("find_related", { input: "SyntheticAlpha" })).results.length);
  const evidence = await call("retrieve_contexts", { input: "SyntheticAlpha", matchMode: "literal", dateFrom: "2026-01-01", dateTo: "2026-01-01" });
  assert.equal(evidence.retrieval.mode, "literal"); assert.equal(evidence.contexts[0].heading, "Alpha"); assert.equal(evidence.contexts[0].sourceId, "S1");
  assert.equal((await call("get_recent_context", { limit: 1 })).days[0].date, "2026-01-02");
  assert.equal((await call("get_style_examples")).examples[0].date, "2026-01-02");
  for (const args of [{ input: "Synthetic", wiki: true }, { input: "Synthetic", maxChunks: 1.5 }, { input: "Synthetic", dateFrom: "2026-02-31" }]) {
    const result = await c.callTool({ name: "retrieve_contexts", arguments: args }); assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /filePath|synthetic-protocol-token/);
  }
}

for (const era of ["modern", "legacy"]) {
  test(`real SDK ${era} HTTP negotiates, reads all 8 tools and holds no session`, async t => {
    const f = await fixture(t), service = await startHttpServer(f); t.after(() => service.close());
    const c = client(era), transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.address.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${f.token}` } } });
    t.after(() => c.close()); await c.connect(transport); await checkTools(c);
    assert.equal(c.getNegotiatedProtocolVersion(), era === "modern" ? "2026-07-28" : "2025-11-25"); assert.equal(transport.sessionId, undefined);
    assert.equal(await fs.readFile(path.join(f.logRoot, "2026-01_学习日志.md"), "utf8"), source);
    await assert.rejects(fs.stat(f.indexRoot), { code: "ENOENT" });
  });
  test(`real SDK ${era} stdio needs no token and stderr does not corrupt the protocol`, async t => {
    const f = await fixture(t), c = client(era);
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
      env: { LOG_ROOT: f.logRoot, INDEX_ROOT: f.indexRoot, EMBEDDING_API_KEY: "", RERANK_API_KEY: "" }, stderr: "pipe" });
    let stderr = ""; transport.stderr.on("data", chunk => { stderr += chunk; });
    t.after(() => c.close()); await c.connect(transport); await checkTools(c); await c.close();
    assert.match(stderr, /MCP stdio ready/); assert.doesNotMatch(stderr, /SyntheticAlpha|synthetic-protocol-token/); assert.ok(!stderr.includes(f.root));
    await assert.rejects(fs.stat(f.indexRoot), { code: "ENOENT" });
  });
}

test("HTTP requires token before roots, rejects bad host/origin/auth/body and exposes only guarded health", async t => {
  for (const token of ["", "  ", "a b", "x\n"]) await assert.rejects(startHttpServer({ token }), /TOKEN/);
  const f = await fixture(t), service = await startHttpServer(f); t.after(() => service.close());
  const url = `http://127.0.0.1:${service.address.port}`;
  const auth = { Authorization: `Bearer ${f.token}` };
  for (const [headers, status] of [[{}, 401], [{ Authorization: "Bearer wrong" }, 401], [{ ...auth, Host: "attacker.example" }, 403], [{ ...auth, Host: "user@localhost" }, 403], ...["https://attacker.example", "null", "", "ftp://localhost", "http://localhost/path", "http://user@localhost"].map(Origin => [{ ...auth, Origin }, 403])]) {
    const response = await new Promise((resolve, reject) => {
      const req = http.get(url + "/health", { headers }, res => { res.resume(); res.once("end", () => resolve(res)); }); req.once("error", reject);
    }); assert.equal(response.statusCode, status, JSON.stringify(headers));
  }
  assert.deepEqual(await (await fetch(url + "/health", { headers: auth })).json(), { status: "ok" });
  for (const [endpoint, method, body, headers, status] of [
    ["/mcp", "GET", undefined, {}, 405], ["/mcp", "DELETE", undefined, {}, 405], ["/other", "POST", "{}", {}, 404],
    ["/mcp", "POST", "{}", { "Content-Type": "text/plain" }, 415],
    ["/mcp", "POST", "{bad", {}, 400], ["/mcp", "POST", "[]", {}, 400], ["/mcp", "POST", "x".repeat(MAX_REQUEST_BYTES + 1), {}, 413],
    ["/mcp", "POST", "{}", { "Content-Encoding": "gzip" }, 415]
  ]) {
    const response = await fetch(url + endpoint, { method, body, headers: { "Content-Type": "application/json", ...auth, ...headers } });
    assert.equal(response.status, status); await response.text();
  }
  await assert.rejects(fs.stat(f.indexRoot), { code: "ENOENT" });
});

test("HTTP bounds chunked bodies and supports explicitly allowed remote hostnames", async t => {
  const f = await fixture(t), service = await startHttpServer({ ...f, allowedHosts: ["example.test"], allowedOrigins: ["app.example.test"] });
  t.after(() => service.close());
  const request = (chunks, extra = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: service.address.port, path: "/mcp", method: "POST", headers: {
      Host: "example.test", Origin: "https://app.example.test", Authorization: `Bearer ${f.token}`, "Content-Type": "application/json", ...extra
    } }, res => { res.resume(); res.once("end", () => resolve(res.statusCode)); });
    req.on("error", reject); for (const chunk of chunks) req.write(chunk); req.end();
  });
  assert.equal(await request(["{", " ".repeat(MAX_REQUEST_BYTES), "}"]), 413);
  assert.equal(await request(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'], { Accept: "application/json, text/event-stream" }), 200);
});

test("stdio EOF and oversized input release the configured vector guard and emit no plain stdout logging", async t => {
  for (const oversized of [false, true]) {
    const f = await fixture(t);
    const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {
      LOG_ROOT: f.logRoot, INDEX_ROOT: f.indexRoot, EMBEDDING_API_KEY: "synthetic-key", EMBEDDING_API_URL: "http://127.0.0.1:1/unused", EMBEDDING_MODEL: "unused", RERANK_API_KEY: ""
    } });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; });
    const ready = new Promise(resolve => child.stderr.on("data", chunk => { stderr += chunk; if (stderr.includes("MCP stdio ready.")) resolve(); }));
    const exited = new Promise(resolve => child.once("exit", resolve));
    await ready; await fs.stat(path.join(f.indexRoot, ".mcp-index.lock"));
    if (oversized) child.stdin.write("x".repeat(MAX_REQUEST_BYTES + 1));
    child.stdin.end(); await exited;
    assert.equal(stdout, ""); assert.doesNotMatch(stderr, /synthetic-key|unused/); assert.ok(!stderr.includes(f.root));
    if (oversized) assert.match(stderr, /MCP request or transport failed/);
    await assert.rejects(fs.stat(path.join(f.indexRoot, ".mcp-index.lock")), { code: "ENOENT" });
  }
});

test("index ownership rejects competing processes and stale/foreign locks are never removed", async t => {
  const f = await fixture(t), release = await acquireIndexGuard(f.indexRoot);
  const script = `import {acquireIndexGuard} from ${JSON.stringify(new URL("../src/index-guard.mjs", import.meta.url).href)}; try { await acquireIndexGuard(process.argv[1]); process.exitCode=2; } catch { process.exitCode=0; }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.indexRoot], { stdio: "ignore", windowsHide: true });
  assert.equal(await new Promise(resolve => child.once("exit", resolve)), 0);
  await release(); const again = await acquireIndexGuard(f.indexRoot); await again();
  const lock = path.join(f.indexRoot, ".mcp-index.lock"); await fs.writeFile(lock, '{"pid":99999999,"owner":"stale"}');
  await assert.rejects(acquireIndexGuard(f.indexRoot), /locked/); assert.match(await fs.readFile(lock, "utf8"), /stale/);
  await fs.unlink(lock); const own = await acquireIndexGuard(f.indexRoot); await fs.writeFile(lock, '{"owner":"replaced"}');
  await assert.rejects(own(), /ownership/); assert.match(await fs.readFile(lock, "utf8"), /replaced/);
});

for (const era of ["modern", "legacy"]) test(`${era} HTTP cancellation and service shutdown abort in-flight providers and release guard`, async t => {
  const f = await fixture(t); let began, disconnected;
  let seen = new Promise(resolve => { began = resolve; }), gone = new Promise(resolve => { disconnected = resolve; });
  const upstream = http.createServer((req, res) => { req.resume(); res.write("{"); res.once("close", () => disconnected()); began(); });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const service = await startHttpServer({ ...f, retrieval: { ...noModels, embedding: { apiKey: "mock-key", apiUrl: `http://127.0.0.1:${upstream.address().port}/embed`, model: "mock", dimensions: 2, timeoutMs: 5000 } } });
  t.after(() => service.close());
  const connect = async () => {
    const c = client(era), transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${service.address.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${f.token}` } } });
    await c.connect(transport); t.after(() => c.close()); return c;
  };
  let c = await connect();
  const abort = new AbortController(); const call = c.callTool({ name: "retrieve_contexts", arguments: { input: "SyntheticAlpha" } }, { signal: abort.signal });
  const failed = assert.rejects(call); await seen; const cancelledAt = Date.now(); abort.abort(); await failed;
  // Legacy stateless requests have no shared session for cancellation notices;
  // closing the client transport closes the outstanding HTTP exchange.
  if (era === "legacy") await c.close();
  await gone; assert.ok(Date.now() - cancelledAt < 1000, "provider must abort instead of reaching its 5-second timeout");
  if (era === "legacy") c = await connect();
  seen = new Promise(resolve => { began = resolve; }); gone = new Promise(resolve => { disconnected = resolve; });
  const pending = c.callTool({ name: "retrieve_contexts", arguments: { input: "SyntheticAlpha" } }); const stopped = assert.rejects(pending);
  await seen; await service.close(); await stopped; await gone;
  await assert.rejects(fs.stat(path.join(f.indexRoot, ".mcp-index.lock")), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(f.indexRoot), []);
});
