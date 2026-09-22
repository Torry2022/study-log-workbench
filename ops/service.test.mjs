import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireInstanceLock, initialize, withInstanceLock } from "./instance.mjs";
import { runService } from "./service.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-service-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-service-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  await initialize(root);
  const data = path.join(root, "data"), environment = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  return { root, data, lock: path.join(data, ".instance-operation.lock"), env: { ...process.env, ...environment, LOG_ROOT: data } };
}
async function waitForFile(file) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { return await fs.readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("Synthetic child did not become ready");
}

test("lock ownership metadata survives conflicts and release never removes another owner's lock", async t => {
  const { data, lock } = await fixture(t);
  const release = await acquireInstanceLock(data, "synthetic-operation");
  const ownerFile = path.join(lock, "owner.json");
  const owner = JSON.parse(await fs.readFile(ownerFile, "utf8"));
  assert.equal(owner.operation, "synthetic-operation"); assert.equal(owner.pid, process.pid);
  await assert.rejects(acquireInstanceLock(data), /运行/);
  await fs.writeFile(ownerFile, JSON.stringify({ ...owner, ownerId: "another-owner" }));
  await assert.rejects(release(), /归属已变化/);
  assert.equal(JSON.parse(await fs.readFile(ownerFile, "utf8")).ownerId, "another-owner");
});

test("normal service exit holds the lock until the child finishes and then permits maintenance", async t => {
  const { root, data, lock, env } = await fixture(t);
  const ready = path.join(root, "ready"), stop = path.join(root, "stop"), completed = path.join(root, "completed");
  const running = runService(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs/promises';
    await fs.writeFile(process.argv[1], 'ready');
    while (!(await fs.stat(process.argv[2]).catch(() => null))) await new Promise(r => setTimeout(r, 20));
    await fs.writeFile(process.argv[3], 'fully-written');
  `, ready, stop, completed], { env, stdio: "ignore" });
  await waitForFile(ready);
  try {
    await assert.rejects(initialize(root), /运行/);
    await assert.rejects(withInstanceLock(data, () => assert.fail("must not run")), /运行/);
    await assert.rejects(runService(process.execPath, ["-e", "process.exit(0)"], { env, stdio: "ignore" }), /运行/);
  } finally { await fs.writeFile(stop, "stop"); }
  await running;
  assert.equal(await fs.readFile(completed, "utf8"), "fully-written");
  await assert.rejects(fs.stat(lock), { code: "ENOENT" });
  await withInstanceLock(data, async () => {});
});

test("a child that never starts releases its lock, but an abnormal exit keeps evidence", async t => {
  const { root, data, lock, env } = await fixture(t);
  await assert.rejects(runService(path.join(root, "missing-executable"), [], { env, stdio: "ignore" }), /未能启动/);
  await withInstanceLock(data, async () => {});
  await assert.rejects(runService(process.execPath, ["-e", "process.exit(7)"], { env, stdio: "ignore" }), /异常停止/);
  assert.equal(JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")).operation, "web-service");
  await assert.rejects(initialize(root), /运行/);
});

test("runtime rejects malformed identity or credentials before taking a lock", async t => {
  const { root, lock, env } = await fixture(t);
  await assert.rejects(runService(process.execPath, ["-e", "process.exit(0)"], { env: { ...env, APP_PASSWORD: "" }, stdio: "ignore" }), /APP_PASSWORD/);
  await fs.writeFile(path.join(root, "data", ".instance.json"), '{"schemaVersion":1,"id":"wrong"}');
  await assert.rejects(runService(process.execPath, ["-e", "process.exit(0)"], { env, stdio: "ignore" }), /身份无效/);
  await assert.rejects(fs.stat(lock), { code: "ENOENT" });
});

test("POSIX SIGTERM waits for a service's asynchronous shutdown before releasing its lock", { skip: process.platform === "win32" ? "Windows termination is abrupt; POSIX signal coverage runs in Linux deployment verification." : false }, async t => {
  const { root, lock, env } = await fixture(t);
  const ready = path.join(root, "ready"), completed = path.join(root, "completed");
  const script = path.join(root, "graceful.mjs");
  await fs.writeFile(script, `import fs from 'node:fs/promises';
    process.on('SIGTERM', async () => { await new Promise(r=>setTimeout(r,80)); await fs.writeFile(process.argv[3], 'done'); process.exit(0); });
    setInterval(()=>{}, 1000); await fs.writeFile(process.argv[2], 'ready');`);
  const child = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), script, ready, completed], { env, stdio: "ignore", windowsHide: true });
  const closed = new Promise(resolve => child.once("close", resolve));
  t.after(() => child.kill("SIGKILL"));
  await waitForFile(ready); child.kill("SIGTERM");
  assert.equal(await closed, 0);
  assert.equal(await fs.readFile(completed, "utf8"), "done");
  await assert.rejects(fs.stat(lock), { code: "ENOENT" });
});
