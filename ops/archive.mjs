import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseEnv } from "node:util";
import { acquireInstanceLock, assertNoLinks } from "./instance.mjs";

export const MAX_ARCHIVE_BYTES = 20 * 1024 ** 3;
export const MAX_ARCHIVE_ENTRIES = 100000;
export const MAX_MANIFEST_BYTES = 16 * 1024 ** 2;
const MAGIC = Buffer.from("STUDY-LOG-INSTANCE\0V1\n");
const BLOCK_BYTES = 64 * 1024;
const CONTROL_BYTES = 64 * 1024;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const digestPattern = /^[a-f0-9]{64}$/;

export class ArchiveError extends Error {
  constructor(code, message) { super(message); this.name = "ArchiveError"; this.code = code; }
}
const fail = (code, message) => { throw new ArchiveError(code, message); };
const invalid = () => fail("ARCHIVE_INVALID", "归档格式、清单或内容无效；未执行覆盖操作");
const outside = () => fail("ARCHIVE_PATH_INVALID", "路径超出保存范围或不符合跨平台归档规则");
const limits = () => fail("ARCHIVE_LIMIT", "归档超过 20 GiB、100000 项或 16 MiB 清单限制");
const exists = async target => fs.lstat(target).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
function absolute(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) outside();
  // Windows device/extended paths and ADS are not portable filesystem roots.
  if (process.platform === "win32" && (/^\\\\/.test(value) || value.slice(2).includes(":"))) outside();
  return path.resolve(value);
}
function beneath(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function sameFile(left, right) {
  // Windows lstat can report dev=0 while fstat reports the volume number.
  const deviceMatches = left.dev === right.dev || process.platform === "win32" && (left.dev === 0n || right.dev === 0n);
  return deviceMatches && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
async function noLinks(target) {
  try { await assertNoLinks(target); } catch { fail("ARCHIVE_UNSAFE_FILE", "归档路径不能包含符号链接或目录联接"); }
}
async function regular(target, maximum = MAX_ARCHIVE_BYTES) {
  await noLinks(target);
  const stat = await fs.lstat(target, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail("ARCHIVE_UNSAFE_FILE", "归档只接受普通文件；拒绝链接、硬链接和特殊文件");
  if (stat.size > BigInt(maximum)) limits();
  return stat;
}
async function openRegular(target, maximum = MAX_ARCHIVE_BYTES) {
  const before = await regular(target, maximum);
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat({ bigint: true });
    if (!sameFile(before, current) || !current.isFile() || current.nlink !== 1n) fail("ARCHIVE_SOURCE_CHANGED", "归档文件在读取时发生变化，请停止外部写入后重试");
    return { handle, stat: current };
  } catch (error) { await handle.close(); throw error; }
}
async function unchanged(handle, before, target) {
  if (!sameFile(before, await handle.stat({ bigint: true })) || !sameFile(before, await regular(target))) fail("ARCHIVE_SOURCE_CHANGED", "归档文件在读取时发生变化，请停止外部写入后重试");
}
async function readExact(handle, length, position) {
  const result = Buffer.alloc(length); let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(result, offset, length - offset, position + offset);
    if (!bytesRead) invalid();
    offset += bytesRead;
  }
  return result;
}
async function streamBytes(handle, position, length, consume = async () => {}) {
  const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(Math.min(BLOCK_BYTES, Math.max(length, 1)));
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - read), position + read);
    if (!bytesRead) invalid();
    const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await consume(chunk); read += bytesRead;
  }
  return hash.digest("hex");
}
async function writeAll(handle, buffer) {
  let written = 0;
  while (written < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, written, buffer.length - written);
    if (!bytesWritten) fail("ARCHIVE_WRITE_FAILED", "归档写入未完成，已保留现场");
    written += bytesWritten;
  }
}
async function controlFile(target) {
  const { handle, stat } = await openRegular(target, CONTROL_BYTES);
  try { const bytes = await readExact(handle, Number(stat.size), 0); await unchanged(handle, stat, target); return bytes; }
  finally { await handle.close(); }
}
function readIdentityAndEnvironment(identityBytes, envBytes) {
  try {
    const decode = buffer => new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const identity = JSON.parse(decode(identityBytes)), environment = parseEnv(decode(envBytes));
    if (identity.schemaVersion !== 1 || typeof identity.id !== "string" || !uuid.test(identity.id)) invalid();
    for (const [name, minimum] of [["APP_PASSWORD", 12], ["SESSION_SECRET", 32]]) {
      if ((environment[name] || "").trim().length < minimum || /^(?:change-me|replace-|dev-session-secret)/i.test(environment[name])) invalid();
    }
    return identity.id;
  } catch { fail("ARCHIVE_INSTANCE_INVALID", "工作台标识或访问凭据无效；内容不会打印到终端"); }
}

