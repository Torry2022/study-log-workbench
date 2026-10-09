import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { initialize, acquireInstanceLock } from "../instance.mjs";
import { desktopOwnership, registerDesktopWorker, recoverDesktopLock } from "./recovery.mjs";
import { DesktopManager } from "./manager.mjs";

const windows = { skip: process.platform !== "win32" };
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-recovery-test-"));
  const root = path.join(base, "instance"), data = path.join(root, "data");
  await initialize(root);
  await fs.writeFile(path.join(data, "2026-10_学习日志.md"), "## 2026-10-09\n\n已保存的合成记录。\n");
  const contents = await fs.readFile(path.join(data, "2026-10_学习日志.md"));
  const desktop = await desktopOwnership(data);
  await acquireInstanceLock(data, "desktop-services", desktop);
  const lock = path.join(data, ".instance-operation.lock"), file = path.join(lock, "owner.json");
  const owner = JSON.parse(await fs.readFile(file, "utf8"));
  // An actual exited process, not a guessed unused PID.
  const child = spawn(process.execPath, ["-e", ""], { windowsHide: true });
  const deadPid = child.pid; await once(child, "exit");
  owner.pid = deadPid;
  const save = () => fs.writeFile(file, JSON.stringify(owner));
  await save();
  t.after(async () => {
    assert.equal(path.dirname(base), path.resolve(os.tmpdir())); assert.match(path.basename(base), /^study-log-recovery-test-/);
    await fs.rm(base, { recursive: true, force: true });
  });
  return { root, data, lock, file, owner, save, contents, base };
}

test("reopening recovers a dead desktop owner, preserves evidence and all saved contents", windows, async t => {
  const f = await fixture(t);
  const manager = new DesktopManager({ packageRoot: path.join(f.base, "package") });
  await manager.select({ root: f.root });
  assert.equal(manager.root, f.root);
  await assert.rejects(fs.stat(f.lock), { code: "ENOENT" });
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, ".desktop-recovery", f.owner.ownerId, "owner.json"))).ownerId, f.owner.ownerId);
  assert.deepEqual(await fs.readFile(path.join(f.data, "2026-10_学习日志.md")), f.contents);
  assert.equal(await recoverDesktopLock(f.data), false);
});

test("previous boot on this machine recovers despite reused PID; current boot live owner does not", windows, async t => {
  const f = await fixture(t);
  f.owner.pid = process.pid; await f.save();
  await assert.rejects(recoverDesktopLock(f.data), /正在使用/);
  f.owner.desktop.boot = "2000-01-01T00:00:00.000Z";
  f.owner.desktop.processStarted = "2000-01-01T01:00:00.000Z";
  f.owner.startedAt = "2000-01-01T01:00:00.000Z"; await f.save();
  assert.equal(await recoverDesktopLock(f.data), true);
});

test("orphan worker still draining blocks recovery until it has exited", windows, async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  t.after(() => child.stdin.end());
  const deadPid = f.owner.pid;
  f.owner.pid = process.pid; await f.save();
  await registerDesktopWorker(f.data, child.pid);
  f.owner.desktop = JSON.parse(await fs.readFile(f.file)).desktop;
  f.owner.pid = deadPid; await f.save();
  await assert.rejects(recoverDesktopLock(f.data), /正在使用/);
  const ended = once(child, "exit"); child.stdin.end(); await ended;
  assert.equal(await recoverDesktopLock(f.data), true);
});

test("unfinished writes block automatic recovery without altering records", windows, async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.data, "随记"));
  await fs.writeFile(path.join(f.data, "随记", ".pending-write.json"), "{}");
  await assert.rejects(recoverDesktopLock(f.data), /保存尚未完成/);
  assert.ok(await fs.stat(f.lock));
  assert.deepEqual(await fs.readFile(path.join(f.data, "2026-10_学习日志.md")), f.contents);
});

test("foreign machine, moved folder, maintenance, and legacy records are not guessed safe", windows, async t => {
  const f = await fixture(t), original = structuredClone(f.owner);
  for (const alter of [o => { o.desktop.host = "foreign"; }, o => { o.desktop.root += "-copy"; }, o => { o.operation = "maintenance"; }, o => { delete o.desktop; }]) {
    const owner = structuredClone(original); alter(owner);
    await fs.writeFile(f.file, JSON.stringify(owner));
    assert.equal(await recoverDesktopLock(f.data), false);
    assert.deepEqual(JSON.parse(await fs.readFile(f.file)), owner);
  }
});

test("concurrent recovery preserves one copy without removing a new owner's protection", windows, async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([recoverDesktopLock(f.data), recoverDesktopLock(f.data)]);
  assert.equal(results.filter(r => r.status === "fulfilled" && r.value === true).length, 1);
  const release = await acquireInstanceLock(f.data, "desktop-services", await desktopOwnership(f.data));
  await assert.rejects(recoverDesktopLock(f.data), /正在使用/);
  await release();
});
