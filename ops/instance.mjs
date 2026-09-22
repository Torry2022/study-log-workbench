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
    if (stat?.isSymbolicLink()) throw new Error("实例路径不能包含符号链接或目录联接");
  }
}

export async function acquireInstanceLock(data, operation = "maintenance") {
  if (!data || !path.isAbsolute(data)) throw new Error("实例锁需要明确的数据绝对路径");
  await assertNoLinks(data);
  if (!(await fs.stat(data)).isDirectory()) throw new Error("实例数据路径必须是目录");
  const lock = path.join(data, ".instance-operation.lock");
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("实例正在运行、维护或存在待检查的遗留锁");
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
    if (!ownerStat.isFile() || ownerStat.size > 4096 || current.ino !== identity.ino || current.dev !== identity.dev || JSON.parse(await fs.readFile(ownerFile, "utf8")).ownerId !== ownerId) throw new Error("实例锁归属已变化；保留锁，请停机检查");
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
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("实例配置必须是普通文件");
  }
}

export async function initialize(root) {
  if (!root || !path.isAbsolute(root)) throw new Error("请明确指定实例的绝对路径");
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
    catch { throw new Error("目标目录非空且不是已初始化实例；请选择新目录"); }
    if (identity.schemaVersion !== 1 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id)) {
      throw new Error("实例身份无效，请检查目录");
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
    if (process.argv[2] !== "init") throw new Error("用法：node ops/instance.mjs init 实例绝对路径");
    console.log(JSON.stringify(await initialize(process.argv[3])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