function entryPath(value) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 1024 || value.normalize("NFC") !== value) outside();
  const pieces = value.split("/");
  if (pieces.length > 32) outside();
  for (const piece of pieces) {
    if (!piece || piece === "." || piece === ".." || /[\\<>:"|?*\u0000-\u001f\u007f]/.test(piece) || /[. ]$/.test(piece) || Buffer.byteLength(piece) > 255 ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\.|$)/i.test(piece.normalize("NFKC")) || /~\d+(?:\.|$)/.test(piece)) outside();
  }
  if (value !== ".env" && value !== ".env.mcp" && pieces[0] !== "data" && pieces[0] !== "backups") outside();
  if (pieces.some(piece => piece.toLowerCase() === ".instance-operation.lock")) outside();
  return value;
}

function validateManifest(value, archiveSize) {
  if (!value || typeof value !== "object" || value.format !== "study-log-instance" || value.version !== 1 || !uuid.test(value.instanceId || "") ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.entries)) invalid();
  if (value.entries.length > MAX_ARCHIVE_ENTRIES) limits();
  const names = new Map(), aliases = new Set(); let total = 0;
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object") invalid();
    const name = entryPath(entry.path), alias = name.toUpperCase().toLowerCase();
    if (aliases.has(alias)) outside();
    const parent = path.posix.dirname(name);
    if (parent !== "." && names.get(parent)?.type !== "directory") outside();
    if (entry.type === "file") {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !digestPattern.test(entry.sha256 || "")) invalid();
      total += entry.size; if (total > MAX_ARCHIVE_BYTES) limits();
    } else if (entry.type !== "directory" || entry.size !== undefined || entry.sha256 !== undefined) invalid();
    names.set(name, entry); aliases.add(alias);
  }
  if (names.get(".env")?.type !== "file" || names.get("data/.instance.json")?.type !== "file" || names.get("data")?.type !== "directory" || names.get("backups")?.type !== "directory" ||
    names.get(".env").size > CONTROL_BYTES || names.get("data/.instance.json").size > CONTROL_BYTES || value.totalBytes !== total || total > archiveSize) invalid();
  if (names.has(".env.mcp") && (names.get(".env.mcp").type !== "file" || names.get(".env.mcp").size > CONTROL_BYTES)) invalid();
  return value;
}

async function scan(root) {
  const entries = [], snapshots = new Map(), directories = new Map(); let totalBytes = 0;
  async function visit(relative) {
    entryPath(relative);
    const target = path.join(root, ...relative.split("/")); await noLinks(target);
    const stat = await fs.lstat(target, { bigint: true });
    if (entries.length >= MAX_ARCHIVE_ENTRIES) limits();
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      entries.push({ path: relative, type: "directory" });
      directories.set(relative, stat);
      for (const name of (await fs.readdir(target)).sort()) {
        // Only the exact lock created by this operation is excluded.
        if (relative === "data" && name === ".instance-operation.lock") continue;
        await visit(`${relative}/${name}`);
      }
    } else {
      const { handle, stat: current } = await openRegular(target);
      try {
        totalBytes += Number(current.size); if (totalBytes > MAX_ARCHIVE_BYTES) limits();
        const sha256 = await streamBytes(handle, 0, Number(current.size)); await unchanged(handle, current, target);
        entries.push({ path: relative, type: "file", size: Number(current.size), sha256 }); snapshots.set(relative, current);
      } finally { await handle.close(); }
    }
  }
  for (const name of [".env", "data", "backups"]) await visit(name);
  if (await exists(path.join(root, ".env.mcp"))) await visit(".env.mcp");
  return { entries, snapshots, directories, totalBytes };
}

