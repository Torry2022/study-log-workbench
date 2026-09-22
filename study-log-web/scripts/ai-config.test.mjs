import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getChatConfig, getLightChatConfig, inspectChatConfig, ChatConfigurationError } from "../lib/ai-config.ts";
import { readWritingPrompt, inspectWritingPrompts, WritingPromptError, MAX_WRITING_PROMPT_BYTES } from "../lib/ai-prompts.ts";

const valid = { CHAT_API_KEY: "synthetic-header-value", CHAT_API_URL: "https://provider.invalid/v1/chat/completions", CHAT_MODEL: "synthetic-model" };

test("all three explicit settings are required; legacy provider variables never enable AI", () => {
  assert.equal(inspectChatConfig({}).configured, false);
  assert.deepEqual(inspectChatConfig({ DEEPSEEK_API_KEY: "synthetic", DEEPSEEK_MODEL: "synthetic" }).issues.map(x => x.field), ["CHAT_API_KEY", "CHAT_API_URL", "CHAT_MODEL"]);
  for (const field of Object.keys(valid)) {
    const config = { ...valid, [field]: "  " };
    assert.equal(inspectChatConfig(config).configured, false);
    assert.throws(() => getChatConfig(config), ChatConfigurationError);
  }
  assert.deepEqual(getChatConfig(valid), { apiKey: valid.CHAT_API_KEY, model: valid.CHAT_MODEL, baseUrl: valid.CHAT_API_URL });
  assert.equal(getLightChatConfig(valid).model, valid.CHAT_MODEL);
  assert.equal(getLightChatConfig({ ...valid, CHAT_LIGHT_MODEL: " custom-light " }).model, "custom-light");
});

test("complete URLs are preserved, HTTP proxies are explicit choices, and validation never probes network", () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("unexpected network request"); };
  try {
    for (const endpoint of [valid.CHAT_API_URL, "http://127.0.0.1:9999/custom/completions", "http://proxy.invalid/chat/completions", "https://proxy.invalid/complete?api-version=2026-01"]) {
      assert.equal(getChatConfig({ ...valid, CHAT_API_URL: endpoint }).baseUrl, endpoint);
      assert.equal(inspectChatConfig({ ...valid, CHAT_API_URL: endpoint }).configured, true);
    }
  } finally { globalThis.fetch = savedFetch; }
});

test("invalid URLs, header characters and model controls fail with diagnostics that contain no configuration values", () => {
  for (const endpoint of ["/v1/chat/completions", "https:provider.invalid", "ftp://provider.invalid/chat", "https://user:secret@provider.invalid/chat", "https://provider.invalid/chat#", "https://provider.invalid/chat#secret", "https://provider.invalid/space here", "https://provider.invalid/line\nbreak", "https:\\provider.invalid/chat"]) {
    const inspected = inspectChatConfig({ ...valid, CHAT_API_URL: endpoint });
    assert.equal(inspected.configured, false, endpoint);
    assert.ok(inspected.issues.some(issue => issue.field === "CHAT_API_URL" && issue.reason === "invalid"));
    assert.ok(!JSON.stringify(inspected).includes(endpoint));
  }
  for (const bad of [{ CHAT_API_KEY: "private\r\nvalue" }, { CHAT_API_KEY: "private value" }, { CHAT_MODEL: "private\nmodel" }, { CHAT_LIGHT_MODEL: "private\nlight" }]) {
    assert.throws(() => getChatConfig({ ...valid, ...bad }), error => {
      assert.equal(error.code, "AI_CONFIGURATION_INVALID");
      assert.ok(!JSON.stringify(error).includes("private"));
      assert.ok(!error.message.includes(valid.CHAT_API_KEY));
      return true;
    });
  }
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-ai-config-"));
  const data = path.join(root, "data");
  const prompts = path.join(data, "prompts");
  await fs.mkdir(prompts, { recursive: true });
  const oldRoot = process.env.LOG_ROOT;
  process.env.LOG_ROOT = data;
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = oldRoot;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-ai-config-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, data, prompts, file: path.join(prompts, "generation.md") };
}

