import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { assertNoLinks } from "./instance.mjs";
import { runService } from "./service.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, root, port = "3560"] = process.argv.slice(2);
try {
  if (!["dev", "start"].includes(command) || !root || !path.isAbsolute(root) || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error("用法：node ops/run-web.mjs dev|start 实例绝对路径 [端口1024–65535]");
  }
  await assertNoLinks(root);
  const data = path.join(root, "data");
  const backups = path.join(root, "backups");
  await assertNoLinks(data);
  await assertNoLinks(backups);
  await assertNoLinks(path.join(root, ".env"));
  const environment = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  await runService(process.execPath, ["node_modules/next/dist/bin/next", command, "-H", "127.0.0.1", "-p", port], {
    cwd: path.join(repository, "study-log-web"),
    env: { ...process.env, ...environment, LOG_ROOT: data, BACKUP_ROOT: backups, NODE_ENV: command === "dev" ? "development" : "production" }
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
