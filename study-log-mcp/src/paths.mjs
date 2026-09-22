import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

export class SourceError extends Error {
  constructor(message, code = "INVALID_SOURCE") { super(message); this.code = code; this.name = "SourceError"; }
}

function explicitRoot(value, name) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) throw new SourceError(`${name} must be an explicit absolute directory.`, "INVALID_ROOT");
  return path.resolve(value);
}
export function resolveLogRoot(input) { return explicitRoot(input ?? process.env.LOG_ROOT, "LOG_ROOT"); }
export function resolveRoots({ logRoot, indexRoot } = {}) {
  const source = resolveLogRoot(logRoot), index = explicitRoot(indexRoot ?? process.env.INDEX_ROOT, "INDEX_ROOT");
  const nested = (parent, child) => {
    const relative = path.relative(parent, child);
    return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  if (nested(source, index) || nested(index, source)) throw new SourceError("LOG_ROOT and INDEX_ROOT must be separate non-overlapping directories.", "INVALID_ROOT");
  return { logRoot: source, indexRoot: index };
}

export async function assertSafePath(target, { directory = false, allowMissing = false } = {}) {
  let current = path.parse(target).root;
  const segments = target.slice(current.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (allowMissing && error?.code === "ENOENT") return;
      throw new SourceError("Instance path is unavailable.", "SOURCE_UNAVAILABLE");
    }
    if (stat.isSymbolicLink() || ((i < segments.length - 1 || directory) && !stat.isDirectory())) {
      throw new SourceError("Instance paths must not contain links or invalid directories.", "UNSAFE_PATH");
    }
  }
}

export async function readSourceText(file) {
  await assertSafePath(file);
  let handle;
  try {
    const before = await fs.lstat(file, { bigint: true });
    if (!before.isFile()) throw new SourceError("Log source must be a regular file.", "UNSAFE_PATH");
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat({ bigint: true });
    await assertSafePath(file);
    if (!opened.isFile() || opened.ino !== before.ino || (process.platform !== "win32" && opened.dev !== before.dev)) throw new SourceError("Log source changed while reading; retry.", "SOURCE_CHANGED");
    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    await assertSafePath(file);
    const after = await fs.lstat(file, { bigint: true });
    if (opened.size !== afterRead.size || opened.mtimeNs !== afterRead.mtimeNs || after.ino !== opened.ino || (process.platform !== "win32" && after.dev !== opened.dev)) throw new SourceError("Log source changed while reading; retry.", "SOURCE_CHANGED");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new SourceError("Log source is not valid UTF-8.", "INVALID_SOURCE"); }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError("Log source could not be read.", "SOURCE_UNAVAILABLE");
  } finally { await handle?.close(); }
}
