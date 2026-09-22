import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { assertSafePath, resolveRoots } from "./paths.mjs";
import { checkCancelled, ProviderError } from "./providers.mjs";

export const INDEX_VERSION = 3;
export const CHUNKING_VERSION = 3;
const queues = new Map();
// This queue serializes only this process. One running MCP process must own an
// INDEX_ROOT; sharing an index between processes is not supported.
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const pathKey = value => process.platform === "win32" ? value.toLowerCase() : value;
export class IndexError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = "IndexError"; }
}

async function waitFor(promise, signal) {
  checkCancelled(signal);
  if (!signal) return promise;
  let cancel;
  const aborted = new Promise((_, reject) => { cancel = () => reject(new ProviderError("cancelled", "Retrieval request cancelled.")); signal.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", cancel); }
}
async function serialize(key, operation, signal) {
  while (queues.has(key)) await waitFor(queues.get(key).catch(() => {}), signal);
  checkCancelled(signal);
  const pending = operation().finally(() => queues.delete(key));
  queues.set(key, pending);
  return pending;
}

async function readIndex(file) {
  await assertSafePath(file, { allowMissing: true });
  let handle;
  try {
    const before = await fs.lstat(file);
    if (!before.isFile()) throw new IndexError("unsafe_index", "Index must be a regular file.");
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const stat = await handle.stat();
    await assertSafePath(file);
    const current = await fs.lstat(file);
    if (stat.ino !== current.ino || (process.platform !== "win32" && stat.dev !== current.dev)) throw new IndexError("index_changed", "Index changed while reading.");
    if (!stat.isFile()) throw new IndexError("unsafe_index", "Index must be a regular file.");
    if (stat.size > 256 * 1024 * 1024) throw new IndexError("index_too_large", "Index exceeds the supported size limit.");
    const raw = await handle.readFile("utf8");
    await assertSafePath(file);
    try { return JSON.parse(raw); } catch { return null; }
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof IndexError) throw error;
    throw new IndexError("index_unavailable", "Index could not be read.");
  } finally { await handle?.close(); }
}

async function readInstanceIdentity(logRoot) {
  const file = path.join(logRoot, ".instance.json");
  let handle;
  try {
    await assertSafePath(file);
    const before = await fs.lstat(file, { bigint: true });
    if (!before.isFile() || before.size > 4096n) throw new Error("Invalid identity file.");
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.ino !== before.ino || opened.size > 4096n || (process.platform !== "win32" && opened.dev !== before.dev)) throw new Error("Identity changed.");
    const buffer = Buffer.alloc(4097);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    await assertSafePath(file);
    const after = await fs.lstat(file, { bigint: true });
    if (size > 4096 || BigInt(size) !== opened.size || after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || (process.platform !== "win32" && after.dev !== opened.dev)) throw new Error("Identity changed.");
    const identity = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
    if (identity?.schemaVersion !== 1 || typeof identity.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id)) throw new Error("Invalid identity.");
    return hash(`${pathKey(logRoot)}\n${identity.id.toLowerCase()}`);
  } catch {
    throw new IndexError("instance_identity_unavailable", "Vector retrieval requires a valid initialized instance identity.");
  } finally { await handle?.close(); }
}

async function writeIndex(root, file, index, signal) {
  checkCancelled(signal);
  await assertSafePath(root, { directory: true, allowMissing: true });
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await assertSafePath(root, { directory: true });
  const temporary = path.join(root, `.index-${crypto.randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await fs.open(temporary, "wx", 0o600); created = true;
    try { await handle.writeFile(JSON.stringify(index), "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    checkCancelled(signal);
    await assertSafePath(root, { directory: true }); await assertSafePath(file, { allowMissing: true });
    // An atomic rename either replaces the complete derived snapshot or leaves
    // the previous one intact. Never copy over a live index after rename failure.
    await fs.rename(temporary, file);
    created = false;
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof IndexError) throw error;
    throw new IndexError("index_write_failed", "Index update failed; previous index was preserved.");
  } finally {
    if (created) {
      try { await assertSafePath(temporary); await fs.unlink(temporary); } catch { /* Unsafe/missing paths are not followed during cleanup. */ }
    }
  }
}

export class VectorIndex {
  constructor(options) {
    const { logRoot, indexRoot } = resolveRoots(options);
    this.root = indexRoot;
    this.file = path.join(indexRoot, "index-v3.json");
    this.logRoot = logRoot;
  }
  async sync(chunks, client, { signal } = {}) {
    const snapshot = chunks.map(({ id, hash, embeddingText }) => ({ id, hash, embeddingText }));
    const providerConfig = Object.freeze({ endpointHash: hash(client.apiUrl), model: client.model, dimensions: client.dimensions,
      chunkingVersion: CHUNKING_VERSION });
    return serialize(pathKey(this.file), async () => {
      checkCancelled(signal);
      const config = Object.freeze({ ...providerConfig, instanceHash: await readInstanceIdentity(this.logRoot) });
      const previous = await readIndex(this.file);
      const compatible = previous?.version === INDEX_VERSION && Object.entries(config).every(([key, value]) => previous.config?.[key] === value);
      const stored = compatible && previous.chunks && typeof previous.chunks === "object" && !Array.isArray(previous.chunks) ? previous.chunks : {};
      const validVector = vector => Array.isArray(vector) && vector.length === config.dimensions && vector.every(value => typeof value === "number" && Number.isFinite(value));
      const unchanged = chunk => stored[chunk.id]?.hash === chunk.hash && validVector(stored[chunk.id]?.vector);
      const pending = snapshot.filter(chunk => !unchanged(chunk));
      if (compatible && !pending.length && Object.keys(stored).length === snapshot.length && typeof previous.updatedAt === "string") return previous;
      const nextChunks = Object.create(null);
      for (const chunk of snapshot) if (unchanged(chunk)) nextChunks[chunk.id] = stored[chunk.id];
      for (let start = 0; start < pending.length; start += 10) {
        checkCancelled(signal);
        const batch = pending.slice(start, start + 10), vectors = await client.embed(batch.map(chunk => chunk.embeddingText), { signal });
        if (!Array.isArray(vectors) || vectors.length !== batch.length || !vectors.every(validVector)) throw new IndexError("invalid_vectors", "Embedding vectors do not match the index configuration.");
        batch.forEach((chunk, offset) => { nextChunks[chunk.id] = { hash: chunk.hash, vector: vectors[offset] }; });
      }
      checkCancelled(signal);
      if (await readInstanceIdentity(this.logRoot) !== config.instanceHash) throw new IndexError("instance_identity_unavailable", "Instance identity changed during indexing; retry.");
      const next = { version: INDEX_VERSION, config, updatedAt: new Date().toISOString(), chunks: nextChunks };
      await writeIndex(this.root, this.file, next, signal);
      return next;
    }, signal);
  }
}
