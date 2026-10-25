import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { windowsSystem } from "./windows-system.mjs";

test("Windows requests preserve concurrent replies, literal paths and recovery after a rejected operation", { skip: process.platform !== "win32" }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-windows-pipe-"));
  t.after(async () => {
    assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
    assert.match(path.basename(base), /^study-log-windows-pipe-/);
    await fs.rm(base, { recursive: true, force: true });
  });
  const directory = path.join(base, "原样路径-'$(); 中文");
  await fs.mkdir(directory);
  await assert.rejects(windowsSystem("file", path.join(base, "missing")));
  const [drive, processes] = await Promise.all([
    windowsSystem("drive", path.parse(base).root), windowsSystem("processes", [process.pid])
  ]);
  assert.equal(drive, 3); assert.equal(processes.length, 1); assert.equal(processes[0].pid, process.pid);
  assert.ok(Number.isFinite(Date.parse(processes[0].started)));
  await windowsSystem("directory", directory);
  assert.deepEqual(await fs.readdir(base), [path.basename(directory)]);
  await assert.rejects(windowsSystem("unknown", ""), /Unsupported/);
  // Allow the idle process to exit, then verify a later operation starts a fresh pipe.
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(await windowsSystem("drive", path.parse(base).root), 3);
});
