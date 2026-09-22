import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initialize, acquireInstanceLock } from "./instance.mjs";
import { backupInstance, restoreInstance, verifyArchive, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES, MAX_MANIFEST_BYTES } from "./archive.mjs";

const magic = Buffer.from("STUDY-LOG-INSTANCE\0V1\n");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-archive-test-"));
  t.after(async () => {
    assert.equal(path.dirname(base), path.resolve(os.tmpdir())); assert.ok(path.basename(base).startsWith("workbench-archive-test-"));
    await fs.rm(base, { recursive: true, force: true });
  });
  const root = path.join(base, "source"), archive = path.join(base, "snapshot.slwb"); await initialize(root);
  await fs.mkdir(path.join(root, "data", "assets"));
  await fs.mkdir(path.join(root, "data", "assets", "empty"));
  await fs.mkdir(path.join(root, "data", "随记"));
  await fs.mkdir(path.join(root, "backups", "notes"));
  const files = {
    ".env.mcp": "MCP_HTTP_TOKEN=synthetic-backup-mcp-token\nEMBEDDING_API_KEY=\nRERANK_API_KEY=\n",
    "data/2025_学习日志.md": "## 2025-12-31\r\n\r\n### 合成主题\r\n保留年文件与 CRLF。\r\n",
    "data/2026-08_学习日志.md": "## 2026-08-01\n\n### 第二主题\n保持原文字节。\n",
    "data/assets/image.bin": Buffer.from([0, 1, 255, 13, 10, 32]),
    "data/随记/2026_随记.md": "## 2026-08-01 10:00\n\n合成随记\n",
    "data/.study-log-favorites.json": '{"headings":[],"groups":[]}\n',
    "data/.study-log-taxonomy.json": '{"domains":["其他"],"mappings":{}}\n',
    "data/.study-log-rag-sessions.json": '{"sessions":[]}\n',
    "data/随记/.pending-write.json": '{"entries":[{"year":"2026","backup":"synthetic.md"}]}\n',
    "backups/notes/synthetic.md": "合成写前版本\n",
    "backups/synthetic-log.md": "合成旧日志\n"
  };
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(root, ...name.split("/")), bytes);
  await fs.writeFile(path.join(root, "index", "derived.json"), "not archived");
  await fs.writeFile(path.join(root, "unrelated-report.txt"), "not instance data");
  return { base, root, archive, files, target: path.join(base, "restored") };
}
async function tree(directory) {
  const result = {};
  async function walk(relative) {
    for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { result[name] = "directory"; await walk(name); }
      else result[name] = (await fs.readFile(path.join(directory, name))).toString("base64");
    }
  }
  await walk(""); return result;
}
async function alter(archive, edit) {
  const raw = await fs.readFile(archive), length = raw.readUInt32BE(magic.length);
  const manifest = JSON.parse(raw.subarray(magic.length + 4, magic.length + 4 + length).toString());
  const data = raw.subarray(magic.length + 4 + length);
  const changed = edit(manifest, data), content = Buffer.from(JSON.stringify(manifest));
  const prefix = Buffer.alloc(magic.length + 4); magic.copy(prefix); prefix.writeUInt32BE(content.length, magic.length);
  const bytes = changed || Buffer.concat([prefix, content, data]);
  const target = `${archive}.${crypto.randomUUID()}.bad`;
  await fs.writeFile(target, bytes); await fs.writeFile(`${target}.sha256`, `${sha(bytes)}\n`);
  return target;
}

