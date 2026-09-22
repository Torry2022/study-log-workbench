import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { assertSafePath, readSourceText } from "./paths.mjs";

export async function acquireIndexGuard(root) {
  await assertSafePath(root, { directory: true, allowMissing: true });
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await assertSafePath(root, { directory: true });
  const file = path.join(root, ".mcp-index.lock"), owner = crypto.randomUUID();
  let handle;
  try {
    handle = await fs.open(file, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ owner, pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.sync();
  } catch {
    throw new Error("Vector index is locked or unavailable. Stop its owner before inspecting a stale lock; locks are never removed automatically.");
  } finally { await handle?.close(); }
  let released = false;
  return async () => {
    if (released) return;
    const current = JSON.parse(await readSourceText(file));
    if (current.owner !== owner) throw new Error("Index lock ownership changed; lock was preserved.");
    await assertSafePath(file); await fs.unlink(file); released = true;
  };
}
