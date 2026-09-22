import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initialize, withInstanceLock } from "./instance.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-init-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-init-test-"));
    return fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test("two instances have independent credentials and persistent identity", async t => {
  const root = await fixture(t);
  const a = path.join(root, "a"), b = path.join(root, "b");
  await initialize(a); await initialize(b);
  const identity = await fs.readFile(path.join(a, "data/.instance.json"), "utf8");
  const environment = await fs.readFile(path.join(a, ".env"), "utf8");
  assert.notEqual(identity, await fs.readFile(path.join(b, "data/.instance.json"), "utf8"));
  assert.notEqual(environment, await fs.readFile(path.join(b, ".env"), "utf8"));
  await fs.writeFile(path.join(a, "data/2026-01_学习日志.md"), "## 2026-01-15\n\n合成资料\n");
  await initialize(a);
  assert.equal(identity, await fs.readFile(path.join(a, "data/.instance.json"), "utf8"));
  assert.equal(environment, await fs.readFile(path.join(a, ".env"), "utf8"));
  assert.equal(await fs.readFile(path.join(a, "data/2026-01_学习日志.md"), "utf8"), "## 2026-01-15\n\n合成资料\n");
});

test("rejects implicit roots and unrelated nonempty folders without changing them", async t => {
  await assert.rejects(initialize(), /绝对路径/);
  await assert.rejects(initialize("relative"), /绝对路径/);
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "unrelated.txt"), "preserve");
  await assert.rejects(initialize(root), /非空/);
  assert.deepEqual(await fs.readdir(root), ["unrelated.txt"]);
});

test("busy instances refuse initialization and keep their existing lock", async t => {
  const root = await fixture(t);
  await initialize(root);
  await withInstanceLock(path.join(root, "data"), async () => {
    await assert.rejects(initialize(root), /运行/);
    assert.ok((await fs.stat(path.join(root, "data/.instance-operation.lock"))).isDirectory());
  });
  await initialize(root);
});

test("rejects links into another instance", async t => {
  const root = await fixture(t);
  const target = path.join(root, "target");
  await initialize(target);
  const link = path.join(root, "alias");
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(initialize(link), /链接|联接/);
});
