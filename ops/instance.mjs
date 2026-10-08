import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export async function assertNoLinks(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("保存路径不能包含符号链接或目录联接");
  }
}

export async function acquireInstanceLock(data, operation = "maintenance") {
  if (!data || !path.isAbsolute(data)) throw new Error("运行锁需要明确的数据绝对路径");
  await assertNoLinks(data);
  if (!(await fs.stat(data)).isDirectory()) throw new Error("学习记录保存路径必须是目录");
  const lock = path.join(data, ".instance-operation.lock");
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("此保存位置可能仍在使用，或上次运行未正常结束。请先关闭正在使用它的工作台；仍无法打开时，请按维护说明检查，不要删除文件。");
    throw error;
  }
  const identity = await fs.lstat(lock);
  const ownerFile = path.join(lock, "owner.json"), ownerId = crypto.randomUUID();
  // A failed owner write leaves the new lock for inspection: never remove a
  // directory whose ownership could not be fully established.
  await fs.writeFile(ownerFile, JSON.stringify({ ownerId, operation, pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  let released = false;
  return async () => {
    if (released) return;
    await assertNoLinks(lock);
    await assertNoLinks(ownerFile);
    const current = await fs.lstat(lock), ownerStat = await fs.lstat(ownerFile);
    if (!ownerStat.isFile() || ownerStat.size > 4096 || current.ino !== identity.ino || current.dev !== identity.dev || JSON.parse(await fs.readFile(ownerFile, "utf8")).ownerId !== ownerId) throw new Error("运行状态发生变化，操作已停止。请按维护说明检查，不要删除文件");
    await fs.unlink(ownerFile);
    await fs.rmdir(lock);
    released = true;
  };
}

export async function withInstanceLock(data, operation) {
  const release = await acquireInstanceLock(data);
  try { return await operation(); }
  finally { await release(); }
}

async function writeNew(file, contents) {
  try { await fs.writeFile(file, contents, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("工作台配置必须是普通文件");
  }
}

// Exact published rc.5 bytes: Git LF and Windows package CRLF. Never normalize user files.
const LEGACY_HIGHLIGHTING = new Set([
  "3079fd811643c740cde8da12a44bc16bdc18d13fde545369d72e1b74d90b4635",
  "c6cc30ba66b776394f7f8b14251a368360832aa61a61884b1dbff15dcadd1678"
]);
const LEGACY_EXTRACTION = new Set([
  "c34523b7c443bbb4b9c4445810d5718cf00dcf4bd63b490da8479f7879022e74",
  "7137f152d392c1f38f1c5a0c1aba7d7b5f2bfd09ad57b32deec830a84c990918"
]);
const promptDigest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
async function readPromptBytes(file) {
  await assertNoLinks(file);
  const handle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536) throw new Error("invalid-template");
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    await assertNoLinks(file);
    const current = await fs.lstat(file);
    if (size > 65536 || current.ino !== stat.ino || (process.platform !== "win32" && current.dev !== stat.dev)) throw new Error("invalid-template");
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
async function replacePromptFile(file, bytes, beforeReplace) {
  await assertNoLinks(file);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    await assertNoLinks(file);
    if (beforeReplace) await beforeReplace();
    await fs.rename(temporary, file);
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

/** Caller holds the instance lock. Optional template maintenance must not prevent startup. */
export async function upgradeDefaultPrompts(data) {
  const results = [];
  for (const [name, known] of [["highlighting", LEGACY_HIGHLIGHTING], ["extraction", LEGACY_EXTRACTION]]) {
    results.push(await upgradeDefaultPrompt(data, name, known));
  }
  return results;
}

async function upgradeDefaultPrompt(data, name, known) {
  const file = path.join(data, "prompts", `${name}.md`);
  const history = path.join(data, "prompts", ".default-upgrades");
  let result;
  try {
    const current = await readPromptBytes(file);
    const next = await readPromptBytes(fileURLToPath(new URL(`../prompts/${name}.md`, import.meta.url)));
    if (current.equals(next)) return { template: name, status: "current" };
    const previous = promptDigest(current);
    if (!known.has(previous)) result = { template: name, status: "skipped", reason: "custom-or-unknown" };
    else {
      await assertNoLinks(history);
      await fs.mkdir(history, { recursive: true, mode: 0o700 });
      const backup = path.join(history, `${name}-${previous}.md`);
      await assertNoLinks(backup);
      try {
        const handle = await fs.open(backup, "wx", 0o600);
        try { await handle.writeFile(current); await handle.sync(); } finally { await handle.close(); }
      } catch (error) { if (error.code !== "EEXIST") throw error; }
      if (!(await readPromptBytes(backup)).equals(current)) throw new Error("backup-mismatch");
      await replacePromptFile(file, next, async () => {
        if (!(await readPromptBytes(file)).equals(current)) throw new Error("template-changed");
      });
      result = { template: name, status: "updated", from: previous, to: promptDigest(next) };
    }
  } catch (error) {
    const allowed = ["invalid-template", "backup-mismatch", "template-changed"];
    result = { template: name, status: "failed", reason: allowed.includes(error.message) ? error.message : "template-io" };
  }
  // No paths, template contents or provider credentials in the maintenance record.
  try {
    await assertNoLinks(history);
    await fs.mkdir(history, { recursive: true, mode: 0o700 });
    const report = path.join(history, name === "highlighting" ? "status.json" : `${name}-status.json`), bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
    await assertNoLinks(report);
    const previous = await readPromptBytes(report).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!previous?.equals(bytes)) await replacePromptFile(report, bytes);
  } catch { console.warn("默认模板维护记录未能写入；原有学习记录不受影响。", result.status); }
  return result;
}

export async function initialize(root) {
  if (!root || !path.isAbsolute(root)) throw new Error("请明确指定保存位置的绝对路径");
  root = path.resolve(root);
  await assertNoLinks(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(root);
  const data = path.join(root, "data");
  const identityFile = path.join(data, ".instance.json");
  if (entries.length) {
    await assertNoLinks(identityFile);
    let identity;
    try { identity = JSON.parse(await fs.readFile(identityFile, "utf8")); }
    catch { throw new Error("此文件夹已有其他文件；请选择空文件夹或原有学习记录的保存位置"); }
    if (identity.schemaVersion !== 1 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id)) {
      throw new Error("工作台标识无效，请检查保存位置");
    }
  }
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  return withInstanceLock(data, async () => {
    for (const name of ["index", "backups"]) {
      await assertNoLinks(path.join(root, name));
      await fs.mkdir(path.join(root, name), { recursive: true, mode: 0o700 });
    }
    await writeNew(identityFile, JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }, null, 2) + "\n");
    const prompts = path.join(data, "prompts");
    await assertNoLinks(prompts);
    await fs.mkdir(prompts, { recursive: true, mode: 0o700 });
    for (const name of ["generation", "highlighting", "extraction"]) {
      const target = path.join(prompts, `${name}.md`);
      await assertNoLinks(target);
      const source = new URL(`../prompts/${name}.md`, import.meta.url);
      await writeNew(target, await fs.readFile(source));
    }
    await upgradeDefaultPrompts(data);
    const envFile = path.join(root, ".env");
    await assertNoLinks(envFile);
    await writeNew(envFile, [
      `APP_PASSWORD=${crypto.randomBytes(18).toString("base64url")}`,
      `SESSION_SECRET=${crypto.randomBytes(36).toString("base64url")}`,
      "COOKIE_SECURE=false", "CHAT_API_URL=", "CHAT_MODEL=", "CHAT_API_KEY=", ""
    ].join("\n"));
    return { initialized: true, credentialsFile: envFile };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== "init") throw new Error("用法：node ops/instance.mjs init 保存位置绝对路径");
    console.log(JSON.stringify(await initialize(process.argv[3])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
