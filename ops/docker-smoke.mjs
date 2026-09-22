import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { parseEnv } from "node:util";
import { pdf, docx } from "./material-fixtures.mjs";

// This script creates a new synthetic instance every time. It never accepts an
// existing data directory or targets a non-loopback Web address.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/\D/g, "");
const project = `public-rebuild-b27-${stamp}`;
const root = path.join(repository, ".local", project), instance = path.join(root, "instance");
const port = 3580, base = `http://127.0.0.1:${port}/study-log`;
const run = promisify(execFile), passed = [];
const environment = { ...process.env, INSTANCE_PARENT: root, INSTANCE_ROOT: instance, WEB_PORT: String(port),
  WEB_IMAGE: "study-log-public-rebuild-web:b27", MCP_IMAGE: "study-log-public-rebuild-mcp:b27", TOOLS_IMAGE: "study-log-public-rebuild-tools:b27" };
const docker = async args => (await run("docker", args, { cwd: repository, env: environment, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const compose = args => docker(["compose", "-p", project, "-f", "compose.yaml", ...args]);
const mark = name => { passed.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
let cookie;
async function request(route, method = "GET", body) {
  const response = await fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return response;
}
async function waitWeb() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(500);
  }
  throw new Error("Synthetic Docker Web did not become ready.");
}
async function login() {
  const env = parseEnv(await fs.readFile(path.join(environment.INSTANCE_ROOT, ".env"), "utf8"));
  const response = await request("/api/auth/login", "POST", { password: env.APP_PASSWORD });
  assert.equal(response.status, 200); cookie = response.headers.get("set-cookie").split(";")[0];
}
async function snapshot(rootPath) {
  const entries = {};
  async function walk(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === "index" && !prefix) continue;
      assert.ok(!entry.isSymbolicLink()); const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + "/");
      else entries[relative] = sha(await fs.readFile(path.join(directory, entry.name)));
    }
  }
  await walk(rootPath); return entries;
}

