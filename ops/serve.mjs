import { runService } from "./service.mjs";

// Container/standalone entrypoint. The chosen Node script runs under the lock.
try {
  const [entrypoint, ...args] = process.argv.slice(2);
  if (!entrypoint) throw new Error("用法：node ops/serve.mjs Node服务入口 [参数]");
  await runService(process.execPath, [entrypoint, ...args]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
