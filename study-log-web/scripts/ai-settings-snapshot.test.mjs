import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { initializeAiSettings, readAiSettings, saveAiSettings } from "../../ops/ai-settings.mjs";
import { snapshotAiEnvironment, getChatConfig, getLightChatConfig } from "../lib/ai-config.ts";
import { summarizeAiSettings } from "../lib/ai-settings-reader.ts";

test("operations use a single committed revision and missing configured storage fails closed", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "study-ai-snapshot-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, "config"), data = path.join(root, "data");
  await fs.mkdir(config); await fs.mkdir(data);
  const instanceId = randomUUID(); await fs.writeFile(path.join(data, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: instanceId }));
  const initial = { CHAT_API_URL: "https://old.invalid/chat?token=synthetic-private-query", CHAT_MODEL: "old-main", CHAT_LIGHT_MODEL: "old-light", CHAT_API_KEY: "old-key", RAG_AGENT_TOOL_CALLING_VERIFIED: "true" };
  await initializeAiSettings({ root: config, instanceId, env: initial });
  const base = { ...initial, LOG_ROOT: data, AI_SETTINGS_ROOT: config };
  const old = snapshotAiEnvironment(base), oldMain = getChatConfig(old), oldLight = getLightChatConfig(old);
  const summary = summarizeAiSettings(instanceId, base), text = JSON.stringify(summary);
  assert.equal(summary.endpointDisplay, "https://old.invalid"); assert.equal(summary.revision, 1);
  assert.ok(!text.includes("synthetic-private-query") && !text.includes("old-key") && !text.includes("/chat"));
  const legacy = summarizeAiSettings(instanceId, { ...base, AI_SETTINGS_ROOT: undefined });
  assert.equal(legacy.source, "deployment"); assert.equal(legacy.revision, null); assert.ok(!JSON.stringify(legacy).includes("synthetic-private-query"));
  const current = await readAiSettings(config, instanceId);
  await saveAiSettings({ root: config, instanceId, expectedRevision: 1, operationId: randomUUID(), keyAction: "replace",
    values: { ...current.values, CHAT_API_URL: "https://new.invalid/chat", CHAT_MODEL: "new-main", CHAT_LIGHT_MODEL: "new-light", CHAT_API_KEY: "new-key" } });
  const next = snapshotAiEnvironment(base);
  assert.equal(oldMain.baseUrl, "https://old.invalid/chat?token=synthetic-private-query"); assert.equal(oldMain.apiKey, "old-key"); assert.equal(oldLight.model, "old-light");
  assert.equal(getChatConfig(next).baseUrl, "https://new.invalid/chat"); assert.equal(getLightChatConfig(next).model, "new-light");
  assert.equal(old.RAG_AGENT_TOOL_CALLING_VERIFIED, "true"); assert.equal(next.RAG_AGENT_TOOL_CALLING_VERIFIED, "false");
  await fs.writeFile(path.join(config, "ai-settings.json"), "not-json");
  assert.throws(() => snapshotAiEnvironment(base));
  assert.throws(() => summarizeAiSettings(instanceId, base));
  assert.throws(() => snapshotAiEnvironment({ ...base, AI_SETTINGS_ROOT: path.join(root, "missing") }));
  assert.equal(snapshotAiEnvironment({ ...base, AI_SETTINGS_ROOT: undefined }).CHAT_MODEL, "old-main");
});