await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(resolve)); });
await fs.mkdir(root, { recursive: true, mode: 0o700 });
if (process.platform !== "win32" && process.getuid?.() === 0) await fs.chown(root, 1000, 1000);
console.log(`Synthetic deployment project: ${project}`);
try {
  await compose(["run", "--rm", "--no-deps", "tools", "ops/instance.mjs", "init", "/instances/instance"]);
  const beforeInit = await snapshot(instance);
  await compose(["run", "--rm", "--no-deps", "tools", "ops/instance.mjs", "init", "/instances/instance"]);
  assert.deepEqual(await snapshot(instance), beforeInit); mark("tools bootstrap without env; repeat init preserves credentials/identity/prompts");
  await compose(["up", "-d", "--no-build", "web"]); await waitWeb();
  assert.equal((await request("/api/capabilities")).status, 401); await login();
  const caps = await (await request("/api/capabilities")).json(); assert.equal(caps.features.aiWriting.configured, false); assert.equal(caps.features.rag.configured, false);
  const identity = caps.instanceId;
  const content = "## 2026-01-01\n\n### DockerAlpha\nSyntheticDockerEvidence. Formula: $x^2$.\n\n```js\nconst synthetic = true;\n```";
  const save = await request("/api/logs/day", "PUT", { date: "2026-01-01", content, baseVersion: null }); assert.equal(save.status, 200);
  const saved = (await save.json()).day;
  const note = await request("/api/notes", "POST", { title: "Docker synthetic note", body: "Synthetic note body", insight: "Synthetic insight", sources: [], tags: ["synthetic"], recordedAt: "2026-01-01T12:00:00+08:00" }); assert.equal(note.status, 200);
  assert.equal((await request("/api/ai/generate", "POST", { date: "2026-01-01", material: "Synthetic material" })).status, 503);
  assert.equal((await request("/api/rag/query", "POST", { question: "SyntheticDockerEvidence" })).status, 503);
  mark("Web authentication, empty AI configuration, log and note persistence");
  for (const [name, bytes] of [["synthetic.pdf", pdf(["Synthetic PDF Docker text"])], ["synthetic.docx", docx("Synthetic DOCX Docker text")]]) {
    const form = new FormData(); form.set("file", new File([bytes], name));
    const response = await fetch(base + "/api/materials/extract", { method: "POST", headers: { cookie }, body: form });
    assert.equal(response.status, 200, name); assert.match(JSON.stringify(await response.json()), /Synthetic (PDF|DOCX) Docker text/);
  }
  mark("standalone PDF worker/fonts and DOCX runtime resources");
  const webId = await compose(["ps", "-q", "web"]);
  assert.equal(await docker(["exec", webId, "id", "-u"]), "1000"); assert.match(await docker(["exec", webId, "node", "--version"]), /^v22\./);
  await assert.rejects(compose(["run", "--rm", "--no-deps", "tools", "ops/archive-cli.mjs", "backup", "/instances/instance", "/instances/online.slarchive"]));
  await compose(["restart", "web"]); await waitWeb(); await login();
  assert.equal((await (await request("/api/logs/day?date=2026-01-01")).json()).day.version, saved.version);
  assert.equal((await (await request("/api/capabilities")).json()).instanceId, identity); mark("UID1000 Node22, online maintenance refusal, restart preserves data and releases lock");

  const mcpToken = crypto.randomBytes(24).toString("base64url");
  await fs.writeFile(path.join(instance, ".env.mcp"), `MCP_HTTP_TOKEN=${mcpToken}\n`, { mode: 0o600 });
  await fs.appendFile(path.join(instance, ".env"), `STUDY_LOG_MCP_URL=http://study-log-mcp:3020/mcp\nSTUDY_LOG_MCP_TOKEN=${mcpToken}\n`);
  await compose(["--profile", "retrieval", "up", "-d", "--no-build"]); await waitWeb();
  const mcpId = await compose(["ps", "-q", "study-log-mcp"]);
  const checkMcp = `const fs=await import('node:fs/promises');const assert=(await import('node:assert/strict')).default;const h={Authorization:'Bearer '+process.env.MCP_HTTP_TOKEN,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'};assert.equal((await fetch('http://127.0.0.1:3020/health')).status,401);const r=await fetch('http://127.0.0.1:3020/mcp',{method:'POST',headers:h,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'retrieve_contexts',arguments:{input:'SyntheticDockerEvidence',matchMode:'literal'}}})});assert.equal(r.status,200);assert.match(await r.text(),/SyntheticDockerEvidence/);await assert.rejects(fs.writeFile('/instance/data/.readonly-probe','x'));assert.deepEqual(await fs.readdir('/instance/index'),[]);assert.equal(process.env.APP_PASSWORD,undefined);assert.equal(process.env.CHAT_API_KEY,undefined);console.log('MCP read-only/keyword/auth/environment isolation passed');`;
  for (let attempt = 0; ; attempt++) { try { await docker(["exec", mcpId, "node", "--input-type=module", "-e", checkMcp]); break; } catch (error) { if (attempt >= 20) throw error; await delay(500); } }
  const currentWebId = await compose(["ps", "-q", "web"]);
  const states = JSON.parse(await docker(["inspect", currentWebId, mcpId, "--format", "[{{json .State.Running}},{{json .Config.User}},{{json .NetworkSettings.Ports}}]"] ).then(value => "[" + value.split(/\r?\n/).join(",") + "]"));
  assert.ok(states.every(state => state[0])); assert.ok(states.every(state => state[1] === "node"));
  assert.ok(!states[1][2]?.["3020/tcp"]); mark("both containers running; MCP raw read-only keyword, independent env, index unchanged, no host port");
  await compose(["--profile", "retrieval", "stop"]);
  await assert.rejects(fs.stat(path.join(instance, "data", ".instance-operation.lock")), { code: "ENOENT" });
  const beforeArchive = await snapshot(instance);
  await compose(["run", "--rm", "--no-deps", "tools", "ops/archive-cli.mjs", "backup", "/instances/instance", "/instances/synthetic.slarchive"]);
  await compose(["run", "--rm", "--no-deps", "tools", "ops/archive-cli.mjs", "verify", "/instances/synthetic.slarchive"]);
  await compose(["run", "--rm", "--no-deps", "tools", "ops/archive-cli.mjs", "restore", "/instances/synthetic.slarchive", "/instances/restored"]);
  const restored = path.join(root, "restored"); assert.deepEqual(await snapshot(restored), beforeArchive);
  await assert.rejects(compose(["run", "--rm", "--no-deps", "tools", "ops/archive-cli.mjs", "restore", "/instances/synthetic.slarchive", "/instances/restored"]));
  environment.INSTANCE_ROOT = restored;
  await compose(["--profile", "retrieval", "up", "-d", "--no-build"]); await waitWeb(); await login();
  assert.equal((await (await request("/api/capabilities")).json()).instanceId, identity);
  assert.equal((await (await request("/api/logs/day?date=2026-01-01")).json()).day.content, saved.content);
  assert.equal((await (await request("/api/notes")).json()).notes.length, 1);
  mark("same-version archive/restore byte equality, no overwrite, identity/auth/data usable after restore");
  await fs.writeFile(path.join(root, "report.json"), JSON.stringify({ project, root, passed, testedAt: new Date().toISOString(), limitation: "Synthetic maintainer-run acceptance; independent installation, real models and cross-version upgrade remain unverified." }, null, 2));
  console.log(JSON.stringify({ passed, report: path.join(root, "report.json") }));
} finally {
  await compose(["--profile", "retrieval", "down"]).catch(() => {});
}