test("full offline round trip preserves identity, credentials, templates, state, binary files and backups byte for byte", async t => {
  const { root, archive, target } = await fixture(t), before = await tree(root);
  const backed = await backupInstance(root, archive); assert.equal(backed.sha256, sha(await fs.readFile(archive)));
  assert.deepEqual(await tree(root), before);
  const verified = await verifyArchive(archive);
  assert.ok(verified.manifest.entries.some(entry => entry.path === "backups/notes/synthetic.md"));
  assert.ok(!verified.manifest.entries.some(entry => /index|unrelated-report|instance-operation/.test(entry.path)));
  const restored = await restoreInstance(archive, target); assert.equal(restored.instanceId, backed.instanceId);
  for (const [name, value] of Object.entries(before)) {
    if (name === "index/derived.json" || name === "unrelated-report.txt") continue;
    assert.equal((await tree(target))[name], value, name);
  }
  assert.deepEqual(await fs.readdir(path.join(target, "index")), []);
  await assert.rejects(fs.stat(path.join(target, "data", ".instance-operation.lock")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(target, ".restore-incomplete.json")), { code: "ENOENT" });
  const owner = await acquireInstanceLock(path.join(target, "data"), "test-after-restore"); await owner();
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(target, ".env"))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o700);
  }
});

test("backup refuses a live instance, existing outputs and outputs inside the instance", async t => {
  const { root, archive } = await fixture(t);
  const release = await acquireInstanceLock(path.join(root, "data"), "web-service");
  try { await assert.rejects(backupInstance(root, archive), /运行|维护/); } finally { await release(); }
  await assert.rejects(fs.stat(archive), { code: "ENOENT" });
  await assert.rejects(backupInstance(root, path.join(root, "backups", "inside.slwb")), { code: "ARCHIVE_PATH_INVALID" });
  await backupInstance(root, archive); const bytes = await fs.readFile(archive);
  await assert.rejects(backupInstance(root, archive), { code: "ARCHIVE_EXISTS" }); assert.deepEqual(await fs.readFile(archive), bytes);
  await fs.writeFile(`${archive}.new.sha256`, "preserve");
  await assert.rejects(backupInstance(root, `${archive}.new`), { code: "ARCHIVE_EXISTS" });
  await assert.rejects(backupInstance("relative", archive), { code: "ARCHIVE_PATH_INVALID" });
});

