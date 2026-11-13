import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { parseEnv } from "node:util";
import { initialize } from "./instance.mjs";
import { initializeAiSettings } from "./ai-settings.mjs";

const repo = path.resolve(import.meta.dirname, ".."), evidence = path.join(repo, ".local", `ai-settings-api-${Date.now()}`);
const instance = path.join(evidence, "instance"), data = path.join(instance, "data"), config = path.join(instance, "config");
await fs.mkdir(evidence, { recursive: true }); await initialize(instance); await fs.mkdir(config);
const env = parseEnv(await fs.readFile(path.join(instance, ".env"), "utf8"));
const instanceId = JSON.parse(await fs.readFile(path.join(data, ".instance.json"), "utf8")).id;
await initializeAiSettings({ root: config, instanceId, env: { CHAT_API_URL: "https://provider.invalid/private-path?token=synthetic-query", CHAT_MODEL: "synthetic-model", CHAT_API_KEY: "synthetic-secret" } });
const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, server = spawn(process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: path.join(repo, "study-log-web"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, "backups"), AI_SETTINGS_ROOT: config, NODE_ENV: "production" } });
let output = ""; server.stdout.on("data", value => output += value); server.stderr.on("data", value => output += value);
try {
  for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i > 150 || server.exitCode !== null) throw new Error("Synthetic server failed to start"); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal((await fetch(`${base}/api/settings/ai`)).status, 401);
  const login = await fetch(`${base}/api/auth/app-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: env.APP_PASSWORD }) });
  assert.equal(login.status, 200); const { token } = await login.json(), headers = { Authorization: `Bearer ${token}`, "X-Study-Log-Instance": instanceId };
  const browserLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: env.APP_PASSWORD }) });
  assert.equal(browserLogin.status, 200); const cookie = browserLogin.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
  assert.equal((await fetch(`${base}/api/settings/ai`, { headers: { Cookie: cookie } })).status, 200);
  let response = await fetch(`${base}/api/settings/ai`, { headers }); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  const raw = await response.text(), summary = JSON.parse(raw); assert.equal(summary.instanceId, instanceId); assert.equal(summary.revision, 1); assert.equal(summary.endpointDisplay, "https://provider.invalid"); assert.equal(summary.hasKey, true);
  assert.ok(!raw.includes("synthetic-secret") && !raw.includes("synthetic-query") && !raw.includes("private-path"));
  assert.equal((await fetch(`${base}/api/settings/ai`, { headers: { ...headers, "X-Study-Log-Instance": "00000000-0000-0000-0000-000000000000" } })).status, 409);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await fetch(`${base}/api/settings/ai`, { method, headers })).status, 405);
  response = await fetch(`${base}/api/capabilities`, { headers }); let caps = await response.json();
  assert.equal(caps.settings.ai.readable, true); assert.equal(caps.settings.ai.writable, false); assert.equal(caps.settings.ai.reason, "deployment_managed");
  await fs.writeFile(path.join(config, "ai-settings.json"), "broken-synthetic");
  assert.equal((await fetch(`${base}/api/settings/ai`, { headers })).status, 503);
  response = await fetch(`${base}/api/capabilities`, { headers }); caps = await response.json(); assert.equal(response.status, 200); assert.equal(caps.instanceId, instanceId); assert.equal(caps.settings.ai.readable, false);
  assert.equal((await fetch(`${base}/api/logs/months`, { headers })).status, 200);
  console.log(JSON.stringify({ passed: true, evidence, checks: ["auth and instance binding", "summary redaction", "read-only method", "capability", "corrupt configuration and basic logs"] }));
} finally { server.kill(); await once(server, "exit").catch(() => {}); await fs.writeFile(path.join(evidence, "server.log"), output); }
