import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** SQLite owns cross-process locking and crash recovery; never unlink a stale owner's lock. */
export async function withRagSessionLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  if (!path.isAbsolute(root)) throw new Error("Explicit session root required");
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe session directory");
  }
  const state = path.join(root, "state");
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(state);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe session directory");
  const target = path.join(state, "rag-sessions-lock.sqlite");
  for (const file of [target, `${target}-journal`]) {
    const existing = await fs.lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw new Error("Unsafe session mutex");
  }
  const db = new DatabaseSync(target), started = Date.now();
  let locked = false;
  try {
    // An async writer must not block its own event loop while another connection holds the lock.
    db.exec("PRAGMA busy_timeout=0");
    const execute = async (sql: string) => {
      while (true) {
        try { db.exec(sql); return; }
        catch (error) {
          if (![5, 6].includes((error as { errcode?: number }).errcode || 0)) throw error;
          if (Date.now() - started > 5000) throw new Error("Session store is busy; retry later");
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
    };
    await execute("BEGIN IMMEDIATE"); locked = true;
    const result = await action();
    await execute("COMMIT"); locked = false;
    return result;
  } finally {
    if (locked) db.exec("ROLLBACK");
    db.close();
  }
}