async function verifyOpen(archive, sidecar, handle, stat) {
  const external = (await controlFile(sidecar)).toString("utf8").trim();
  if (!digestPattern.test(external)) invalid();
  if (await streamBytes(handle, 0, Number(stat.size)) !== external) fail("ARCHIVE_DIGEST_MISMATCH", "归档外部 SHA-256 校验失败");
  const header = await readExact(handle, MAGIC.length + 4, 0);
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) invalid();
  const manifestLength = header.readUInt32BE(MAGIC.length);
  if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES) limits();
  const payloadOffset = header.length + manifestLength;
  if (payloadOffset > Number(stat.size)) invalid();
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readExact(handle, manifestLength, header.length))); }
  catch { invalid(); }
  validateManifest(manifest, Number(stat.size));
  if (payloadOffset + manifest.totalBytes !== Number(stat.size)) invalid();
  let position = payloadOffset, identityBytes, envBytes;
  for (const entry of manifest.entries) {
    if (entry.type !== "file") continue;
    if (entry.path === ".env") envBytes = await readExact(handle, entry.size, position);
    if (entry.path === "data/.instance.json") identityBytes = await readExact(handle, entry.size, position);
    if (await streamBytes(handle, position, entry.size) !== entry.sha256) fail("ARCHIVE_FILE_MISMATCH", "归档内文件 SHA-256 校验失败");
    position += entry.size;
  }
  if (readIdentityAndEnvironment(identityBytes, envBytes) !== manifest.instanceId) invalid();
  await unchanged(handle, stat, archive);
  return { manifest, payloadOffset, sha256: external };
}

/** New archives only: the sidecar and archive are never overwritten. */
export async function backupInstance(instanceRoot, archivePath, { protectFile } = {}) {
  const root = absolute(instanceRoot), archive = absolute(archivePath), sidecar = `${archive}.sha256`;
  if (beneath(root, archive)) outside();
  await noLinks(root); await noLinks(path.dirname(archive));
  if (!(await fs.stat(root)).isDirectory() || !(await fs.stat(path.dirname(archive))).isDirectory()) outside();
  // realpath also resolves Windows short-name aliases that are not symlinks.
  if (beneath(await fs.realpath(root), path.join(await fs.realpath(path.dirname(archive)), path.basename(archive)))) outside();
  if (await exists(archive) || await exists(sidecar)) fail("ARCHIVE_EXISTS", "归档或摘要文件已存在，请选择全新的归档文件名");
  const release = await acquireInstanceLock(path.join(root, "data"), "instance-backup");
  const partial = `${archive}.${crypto.randomUUID()}.partial`, partialDigest = `${partial}.sha256`;
  try {
    const instanceId = readIdentityAndEnvironment(await controlFile(path.join(root, "data/.instance.json")), await controlFile(path.join(root, ".env")));
    const scanned = await scan(root);
    const manifest = { format: "study-log-instance", version: 1, createdAt: new Date().toISOString(), instanceId, entries: scanned.entries, totalBytes: scanned.totalBytes };
    validateManifest(manifest, MAX_ARCHIVE_BYTES);
    const bytes = Buffer.from(JSON.stringify(manifest)), header = Buffer.alloc(MAGIC.length + 4);
    if (bytes.length > MAX_MANIFEST_BYTES || header.length + bytes.length + manifest.totalBytes > MAX_ARCHIVE_BYTES) limits();
    MAGIC.copy(header); header.writeUInt32BE(bytes.length, MAGIC.length);
    const output = await fs.open(partial, "wx", 0o600), digest = crypto.createHash("sha256");
    const write = async chunk => { await writeAll(output, chunk); digest.update(chunk); };
    try {
      if (protectFile) await protectFile(partial);
      await write(header); await write(bytes);
      for (const entry of manifest.entries) {
        if (entry.type !== "file") continue;
        const source = path.join(root, ...entry.path.split("/")), { handle, stat } = await openRegular(source);
        try {
          if (!sameFile(scanned.snapshots.get(entry.path), stat)) fail("ARCHIVE_SOURCE_CHANGED", "文件在归档时发生变化，请停止外部写入后重试");
          const hash = await streamBytes(handle, 0, entry.size, write);
          if (hash !== entry.sha256) fail("ARCHIVE_SOURCE_CHANGED", "文件在归档时发生变化，请停止外部写入后重试");
          await unchanged(handle, stat, source);
        } finally { await handle.close(); }
      }
      for (const [relative, before] of scanned.snapshots) {
        if (!sameFile(before, await regular(path.join(root, ...relative.split("/"))))) fail("ARCHIVE_SOURCE_CHANGED", "文件在归档时发生变化，请停止外部写入后重试");
      }
      for (const [relative, before] of scanned.directories) {
        const source = path.join(root, ...relative.split("/")); await noLinks(source);
        if (!sameFile(before, await fs.lstat(source, { bigint: true }))) fail("ARCHIVE_SOURCE_CHANGED", "保存目录在归档时发生变化，请停止外部写入后重试");
      }
      await output.sync();
    } finally { await output.close(); }
    const sha256 = digest.digest("hex"), digestFile = await fs.open(partialDigest, "wx", 0o600);
    try { await writeAll(digestFile, Buffer.from(`${sha256}\n`)); await digestFile.sync(); } finally { await digestFile.close(); }
    const opened = await openRegular(partial);
    try { await verifyOpen(partial, partialDigest, opened.handle, opened.stat); } finally { await opened.handle.close(); }
    // link() publishes without rename's overwrite race. Only our successful
    // staging names are unlinked; every failure preserves its partial files.
    await noLinks(path.dirname(archive));
    await fs.link(partialDigest, sidecar); await fs.unlink(partialDigest);
    await fs.link(partial, archive); await fs.unlink(partial);
    return { archive, digestFile: sidecar, sha256, instanceId, files: manifest.entries.filter(entry => entry.type === "file").length, bytes: header.length + bytes.length + manifest.totalBytes };
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("ARCHIVE_BACKUP_FAILED", "归档未完成；已保留可能存在的 .partial 文件或摘要，请检查空间与权限并使用新文件名重试");
  } finally { await release(); }
}

