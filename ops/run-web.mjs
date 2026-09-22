import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
import { assertNoLinks, withInstanceLock } from "./instance.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, root, port = "3560"] = process.argv.slice(2);
try {
  if (!["dev", "start"].includes(command) || !root || !path.isAbsolute(root) || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error("用法：node ops/run-web.mjs dev|start 实例绝对路径 [端口1024–65535]");
  }
  await assertNoLinks(root);
  const data = path.join(root, "data");
  await assertNoLinks(data);
  await assertNoLinks(path.join(root, ".env"));
  const environment = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  const identityFile = path.join(data, ".instance.json");
  await assertNoLinks(identityFile);
  const identity = JSON.parse(await fs.readFile(identityFile, "utf8"));
  if (identity.schemaVersion !== 1 || typeof identity.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id)) throw new Error("实例身份无效");
  for (const [name, minimum] of [["APP_PASSWORD", 12], ["SESSION_SECRET", 32]]) {
    if ((environment[name] || "").trim().length < minimum || /^(?:change-me|replace-|dev-session-secret)/i.test(environment[name])) throw new Error(`${name} 缺失或不安全`);
  }
  await withInstanceLock(data, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", command, "-H", "127.0.0.1", "-p", port], {
      cwd: path.join(repository, "study-log-web"),
      env: { ...process.env, ...environment, LOG_ROOT: data, NODE_ENV: command === "dev" ? "development" : "production" },
      stdio: "inherit", windowsHide: true
    });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", stop); process.off("SIGTERM", stop);
      if (code !== 0 && !signal) process.exitCode = code || 1;
      resolve();
    });
  }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