test("restore refuses existing even empty targets and concurrent restores cannot overwrite each other", async t => {
  const { root, archive, target, base } = await fixture(t); await backupInstance(root, archive);
  await fs.mkdir(target); await assert.rejects(restoreInstance(archive, target), { code: "RESTORE_TARGET_EXISTS" });
  assert.deepEqual(await fs.readdir(target), []);
  const next = path.join(base, "concurrent");
  const results = await Promise.allSettled([restoreInstance(archive, next), restoreInstance(archive, next)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, "RESTORE_TARGET_EXISTS");
  assert.deepEqual(await fs.readFile(path.join(next, ".env")), await fs.readFile(path.join(root, ".env")));
});

test("bad external digest, content corruption and altered per-file manifest fail before reserving a target", async t => {
  const { root, archive, target } = await fixture(t); await backupInstance(root, archive);
  await fs.writeFile(`${archive}.sha256`, `${"0".repeat(64)}\n`);
  await assert.rejects(restoreInstance(archive, target), { code: "ARCHIVE_DIGEST_MISMATCH" });
  await fs.writeFile(`${archive}.sha256`, `${sha(await fs.readFile(archive))}\n`);
  const altered = await alter(archive, manifest => { manifest.entries.find(entry => entry.type === "file").sha256 = "0".repeat(64); });
  await assert.rejects(restoreInstance(altered, target), { code: "ARCHIVE_FILE_MISMATCH" });
  const corrupt = await alter(archive, (_manifest, data) => { data[data.length - 1] ^= 1; });
  await assert.rejects(restoreInstance(corrupt, target), { code: "ARCHIVE_FILE_MISMATCH" });
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
});

test("archive paths reject traversal, Windows aliases, canonical Unicode aliases, links and case collisions", async t => {
  const { root, archive, target } = await fixture(t); await backupInstance(root, archive);
  for (const name of ["../outside", "/absolute", "C:/absolute", "data/../outside", "data/a\\b", "data/a:b", "data/CON.txt", "data/name.", "data/name ", "data/LONGNA~1", "data/e\u0301", "data/.instance-operation.lock/owner.json", "index/derived"]) {
    const altered = await alter(archive, manifest => { manifest.entries.push({ path: name, type: "directory" }); });
    await assert.rejects(restoreInstance(altered, target), { code: "ARCHIVE_PATH_INVALID" }, name);
  }
  const collision = await alter(archive, manifest => { manifest.entries.push({ path: "data/ASSETS", type: "directory" }); });
  await assert.rejects(restoreInstance(collision, target), { code: "ARCHIVE_PATH_INVALID" });
  const unicodeCase = await alter(archive, manifest => { manifest.entries.push({ path: "data/I", type: "directory" }, { path: "data/ı", type: "directory" }); });
  await assert.rejects(restoreInstance(unicodeCase, target), { code: "ARCHIVE_PATH_INVALID" });
  const symbolic = await alter(archive, manifest => { manifest.entries.push({ path: "data/symbolic", type: "symlink", target: "outside" }); });
  await assert.rejects(restoreInstance(symbolic, target), { code: "ARCHIVE_INVALID" });
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
});

test("resource limits are checked from the format before extracting any file", async t => {
  const { root, archive, target } = await fixture(t); await backupInstance(root, archive);
  const huge = await alter(archive, manifest => { manifest.entries.find(entry => entry.type === "file").size = MAX_ARCHIVE_BYTES + 1; });
  await assert.rejects(restoreInstance(huge, target), { code: "ARCHIVE_LIMIT" });
  const many = await alter(archive, manifest => { manifest.entries = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, () => ({ path: "data", type: "directory" })); });
  await assert.rejects(restoreInstance(many, target), { code: "ARCHIVE_LIMIT" });
  const header = await alter(archive, (_manifest, _data) => { const buffer = Buffer.alloc(magic.length + 4); magic.copy(buffer); buffer.writeUInt32BE(MAX_MANIFEST_BYTES + 1, magic.length); return buffer; });
  await assert.rejects(restoreInstance(header, target), { code: "ARCHIVE_LIMIT" });
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
});

