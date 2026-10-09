import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// This private inherited IPC channel is never exposed over HTTP. Windows signals
// sent by child.kill terminate immediately; invoke the service's own cleanup here.
if (!process.send) throw new Error("Desktop workers require an inherited IPC channel");
let close, stopping, requested = false, activated = false;
const stop = () => {
  if (!activated) process.exit(0);
  requested = true;
  if (!close) return;
  return stopping ??= Promise.resolve().then(close).catch(() => process.exit(1));
};
process.on("message", message => { if (message?.type === "stop") void stop(); });
process.once("disconnect", () => void stop());
// Register the worker in the owner's durable record before it can write data.
await new Promise(resolve => process.on("message", message => {
  if (message?.type === "start" && !activated) { activated = true; resolve(); }
}));
try {
  const [kind, location] = process.argv.slice(2);
  if (kind === "web") {
    process.chdir(location);
    const config = JSON.parse(await fs.readFile(path.join(location, ".next-build-cache", "required-server-files.json"), "utf8")).config;
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
    delete process.env.NEXT_MANUAL_SIG_HANDLE;
    const require = createRequire(path.join(location, "package.json"));
    require("next");
    const { startServer } = require("next/dist/server/lib/start-server");
    await startServer({ dir: location, isDev: false, config, hostname: "127.0.0.1", port: Number(process.env.PORT), allowRetry: false });
    if (!process.listenerCount("SIGTERM")) throw new Error("Next graceful shutdown handler is unavailable");
    close = async () => { process.emit("SIGTERM"); };
  } else if (kind === "mcp") {
    const { startHttpServer } = await import(pathToFileURL(path.join(location, "src", "http-server.mjs")));
    const handle = await startHttpServer({ host: "127.0.0.1", port: Number(process.env.MCP_HTTP_PORT),
      token: process.env.MCP_HTTP_TOKEN, logRoot: process.env.LOG_ROOT, indexRoot: process.env.INDEX_ROOT,
      retrieval: { embedding: { apiKey: "", apiUrl: "", model: "" }, reranker: { apiKey: "", apiUrl: "", model: "" } } });
    close = async () => { await handle.close(); if (process.connected) process.disconnect(); };
  } else throw new Error("Unknown desktop worker");
  if (requested) await stop(); else process.send({ type: "ready" });
} catch { console.error("本地服务启动失败，请检查端口、目录和安装包。"); process.exit(1); }
