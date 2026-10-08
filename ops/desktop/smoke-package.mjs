import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

// Use the packaged executable: <package>\runtime\node.exe ops\desktop\smoke-package.mjs <package> <new evidence directory>
const [packageRoot, evidence] = process.argv.slice(2);
if (!packageRoot || !evidence || !path.isAbsolute(packageRoot) || !path.isAbsolute(evidence)) throw new Error("Provide explicit package and new synthetic evidence directories");
assert.equal(path.resolve(process.execPath).toLowerCase(), path.join(packageRoot, "runtime", "node.exe").toLowerCase(), "Run with the packaged Node, not a machine-wide runtime");
await fs.mkdir(evidence);
const { startLauncher } = await import(pathToFileURL(path.join(packageRoot, "ops", "desktop", "launcher.mjs")));
const { DesktopManager } = await import(pathToFileURL(path.join(packageRoot, "ops", "desktop", "manager.mjs")));
const manager = new DesktopManager({ packageRoot, node: process.execPath });
const root = path.join(evidence, "synthetic-instance"), restored = path.join(evidence, "restored-instance");
const launcher = await startLauncher({ packageRoot, manager, stateRoot: path.join(evidence, "launcher-state"), openBrowser: false });
const control = async (action, input = {}) => {
  const response = await fetch(`${launcher.origin}/api/${action}`, { method: "POST", headers: { Authorization: `Bearer ${launcher.token}`, Origin: launcher.origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const result = await response.json(); assert.equal(response.status, 200, result.error); return result;
};
const password = crypto.randomBytes(24).toString("base64url"), passed = [];
const mark = value => { passed.push(value); console.log(`PASS ${value}`); };
let cookie, base;
const request = (route, method = "GET", data) => fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(60000) });
async function login() {
  const result = await request("/api/auth/login", "POST", { password }); assert.equal(result.status, 200);
  cookie = result.headers.get("set-cookie").split(";")[0];
}
const mock = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  if (!body.stream) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ strategy: "relevance", dateFrom: null, dateTo: null }) } }] })); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "SyntheticLocalLearningEvidence：先保存草稿，再完成事务 [S1]。" }, finish_reason: null }] })}\n\n`);
  setTimeout(() => res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`), 2000);
});
try {
  await control("select", { root, create: true, password });
  base = (await control("start")).url;
  assert.equal((await fetch(base)).status, 200); await login();
  assert.equal((await request("/api/logs/day", "PUT", { date: "2026-10-06", content: "### SyntheticLocalLearningEvidence\n\n今天用合成例子学习了事务：先保存草稿，再完成事务。\n\n```js\nconst learned = true;\n```", baseVersion: null })).status, 200);
  assert.ok((await (await request("/api/search?q=SyntheticLocalLearningEvidence")).json()).results.length);
  const presets = await (await request("/api/ai/generation-presets")).json();
  const savedPresetResponse = await request("/api/ai/generation-presets", "POST", { version: presets.version, name: "合成技术实践方案", prompt: "只整理合成材料中的实践证据，不虚构经历。" });
  assert.equal(savedPresetResponse.status, 200); const savedPresets = await savedPresetResponse.json();
  const personal = savedPresets.presets.find(item => item.name === "合成技术实践方案"); assert.ok(personal);
  const defaultResponse = await request("/api/ai/generation-presets", "PATCH", { version: savedPresets.version, defaultPresetId: personal.id }); assert.equal(defaultResponse.status, 200);
  const presetBytes = await fs.readFile(path.join(root, "data", "prompts", "generation-presets.json"));
  mark("Packaged runtime: user-selected instance/password, no-model create/read/search");
  const before = await fs.readFile(path.join(root, "data", "2026-10_学习日志.md"));
  await control("stop");
  await assert.rejects(fs.stat(path.join(root, "data", ".instance-operation.lock")), { code: "ENOENT" });
  const templates = path.join(root, "data", "prompts");
  const credentials = await fs.readFile(path.join(root, ".env"));
  const generation = await fs.readFile(path.join(templates, "generation.md"));
  for (const name of ["highlighting", "extraction"]) {
    await fs.copyFile(new URL(`../fixtures/${name}-rc5.md`, import.meta.url), path.join(templates, `${name}.md`));
  }
  base = (await control("start")).url; await login();
  for (const name of ["highlighting", "extraction"]) {
    assert.deepEqual(await fs.readFile(path.join(templates, `${name}.md`)), await fs.readFile(path.join(packageRoot, "prompts", `${name}.md`)));
    const backups = (await fs.readdir(path.join(templates, ".default-upgrades"))).filter(file => file.startsWith(`${name}-`) && file.endsWith(".md"));
    assert.equal(backups.length, 1);
    assert.deepEqual(await fs.readFile(path.join(templates, ".default-upgrades", backups[0])), await fs.readFile(new URL(`../fixtures/${name}-rc5.md`, import.meta.url)));
  }
  assert.deepEqual(await fs.readFile(path.join(root, ".env")), credentials);
  assert.deepEqual(await fs.readFile(path.join(templates, "generation.md")), generation);
  assert.deepEqual(await fs.readFile(path.join(templates, "generation-presets.json")), presetBytes);
  mark("Packaged startup upgrades exact rc.5 defaults with original backups; credentials and personal schemes preserved");
  assert.match((await (await request("/api/logs/day?date=2026-10-06")).json()).day.content, /SyntheticLocalLearningEvidence/);
  mark("Actual Next and MCP clean IPC shutdown, lock release, restart persistence");
  await control("stop");
  await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
  await control("configure", { apiUrl: `http://127.0.0.1:${mock.address().port}/chat`, model: "synthetic-mock", apiKey: "synthetic-local-only" });
  base = (await control("start")).url; await login();
  const answer = await request("/api/rag/query", "POST", { question: "SyntheticLocalLearningEvidence" }); assert.equal(answer.status, 200);
  const reader = answer.body.getReader(); let stream = "";
  while (!stream.includes("event: delta")) { const next = await reader.read(); assert.equal(next.done, false); stream += new TextDecoder().decode(next.value); }
  const stopping = control("stop");
  while (true) { const next = await reader.read(); if (next.done) break; stream += new TextDecoder().decode(next.value); }
  await stopping;
  assert.match(stream, /event: done/); assert.doesNotMatch(stream, /event: error/);
  const done = JSON.parse(stream.split("\n\n").find(frame => frame.startsWith("event: done\n")).split("\ndata: ")[1]);
  assert.equal(done.diagnostics.retrievalMode, "lexical_fallback"); assert.ok(done.citations.length);
  assert.deepEqual(await fs.readFile(path.join(root, "data", "2026-10_学习日志.md")), before);
  await assert.rejects(fs.stat(path.join(root, "data", ".instance-operation.lock")), { code: "ENOENT" });
  mark("Actual Web→local keyword MCP→synthetic model citations, stop during RAG waits for done");
  const archive = path.join(evidence, "synthetic.slwb"); await control("backup", { archive });
  assert.equal((await control("verify", { archive })).verified, true);
  await control("restore", { archive, root: restored });
  base = (await control("start")).url; await login();
  assert.deepEqual(await fs.readFile(path.join(restored, "data", "2026-10_学习日志.md")), before);
  assert.deepEqual(await fs.readFile(path.join(restored, "data", "prompts", "generation-presets.json")), presetBytes);
  const restoredPresets = await (await request("/api/ai/generation-presets")).json(); assert.equal(restoredPresets.defaultPresetId, personal.id);
  await control("stop"); await launcher.close();
  mark("Full-instance backup, digest verification, restore to new directory and reopen including custom generation scheme/default");
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify({ passed, node: process.version, platform: process.platform, packageRoot, testedAt: new Date().toISOString(), limitation: "Maintainer-operated synthetic local package acceptance; not independent user feedback or real-model quality." }, null, 2));
  console.log(JSON.stringify({ passed, report: path.join(evidence, "report.json") }));
} finally { await launcher.close(); await new Promise(resolve => mock.close(resolve)); }
