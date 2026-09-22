import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { acquireInstanceLock, assertNoLinks } from "./instance.mjs";

export async function validateServiceEnvironment(environment) {
  const data = environment.LOG_ROOT;
  if (!data || !path.isAbsolute(data)) throw new Error("LOG_ROOT 必须是已初始化实例的数据绝对路径");
  await assertNoLinks(data);
  const identityFile = path.join(data, ".instance.json");
  await assertNoLinks(identityFile);
  const identity = JSON.parse(await fs.readFile(identityFile, "utf8"));
  if (identity.schemaVersion !== 1 || typeof identity.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id)) throw new Error("实例身份无效");
  for (const [name, minimum] of [["APP_PASSWORD", 12], ["SESSION_SECRET", 32]]) {
    if ((environment[name] || "").trim().length < minimum || /^(?:change-me|replace-|dev-session-secret)/i.test(environment[name])) throw new Error(`${name} 缺失或不安全`);
  }
  return data;
}

/** The official Web entrypoints hold the same exclusive lock as maintenance. */
export async function runService(command, args, { cwd, env = process.env, stdio = "inherit" } = {}) {
  const data = await validateServiceEnvironment(env);
  const release = await acquireInstanceLock(data, "web-service");
  let child;
  try { child = spawn(command, args, { cwd, env, stdio, windowsHide: true }); }
  catch (error) { await release(); throw error; }
  const stop = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const onInterrupt = () => stop("SIGINT"), onTerminate = () => stop("SIGTERM");
  process.on("SIGINT", onInterrupt); process.on("SIGTERM", onTerminate);
  try {
    const result = await new Promise(resolve => {
      let startupError = null;
      child.once("error", error => { startupError = error; });
      // Wait for close, not just exit, so the service has finished its output.
      child.once("close", (code, signal) => resolve({ code, signal, startupError }));
    });
    if (result.startupError) { await release(); throw new Error("Web 服务进程未能启动，请检查运行环境"); }
    if (result.code !== 0 || result.signal) throw new Error("Web 服务异常停止，实例锁已保留；确认全部服务停止并核对资料后再处理遗留锁");
    await release();
  } finally { process.off("SIGINT", onInterrupt); process.off("SIGTERM", onTerminate); }
}
