import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseEnv } from "node:util";
import { initialize, withInstanceLock, upgradeDefaultPrompts } from "./instance.mjs";
import { runService } from "./service.mjs";
import { backupInstance, restoreInstance } from "./archive.mjs";
const old = await fs.readFile(new URL("./fixtures/highlighting-rc5.md", import.meta.url));
const next = await fs.readFile(new URL("../prompts/highlighting.md", import.meta.url));
const oldExtraction = await fs.readFile(new URL("./fixtures/extraction-rc5.md", import.meta.url));
const nextExtraction = await fs.readFile(new URL("../prompts/extraction.md", import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "study-prompt-upgrade-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^study-prompt-upgrade-/); await fs.rm(root, { recursive: true, force: true }); });
  const instance = path.join(root, "instance"); await initialize(instance);
  const data = path.join(instance, "data"), file = path.join(data, "prompts/highlighting.md"), history = path.join(data, "prompts/.default-upgrades");
  return { root, instance, data, file, history, run: () => withInstanceLock(data, async () => (await upgradeDefaultPrompts(data))[0]) };
}
for (const newline of ["LF", "CRLF"]) test(`extraction ${newline} upgrade preserves its original and runs independently of a custom highlighting template`, async t => {
  const f = await fixture(t), file = path.join(f.data, "prompts/extraction.md");
  const bytes = newline === "LF" ? oldExtraction : Buffer.from(oldExtraction.toString().replaceAll("\n", "\r\n"));
  await fs.writeFile(file, bytes); await fs.writeFile(f.file, "custom highlighting");
  const run = () => withInstanceLock(f.data, () => upgradeDefaultPrompts(f.data));
  const results = await run();
  assert.deepEqual(results.map(r => r.status), ["skipped", "updated"]);
  assert.deepEqual(await fs.readFile(file), nextExtraction);
  assert.equal(await fs.readFile(f.file, "utf8"), "custom highlighting");
  const backup = (await fs.readdir(f.history)).find(n => /^extraction-.*\.md$/.test(n));
  assert.deepEqual(await fs.readFile(path.join(f.history, backup)), bytes);
  const stat = await fs.stat(file); assert.equal((await run())[1].status, "current");
  assert.equal((await fs.stat(file)).mtimeMs, stat.mtimeMs);
  const custom = Buffer.concat([oldExtraction, Buffer.from(" ")]);
  await fs.writeFile(file, custom); assert.equal((await run())[1].status, "skipped");
  assert.deepEqual(await fs.readFile(file), custom);
});

test("extraction replacement failure preserves old bytes; normal initialization retries and backup restores the result", async t => {
  const f = await fixture(t), file = path.join(f.data, "prompts/extraction.md");
  await fs.writeFile(file, oldExtraction);
  const rename = fs.rename;
  fs.rename = async (from, to) => { if (to === file) throw new Error("synthetic failure"); return rename(from, to); };
  try {
    const results = await withInstanceLock(f.data, () => upgradeDefaultPrompts(f.data));
    assert.equal(results[1].status, "failed");
  } finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(file), oldExtraction);
  await initialize(f.instance); assert.deepEqual(await fs.readFile(file), nextExtraction);
  await backupInstance(f.instance, path.join(f.root, "extraction.slarchive"));
  await restoreInstance(path.join(f.root, "extraction.slarchive"), path.join(f.root, "restored"));
  assert.deepEqual(await fs.readFile(path.join(f.root, "restored/data/prompts/extraction.md")), nextExtraction);
});
for (const newline of ["LF", "CRLF"]) test(`exact published ${newline} default upgrades with byte-identical backup and is idempotent`, async t => {
  const f = await fixture(t), bytes = newline === "LF" ? old : Buffer.from(old.toString().replaceAll("\n", "\r\n"));
  await fs.writeFile(f.file, bytes);
  assert.equal((await f.run()).status, "updated"); assert.deepEqual(await fs.readFile(f.file), next);
  const names = await fs.readdir(f.history); assert.equal(names.length, 2);
  assert.deepEqual(await fs.readFile(path.join(f.history, names.find(n => n.endsWith(".md")))), bytes);
  const report = await fs.readFile(path.join(f.history, "status.json"));
  const stat = await fs.stat(f.file);
  assert.equal((await f.run()).status, "current"); assert.equal((await fs.stat(f.file)).mtimeMs, stat.mtimeMs);
  assert.deepEqual(await fs.readFile(path.join(f.history, "status.json")), report);
});
test("custom or unknown bytes, generation and personal presets stay untouched", async t => {
  const f = await fixture(t), custom = Buffer.concat([old, Buffer.from(" ")]);
  await fs.writeFile(f.file, custom);
  const generation = path.join(f.data, "prompts/generation.md"), presets = path.join(f.data, "prompts/generation-presets.json");
  await fs.writeFile(generation, "personal generation"); await fs.writeFile(presets, "personal presets");
  assert.equal((await f.run()).status, "skipped"); await initialize(f.instance);
  assert.deepEqual(await fs.readFile(f.file), custom);
  assert.equal(await fs.readFile(generation, "utf8"), "personal generation"); assert.equal(await fs.readFile(presets, "utf8"), "personal presets");
  const report = await fs.readFile(path.join(f.history, "status.json"), "utf8"); assert.ok(!report.includes("personal")); assert.ok(!report.includes(f.instance));
});
test("backup failure keeps old default and does not throw", async t => {
  const f = await fixture(t); await fs.writeFile(f.file, old); await fs.writeFile(f.history, "blocked");
  assert.equal((await f.run()).status, "failed"); assert.deepEqual(await fs.readFile(f.file), old);
  const marker = path.join(f.data, "synthetic-basic-write.txt");
  const env = { ...process.env, ...parseEnv(await fs.readFile(path.join(f.instance, ".env"), "utf8")), LOG_ROOT: f.data };
  await runService(process.execPath, ["--input-type=module", "-e", "import fs from 'node:fs';fs.writeFileSync(process.argv[1],'basic recording still works');", marker], { env, stdio: "ignore" });
  assert.equal(await fs.readFile(marker, "utf8"), "basic recording still works");
  assert.deepEqual(await fs.readFile(f.file), old);
});
test("replacement failure keeps old bytes and a usable backup, later retry succeeds", async t => {
  const f = await fixture(t); await fs.writeFile(f.file, old);
  const original = fs.rename;
  fs.rename = async (from, to) => { if (to === f.file) throw Object.assign(new Error("synthetic failure"), { code: "EACCES" }); return original(from, to); };
  try { assert.equal((await f.run()).status, "failed"); } finally { fs.rename = original; }
  assert.deepEqual(await fs.readFile(f.file), old); assert.ok(!(await fs.readdir(path.dirname(f.file))).some(n => n.endsWith(".tmp")));
  assert.equal((await f.run()).status, "updated");
});
test("unsafe template directory is not read or rewritten", async t => {
  const f = await fixture(t); const directory = path.join(f.data, "prompts"), target = path.join(f.root, "external");
  await fs.rename(directory, target); await fs.writeFile(path.join(target, "highlighting.md"), old);
  await fs.symlink(target, directory, process.platform === "win32" ? "junction" : "dir");
  assert.equal((await f.run()).status, "failed"); assert.deepEqual(await fs.readFile(path.join(target, "highlighting.md")), old);
  assert.ok(!(await fs.readdir(target)).includes(".default-upgrades"));
});
test("missing and oversized templates are preserved and produce bounded diagnostics", async t => {
  const f = await fixture(t); await fs.unlink(f.file); assert.equal((await f.run()).status, "failed");
  await assert.rejects(fs.stat(f.file), { code: "ENOENT" });
  const bytes = Buffer.alloc(65537, 65); await fs.writeFile(f.file, bytes); assert.equal((await f.run()).status, "failed"); assert.deepEqual(await fs.readFile(f.file), bytes);
});
test("real service entry upgrades under lock before the child starts; backup restores template evidence", async t => {
  const f = await fixture(t); await fs.writeFile(f.file, old);
  const env = { ...process.env, ...parseEnv(await fs.readFile(path.join(f.instance, ".env"), "utf8")), LOG_ROOT: f.data };
  await runService(process.execPath, ["--input-type=module", "-e", `import fs from 'node:fs';import assert from 'node:assert/strict';assert.equal(fs.readFileSync(process.argv[1],'utf8'),process.argv[2]);assert.ok(fs.existsSync(process.argv[3]));`, f.file, next.toString(), path.join(f.data, ".instance-operation.lock")], { env, stdio: "ignore" });
  await backupInstance(f.instance, path.join(f.root, "test.slarchive")); await restoreInstance(path.join(f.root, "test.slarchive"), path.join(f.root, "restored"));
  assert.deepEqual(await fs.readFile(path.join(f.root, "restored/data/prompts/highlighting.md")), next);
  assert.deepEqual(await fs.readdir(path.join(f.root, "restored/data/prompts/.default-upgrades")), await fs.readdir(f.history));
});
test("initialization upgrades known defaults without changing credentials", async t => {
  const f = await fixture(t), credentials = await fs.readFile(path.join(f.instance, ".env"));
  await fs.writeFile(f.file, old); await initialize(f.instance);
  assert.deepEqual(await fs.readFile(f.file), next); assert.deepEqual(await fs.readFile(path.join(f.instance, ".env")), credentials);
});
