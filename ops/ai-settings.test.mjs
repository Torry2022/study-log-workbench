import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { initializeAiSettings, readAiSettings, saveAiSettings, aiSettingsSummary } from "./ai-settings.mjs";
import { initialize } from "./instance.mjs";
import { runService } from "./service.mjs";
import { parseEnv } from "node:util";

const env = { CHAT_API_URL: "https://example.invalid/v1/chat?secret=synthetic", CHAT_MODEL: "synthetic-model", CHAT_API_KEY: "synthetic-key", CHAT_LIGHT_MODEL: "synthetic-light", RAG_AGENT_TOOL_CALLING_VERIFIED: "true", RAG_STATUS_VERIFICATION_ENABLED: "true", RAG_CONTEXT_WINDOW_TOKENS: "120000" };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "study-ai-settings-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, instanceId: randomUUID(), env };
}
test("one-time import, private summary, idempotency before conflict, and distinct instance protection", async t => {
  const f = await fixture(t), first = await initializeAiSettings(f);
  assert.equal(first.values.CHAT_LIGHT_MODEL, "synthetic-light");
  assert.equal((await initializeAiSettings({ ...f, env: { CHAT_MODEL: "later" } })).values.CHAT_MODEL, "synthetic-model");
  const summary = aiSettingsSummary(first), displayed = JSON.stringify(summary);
  assert.equal(summary.endpointDisplay, "https://example.invalid");
  assert.ok(!displayed.includes("synthetic-key") && !displayed.includes("secret=synthetic"));
  const operationId = randomUUID();
  const saved = await saveAiSettings({ ...f, expectedRevision: 1, operationId, keyAction: "keep", values: { ...first.values, CHAT_LIGHT_MODEL: "another" } });
  assert.equal(saved.revision, 2);
  const repeated = await saveAiSettings({ ...f, expectedRevision: 1, operationId, keyAction: "remove", values: {} });
  assert.equal(repeated.revision, 2); assert.equal(repeated.hasKey, true);
  await assert.rejects(saveAiSettings({ ...f, expectedRevision: 1, operationId: randomUUID(), keyAction: "keep", values: first.values }), { code: "AI_SETTINGS_CONFLICT" });
  await assert.rejects(readAiSettings(f.root, randomUUID()), { code: "AI_SETTINGS_INSTANCE_CHANGED" });
});
test("replacement prevents sending an old key to a new target and invalidates verified capabilities", async t => {
  const f = await fixture(t), initial = await initializeAiSettings(f), changed = { ...initial.values, CHAT_API_URL: "https://other.invalid/chat" };
  await assert.rejects(saveAiSettings({ ...f, expectedRevision: 1, operationId: randomUUID(), values: changed, keyAction: "keep" }), { code: "AI_SETTINGS_KEY_TARGET_CHANGED" });
  await saveAiSettings({ ...f, expectedRevision: 1, operationId: randomUUID(), values: { ...changed, CHAT_API_KEY: "new-synthetic" }, keyAction: "replace" });
  const actual = await readAiSettings(f.root, f.instanceId);
  assert.equal(actual.values.CHAT_API_KEY, "new-synthetic");
  assert.equal(actual.values.RAG_AGENT_TOOL_CALLING_VERIFIED, "false");
  assert.equal(actual.values.RAG_STATUS_VERIFICATION_ENABLED, "false");
  assert.equal(actual.values.RAG_CONTEXT_WINDOW_TOKENS, "");
});
test("corruption is never interpreted as absent configuration", async t => {
  const f = await fixture(t); await initializeAiSettings(f);
  await fs.writeFile(path.join(f.root, "ai-settings.json"), "{broken");
  await assert.rejects(initializeAiSettings(f), { code: "AI_SETTINGS_INVALID" });
  assert.equal(await fs.readFile(path.join(f.root, "ai-settings.json"), "utf8"), "{broken");
});
test("the SQLite lock is released when a writer process exits unexpectedly", async t => {
  const f = await fixture(t); await initializeAiSettings(f);
  const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('locked');setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ["-e", script, path.join(f.root, ".ai-settings-lock.sqlite")], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  await once(child.stdout, "data"); child.kill(); await once(child, "exit");
  const current = await readAiSettings(f.root, f.instanceId);
  const next = await saveAiSettings({ ...f, expectedRevision: 1, operationId: randomUUID(), keyAction: "keep", values: current.values });
  assert.equal(next.revision, 2);
});
test("two independent processes import once and conflicting writers cannot overwrite each other", async t => {
  const f = await fixture(t);
  const moduleUrl = new URL("./ai-settings.mjs", import.meta.url).href;
  const run = (script, args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "", err = ""; child.stdout.on("data", chunk => out += chunk); child.stderr.on("data", chunk => err += chunk);
    child.once("error", reject); child.once("close", code => code ? reject(new Error(err)) : resolve(JSON.parse(out)));
  });
  const importing = `import {initializeAiSettings} from ${JSON.stringify(moduleUrl)}; const [root,instanceId,model]=process.argv.slice(1);const x=await initializeAiSettings({root,instanceId,env:{CHAT_MODEL:model}});console.log(JSON.stringify({revision:x.revision,model:x.values.CHAT_MODEL}));`;
  const imports = await Promise.all([run(importing, [f.root, f.instanceId, "first"]), run(importing, [f.root, f.instanceId, "second"])]);
  assert.equal(imports[0].model, imports[1].model); assert.equal(imports[0].revision, 1);
  const writing = `import {readAiSettings,saveAiSettings} from ${JSON.stringify(moduleUrl)}; const [root,instanceId,operationId,model]=process.argv.slice(1);const x=await readAiSettings(root,instanceId);try{const y=await saveAiSettings({root,instanceId,expectedRevision:1,operationId,keyAction:'remove',values:{...x.values,CHAT_MODEL:model}});console.log(JSON.stringify({revision:y.revision}));}catch(e){console.log(JSON.stringify({error:e.code}));}`;
  const writes = await Promise.all([run(writing, [f.root, f.instanceId, randomUUID(), "A"]), run(writing, [f.root, f.instanceId, randomUUID(), "B"])]);
  assert.equal(writes.filter(item => item.revision === 2).length, 1);
  assert.equal(writes.filter(item => item.error === "AI_SETTINGS_CONFLICT").length, 1);
});
test("service can restart with corrupt AI settings without losing basic records or replacing the file", async t => {
  const f = await fixture(t), instance = path.join(f.root, "instance"); await initialize(instance);
  const data = path.join(instance, "data"), root = path.join(instance, "config"); await fs.mkdir(root);
  await fs.writeFile(path.join(root, "ai-settings.json"), "broken-synthetic");
  const env = { ...process.env, ...parseEnv(await fs.readFile(path.join(instance, ".env"), "utf8")), LOG_ROOT: data, AI_SETTINGS_ROOT: root };
  await runService(process.execPath, ["-e", "process.exit(0)"], { env, stdio: "ignore" });
  assert.equal(await fs.readFile(path.join(root, "ai-settings.json"), "utf8"), "broken-synthetic");
  assert.equal(await fs.stat(path.join(data, ".instance-operation.lock")).catch(() => null), null);
  assert.ok((await fs.readdir(data)).some(name => name.endsWith("_学习日志.md")));
});
