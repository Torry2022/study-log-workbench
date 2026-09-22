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

export async function withInstanceLock(data, operation) {
  const lock = path.join(data, ".instance-operation.lock");
  try { await fs.mkdir(lock); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("实例正在运行、维护或存在待检查的遗留锁");
    throw error;
  }
  try { return await operation(); }
  finally { await fs.rmdir(lock); }
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
