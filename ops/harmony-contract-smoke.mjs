import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

const [rootA, baseA, rootB, baseB] = process.argv.slice(2);
for (const [root, base] of [[rootA, baseA], [rootB, baseB]]) {
  assert.ok(root && path.isAbsolute(root), "Provide two explicit synthetic instance roots");
  const url = new URL(base);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only local test servers are allowed");
  assert.equal(url.pathname, "/study-log");
}

async function connect(root, base) {
  const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  const login = await fetch(`${base}/api/auth/app-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: env.APP_PASSWORD })
  });
  assert.equal(login.status, 200);
  const { token, expiresAt } = await login.json();
  assert.ok(token && Date.parse(expiresAt) > Date.now());
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`${base}/api/capabilities`, { headers });
  assert.equal(response.status, 200);
  const capabilities = await response.json();
  assert.equal(capabilities.apiContractVersion, 1);
  const identity = JSON.parse(await fs.readFile(path.join(root, "data/.instance.json"), "utf8"));
  assert.equal(capabilities.instanceId, identity.id);
  for (const name of ["aiWriting", "aiHighlighting", "aiNoteExtraction", "aiTaxonomy", "rag"]) {
    assert.deepEqual(capabilities.features[name], { supported: true, configured: false });
  }
  assert.equal((await fetch(`${base}/api/logs/months`, { headers })).status, 200);
  return { token, capabilities };
}

const a = await connect(rootA, baseA);
const b = await connect(rootB, baseB);
assert.notEqual(a.capabilities.instanceId, b.capabilities.instanceId);
assert.equal((await fetch(`${baseB}/api/capabilities`, { headers: { Authorization: `Bearer ${a.token}` } })).status, 401);
assert.equal((await fetch(`${baseA}/api/capabilities`, { headers: { Authorization: `Bearer ${b.token}` } })).status, 401);
console.log("Harmony app-login, capabilities, empty-instance reading and A/B token isolation passed");