test("templates are independent and re-read edits; readiness does not require a configured provider", async t => {
  const { prompts, file } = await fixture(t);
  await fs.writeFile(file, "\uFEFF  synthetic generation\n");
  await fs.writeFile(path.join(prompts, "highlighting.md"), "  \n ");
  assert.equal(await readWritingPrompt("generation"), "synthetic generation");
  const state = await inspectWritingPrompts();
  assert.deepEqual(state.generation, { configured: true });
  assert.equal(state.highlighting.issue.reason, "empty");
  assert.equal(state.extraction.issue.reason, "missing");
  await fs.writeFile(file, "edited synthetic template");
  assert.equal(await readWritingPrompt("generation"), "edited synthetic template");
  await assert.rejects(readWritingPrompt("../outside"), /未知/);
});

test("64 KiB boundary, invalid UTF-8 and empty templates report precise safe failures", async t => {
  const { file, data } = await fixture(t);
  await fs.writeFile(file, "a".repeat(MAX_WRITING_PROMPT_BYTES));
  assert.equal((await readWritingPrompt("generation")).length, MAX_WRITING_PROMPT_BYTES);
  for (const [bytes, reason] of [[Buffer.alloc(MAX_WRITING_PROMPT_BYTES + 1, 65), "too_large"], [Buffer.from([0xc3, 0x28]), "invalid_utf8"], [Buffer.from("\uFEFF \n"), "empty"]]) {
    await fs.writeFile(file, bytes);
    await assert.rejects(readWritingPrompt("generation"), error => {
      assert.ok(error instanceof WritingPromptError);
      assert.equal(error.reason, reason);
      assert.ok(!error.message.includes(data));
      return true;
    });
  }
});

test("missing or invalid instance roots never fall back to the repository or private Skill", async t => {
  const { root } = await fixture(t);
  for (const configuredRoot of [undefined, "relative/data"]) {
    if (configuredRoot === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = configuredRoot;
    assert.equal((await inspectWritingPrompts()).generation.issue.reason, "invalid_root");
  }
  process.env.LOG_ROOT = path.join(root, "absent-data");
  await assert.rejects(readWritingPrompt("generation"), error => error.reason === "missing");
});

test("data root, prompt directory and ancestor junctions cannot read another instance's templates", async t => {
  const { root, data, prompts } = await fixture(t);
  const outside = path.join(root, "other-instance");
  await fs.mkdir(path.join(outside, "prompts"), { recursive: true });
  await fs.writeFile(path.join(outside, "prompts", "generation.md"), "must not be consumed");
  const linkedData = path.join(root, "linked-data");
  await fs.symlink(outside, linkedData, process.platform === "win32" ? "junction" : "dir");
  process.env.LOG_ROOT = linkedData;
  await assert.rejects(readWritingPrompt("generation"), error => error.reason === "unsafe_path");
  const ancestor = path.join(root, "linked-ancestor");
  await fs.symlink(root, ancestor, process.platform === "win32" ? "junction" : "dir");
  process.env.LOG_ROOT = path.join(ancestor, "other-instance");
  await assert.rejects(readWritingPrompt("generation"), error => error.reason === "unsafe_path");
  process.env.LOG_ROOT = data;
  await fs.rmdir(prompts);
  await fs.symlink(path.join(outside, "prompts"), prompts, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(readWritingPrompt("generation"), error => error.reason === "unsafe_path");
});

test("a template must be a regular file, never a directory or file symlink", async t => {
  const { root, file } = await fixture(t);
  await fs.mkdir(file);
  await assert.rejects(readWritingPrompt("generation"), error => error.reason === "unsafe_path");
  await fs.rmdir(file);
  const target = path.join(root, "private-template.md");
  await fs.writeFile(target, "must not be consumed");
  try { await fs.symlink(target, file, "file"); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") { t.skip("Windows does not permit file symlinks; directory junction boundaries were tested separately"); return; }
    throw error;
  }
  await assert.rejects(readWritingPrompt("generation"), error => error.reason === "unsafe_path");
});