export async function verifyArchive(archivePath) {
  const archive = absolute(archivePath), { handle, stat } = await openRegular(archive);
  try { const verified = await verifyOpen(archive, `${archive}.sha256`, handle, stat); return { archive, sha256: verified.sha256, manifest: verified.manifest }; }
  finally { await handle.close(); }
}

/** Full verification precedes reservation. A failed extraction keeps its target and lock. */
export async function restoreInstance(archivePath, targetRoot, { onReserved } = {}) {
  const archive = absolute(archivePath), target = absolute(targetRoot);
  await noLinks(target);
  if (await exists(target)) fail("RESTORE_TARGET_EXISTS", "恢复目标必须不存在；不能覆盖或合并已有目录");
  if (!(await fs.stat(path.dirname(target))).isDirectory()) outside();
  const { handle, stat } = await openRegular(archive);
  let reserved = false;
  try {
    const { manifest, payloadOffset, sha256 } = await verifyOpen(archive, `${archive}.sha256`, handle, stat);
    await noLinks(path.dirname(target));
    await fs.mkdir(target, { mode: 0o700 }); reserved = true;
    // Desktop Windows callers restrict the new directory before any secret is
    // extracted. A failed permission step leaves an empty reserved target.
    if (onReserved) await onReserved(target);
    const marker = path.join(target, ".restore-incomplete.json");
    await fs.writeFile(marker, JSON.stringify({ version: 1, archiveSha256: sha256, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    const data = path.join(target, "data"); await fs.mkdir(data, { mode: 0o700 });
    const release = await acquireInstanceLock(data, "instance-restore");
    let position = payloadOffset;
    for (const entry of manifest.entries) {
      const destination = path.join(target, ...entry.path.split("/"));
      if (!beneath(target, destination)) outside();
      await noLinks(destination);
      if (entry.type === "directory") {
        if (entry.path !== "data") await fs.mkdir(destination, { mode: 0o700 });
        continue;
      }
      const output = await fs.open(destination, "wx", 0o600);
      try {
        const digest = await streamBytes(handle, position, entry.size, chunk => writeAll(output, chunk));
        if (digest !== entry.sha256) fail("ARCHIVE_FILE_MISMATCH", "恢复过程中备份内容发生变化，恢复已停止；目标目录已保留供检查");
        await output.sync();
      } finally { await output.close(); }
      position += entry.size;
    }
    await unchanged(handle, stat, archive);
    await fs.mkdir(path.join(target, "index"), { mode: 0o700 });
    await fs.unlink(marker); await release();
    return { restored: true, root: target, instanceId: manifest.instanceId, files: manifest.entries.filter(entry => entry.type === "file").length };
  } catch (error) {
    if (reserved) throw new ArchiveError("RESTORE_INCOMPLETE", "恢复未完成，目标目录已保留供检查。不要打开该目录，请另选新的保存位置重试");
    if (error instanceof ArchiveError) throw error;
    if (error.code === "EEXIST") throw new ArchiveError("RESTORE_TARGET_EXISTS", "恢复目标已被另一操作占用；未覆盖任何文件");
    throw new ArchiveError("ARCHIVE_RESTORE_FAILED", "无法验证或创建恢复目标，请检查归档、摘要、父目录和权限");
  } finally { await handle.close(); }
}