test("source junctions, hardlinked files and linked output parents are rejected", async t => {
  const { root, archive, base } = await fixture(t);
  const external = path.join(base, "other"); await fs.mkdir(external); await fs.writeFile(path.join(external, "keep"), "untouched");
  const link = path.join(root, "data", "linked"); await fs.symlink(external, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(backupInstance(root, archive), { code: "ARCHIVE_UNSAFE_FILE" });
  await fs.unlink(link);
  await fs.link(path.join(root, ".env"), path.join(root, "data", "credential-alias"));
  await assert.rejects(backupInstance(root, archive), { code: "ARCHIVE_UNSAFE_FILE" });
  await fs.unlink(path.join(root, "data", "credential-alias"));
  const outputAlias = path.join(base, "output-alias"); await fs.symlink(external, outputAlias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(backupInstance(root, path.join(outputAlias, "archive")), { code: "ARCHIVE_UNSAFE_FILE" });
  assert.equal(await fs.readFile(path.join(external, "keep"), "utf8"), "untouched");
});

test("restore read source and target ancestors reject links without following them", async t => {
  const { root, archive, target, base } = await fixture(t); await backupInstance(root, archive);
  const alias = path.join(base, "hardlinked-archive"); await fs.link(archive, alias);
  await assert.rejects(restoreInstance(archive, target), { code: "ARCHIVE_UNSAFE_FILE" }); await fs.unlink(alias);
  const elsewhere = path.join(base, "elsewhere"); await fs.mkdir(elsewhere);
  const parent = path.join(base, "alias-parent"); await fs.symlink(elsewhere, parent, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(restoreInstance(archive, path.join(parent, "new")), { code: "ARCHIVE_UNSAFE_FILE" });
  assert.deepEqual(await fs.readdir(elsewhere), []);
});

test("copy failure retains partial target, marker and owned lock; retries require another new target", async t => {
  const { root, archive, target, base } = await fixture(t); await backupInstance(root, archive);
  const originalOpen = fs.open;
  fs.open = async function(file, ...args) {
    if (file === path.join(target, "data", "2025_学习日志.md")) throw Object.assign(new Error("synthetic disk error"), { code: "EIO" });
    return originalOpen.call(this, file, ...args);
  };
  try { await assert.rejects(restoreInstance(archive, target), { code: "RESTORE_INCOMPLETE" }); } finally { fs.open = originalOpen; }
  assert.deepEqual(await fs.readFile(path.join(target, ".env")), await fs.readFile(path.join(root, ".env")));
  assert.equal(JSON.parse(await fs.readFile(path.join(target, "data/.instance-operation.lock/owner.json"))).operation, "instance-restore");
  assert.ok(await fs.stat(path.join(target, ".restore-incomplete.json")));
  await assert.rejects(acquireInstanceLock(path.join(target, "data")), /运行|维护/);
  await assert.rejects(restoreInstance(archive, target), { code: "RESTORE_TARGET_EXISTS" });
  await restoreInstance(archive, path.join(base, "retry-new"));
});

test("publication failure retains partial evidence and never overwrites an existing archive", async t => {
  const { root, archive, base } = await fixture(t), originalLink = fs.link;
  fs.link = async function(source, destination) { if (destination === archive) throw Object.assign(new Error("synthetic publish failure"), { code: "EIO" }); return originalLink.call(this, source, destination); };
  try { await assert.rejects(backupInstance(root, archive), { code: "ARCHIVE_BACKUP_FAILED" }); } finally { fs.link = originalLink; }
  await assert.rejects(fs.stat(archive), { code: "ENOENT" });
  assert.ok((await fs.readdir(base)).some(name => name.endsWith(".partial")));
  assert.ok(await fs.stat(`${archive}.sha256`));
  const release = await acquireInstanceLock(path.join(root, "data")); await release();
});

test("CLI verifies and restores a real archive without printing configuration values", async t => {
  const { root, archive, target } = await fixture(t), script = fileURLToPath(new URL("./archive-cli.mjs", import.meta.url));
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000 });
  const env = await fs.readFile(path.join(root, ".env"), "utf8"), password = env.match(/^APP_PASSWORD=(.+)$/m)[1];
  for (const args of [["backup", root, archive], ["verify", archive], ["restore", archive, target]]) {
    const result = run(args); assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
  }
  const repeat = run(["restore", archive, target]); assert.equal(repeat.status, 1); assert.match(repeat.stderr, /RESTORE_TARGET_EXISTS/);
});

test("newly initialized instances need no optional MCP environment file to round trip", async t => {
  const { base } = await fixture(t), root = path.join(base, "minimal"), archive = path.join(base, "minimal.slwb"), target = path.join(base, "minimal-restored");
  await initialize(root); await backupInstance(root, archive); await restoreInstance(archive, target);
  assert.deepEqual(await tree(root), await tree(target));
});

test("external source changes between manifest scan and payload write prevent publication", async t => {
  const { root, archive } = await fixture(t), originalOpen = fs.open;
  let changed = false;
  fs.open = async function(file, ...args) {
    if (!changed && String(file).startsWith(archive) && String(file).endsWith(".partial")) {
      changed = true; await fs.appendFile(path.join(root, "data", "2025_学习日志.md"), "external synthetic edit");
    }
    return originalOpen.call(this, file, ...args);
  };
  try { await assert.rejects(backupInstance(root, archive), { code: "ARCHIVE_SOURCE_CHANGED" }); } finally { fs.open = originalOpen; }
  await assert.rejects(fs.stat(archive), { code: "ENOENT" });
  assert.match(await fs.readFile(path.join(root, "data", "2025_学习日志.md"), "utf8"), /external synthetic edit$/);
  const release = await acquireInstanceLock(path.join(root, "data")); await release();
});
