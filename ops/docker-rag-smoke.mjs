import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { promisify, parseEnv } from "node:util";
import { execFile } from "node:child_process";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `public-rebuild-rag-${new Date().toISOString().replace(/\D/g, "")}`;
const root = path.join(repository, ".local", project), instance = path.join(root, "instance"), port = 3581;
const base = `http://127.0.0.1:${port}/study-log`, run = promisify(execFile), passed = [];
const environment = { ...process.env, INSTANCE_PARENT: root, INSTANCE_ROOT: instance, WEB_PORT: String(port),
  WEB_IMAGE: process.env.WEB_IMAGE || "study-log-public-rebuild-web:b27",
  MCP_IMAGE: process.env.MCP_IMAGE || "study-log-public-rebuild-mcp:b27",
  TOOLS_IMAGE: process.env.TOOLS_IMAGE || "study-log-public-rebuild-tools:b27" };
const docker = async args => (await run("docker", args, { cwd: repository, env: environment, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const override = path.join(root, "compose.mock.json");
const compose = args => docker(["compose", "-p", project, "-f", "compose.yaml", "-f", override, ...args]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mark = name => { passed.push(name); console.log(`PASS ${name}`); };
let cookie;
async function request(route, method = "GET", body) {
  return fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(100000) });
}
async function waitWeb() {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {} await delay(500); }
  throw new Error("Synthetic RAG Web did not become ready.");
}
async function login() {
  const env = parseEnv(await fs.readFile(path.join(instance, ".env"), "utf8"));
  const response = await request("/api/auth/login", "POST", { password: env.APP_PASSWORD }); assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie").split(";")[0];
}
async function answer(question) {
  const response = await request("/api/rag/query", "POST", { question }); assert.equal(response.status, 200);
  const raw = await response.text(); assert.doesNotMatch(raw, /event: error/); assert.match(raw, /event: done/);
  const frames = raw.split("\n\n"); return JSON.parse(frames.find(frame => frame.startsWith("event: done\n")).split("\ndata: ")[1]);
}
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(resolve)); });
await fs.mkdir(root, { recursive: true, mode: 0o700 });
if (process.platform !== "win32" && process.getuid?.() === 0) await fs.chown(root, 1000, 1000);
await fs.writeFile(path.join(root, "mock.mjs"), `import http from 'node:http';
http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.end('ok');return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
 if(req.url==='/embedding'){res.end(JSON.stringify({data:body.input.map((_,index)=>({index,embedding:[1,0]}))}));return;}
 if(!body.stream){res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({strategy:'relevance',dateFrom:null,dateTo:null})}}]}));return;}
 const slow=body.messages.some(m=>m.content.includes('SlowSyntheticDockerEvidence'));
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 res.write('data: '+JSON.stringify({choices:[{delta:{content:'合成模型替身回答 [S1]。'},finish_reason:null}]})+'\\n\\n');
 console.log(slow?'slow-start':'short-start');
 const timer=setTimeout(()=>{res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n');},slow?15000:20);
 res.once('close',()=>{clearTimeout(timer);console.log(slow?'slow-close':'short-close');});
}).listen(8080,'0.0.0.0');
`);
await fs.writeFile(override, JSON.stringify({ services: { "mock-model": { image: environment.TOOLS_IMAGE, init: true, command: ["/mock.mjs"], volumes: [{ type: "bind", source: path.join(root, "mock.mjs"), target: "/mock.mjs", read_only: true }], healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: "2s", timeout: "2s", retries: 5 } } } }));
console.log(`Synthetic RAG deployment project: ${project}`);
try {
  await compose(["run", "--rm", "--no-deps", "tools", "ops/instance.mjs", "init", "/instances/instance"]);
  const token = crypto.randomBytes(24).toString("base64url");
  const webEnv = path.join(instance, ".env");
  let text = await fs.readFile(webEnv, "utf8");
  text = text.replace(/^CHAT_API_URL=.*$/m, "CHAT_API_URL=http://mock-model:8080/chat").replace(/^CHAT_API_KEY=.*$/m, "CHAT_API_KEY=synthetic-mock-only").replace(/^CHAT_MODEL=.*$/m, "CHAT_MODEL=synthetic-mock");
  await fs.writeFile(webEnv, text + `STUDY_LOG_MCP_URL=http://study-log-mcp:3020/mcp\nSTUDY_LOG_MCP_TOKEN=${token}\n`);
  const mcpEnv = path.join(instance, ".env.mcp"); await fs.writeFile(mcpEnv, `MCP_HTTP_TOKEN=${token}\n`, { mode: 0o600 });
  await compose(["--profile", "retrieval", "up", "-d", "--no-build"]); await waitWeb(); await login();
  const content = "## 2026-01-01\n\n### SyntheticDockerEvidence\nSyntheticDockerEvidence source.\n\n### SlowSyntheticDockerEvidence\nSlowSyntheticDockerEvidence stream source.";
  assert.equal((await request("/api/logs/day", "PUT", { date: "2026-01-01", content, baseVersion: null })).status, 200);
  const keyword = await answer("SyntheticDockerEvidence"); assert.equal(keyword.diagnostics.retrievalMode, "lexical_fallback"); assert.ok(keyword.citations.length);
  mark("Docker Web→MCP keyword→mock chat SSE done with source citations");
  await fs.appendFile(mcpEnv, "EMBEDDING_API_KEY=synthetic-vector-only\nEMBEDDING_API_URL=http://mock-model:8080/embedding\nEMBEDDING_MODEL=synthetic-vector\nEMBEDDING_DIMENSIONS=2\n");
  await compose(["--profile", "retrieval", "up", "-d", "--no-build", "--force-recreate", "study-log-mcp"]);
  const mcpId = await compose(["ps", "-q", "study-log-mcp"]);
  for (let i = 0; ; i++) {
    try { await docker(["exec", mcpId, "node", "-e", "fetch('http://127.0.0.1:3020/health',{headers:{Authorization:'Bearer '+process.env.MCP_HTTP_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]); break; }
    catch (error) { if (i >= 20) throw error; await delay(500); }
  }
  const hybrid = await answer("SyntheticDockerEvidence"); assert.equal(hybrid.diagnostics.retrievalMode, "hybrid"); assert.ok(hybrid.citations.length);
  await fs.stat(path.join(instance, "index", "index-v3.json")); mark("Docker optional embedding mock produces hybrid diagnostics and independent cache");
  const before = await fs.readFile(path.join(instance, "data", "2026-01_学习日志.md"));
  const response = await request("/api/rag/query", "POST", { question: "SlowSyntheticDockerEvidence" }); assert.equal(response.status, 200);
  const reader = response.body.getReader(); let stream = "";
  while (!stream.includes("event: delta")) { const { value, done } = await reader.read(); assert.equal(done, false); stream += new TextDecoder().decode(value); }
  const started = Date.now(); const stopping = compose(["--profile", "retrieval", "stop", "web"]);
  let disconnected = false;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; stream += new TextDecoder().decode(value); } } catch { disconnected = true; }
  await stopping;
  const elapsedMs = Date.now() - started;
  assert.ok(elapsedMs < 110000); await assert.rejects(fs.stat(path.join(instance, "data", ".instance-operation.lock")), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(path.join(instance, "data", "2026-01_学习日志.md")), before);
  const webId = await compose(["ps", "-a", "-q", "web"]);
  const state = JSON.parse(await docker(["inspect", webId, "--format", "{{json .State}}"])); assert.equal(state.ExitCode, 0); assert.equal(state.OOMKilled, false);
  mark(`SIGTERM during RAG delta: clean exit and source unchanged (${elapsedMs}ms, ${disconnected ? "stream disconnected" : stream.includes("event: done") ? "stream completed" : "stream ended"})`);
  await compose(["--profile", "retrieval", "stop", "study-log-mcp"]);
  await assert.rejects(fs.stat(path.join(instance, "index", ".mcp-index.lock")), { code: "ENOENT" });
  await fs.writeFile(path.join(root, "report.json"), JSON.stringify({ project, passed, elapsedMs, disconnected, streamCompleted: stream.includes("event: done"), testedAt: new Date().toISOString(), limitation: "Local synthetic model protocol only; no real model quality or independent installation validation." }, null, 2));
  console.log(JSON.stringify({ passed, report: path.join(root, "report.json") }));
} finally { await compose(["--profile", "retrieval", "down"]).catch(() => {}); }
