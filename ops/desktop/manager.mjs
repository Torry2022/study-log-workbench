import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { initialize, acquireInstanceLock, assertNoLinks } from "../instance.mjs";
import { validateServiceEnvironment } from "../service.mjs";
import { backupInstance, verifyArchive, restoreInstance } from "../archive.mjs";
import { atomicPrivateFile, privateDirectory, privateFile, runtimeEnvironment } from "./security.mjs";

const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const inside = (root, value) => { const relative = path.relative(root, value); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
const errorText = "上次运行未正常结束。请先检查服务和资料状态，再按维护说明处理。实例锁已保留。";

export async function availablePort(preferred = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(preferred, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(kind, location, env, options) {
  const child = fork(options.worker ?? worker, [kind, location], {
    execPath: options.node ?? process.execPath, execArgv: [], env: runtimeEnvironment(env), windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  // Runtime output can contain provider details. Do not echo it into the UI or log.
  child.stdout.resume(); child.stderr.resume();
  const ended = new Promise(resolve => { child.once("error", () => {}); child.once("close", (code, signal) => resolve({ code, signal })); });
  const ready = new Promise((resolve, reject) => {
    child.on("message", message => { if (message?.type === "ready") resolve(); });
    ended.then(() => reject(new Error(`${kind === "web" ? "工作台" : "检索服务"}启动失败，请检查端口、目录和安装包`)));
  });
  const stop = async () => {
    if (child.connected) child.send({ type: "stop" }, () => {});
    const result = await ended;
    if (result.code !== 0 || result.signal) throw new Error(errorText);
  };
  return { child, ready, ended, stop };
}

function serializeEnvironment(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) throw new Error("配置包含不支持的字符");
    const quote = !value.includes("'") ? "'" : !value.includes("`") ? "`" : !value.includes('"') && !/\\[nr]/.test(value) ? '"' : null;
    if (!quote) throw new Error("配置不能同时包含三种引号");
    return `${key}=${quote}${value}${quote}`;
  }).join("\n") + "\n";
}

export class DesktopManager {
  constructor({ packageRoot, webRoot = path.join(packageRoot, "web"), mcpRoot = path.join(packageRoot, "mcp"), node, worker: customWorker, webPort = 0, mcpPort = 0 } = {}) {
    this.packageRoot = path.resolve(packageRoot); this.webRoot = webRoot; this.mcpRoot = mcpRoot;
    this.workerOptions = { node, worker: customWorker }; this.ports = { web: webPort, mcp: mcpPort };
    this.root = null; this.state = "stopped"; this.issue = ""; this.processes = []; this.url = null; this.queue = Promise.resolve();
  }
  status() { return { state: this.state, root: this.root, url: this.url, issue: this.issue }; }
  operation(work) {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  async rootPath(value) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("请选择资料目录的绝对路径");
    const root = path.resolve(value);
    if (inside(this.packageRoot, root) || inside(root, this.packageRoot)) throw new Error("资料目录必须与程序目录分开，不能使用程序目录或其父目录");
    await assertNoLinks(root); return root;
  }
  async inspect(value) {
    const root = await this.rootPath(value);
    const stat = await fs.stat(root).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return { root, kind: "new" };
    if (!stat.isDirectory()) return { root, kind: "invalid", message: "请选择文件夹，不能使用文件作为资料目录。" };
    const entries = await fs.readdir(root);
    if (!entries.length) return { root, kind: "new" };
    try {
      const identityFile = path.join(root, "data", ".instance.json");
      await assertNoLinks(identityFile);
      const identity = JSON.parse(await fs.readFile(identityFile, "utf8"));
      if (identity.schemaVersion !== 1 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id)) throw new Error();
      await this.readEnvironment(root);
    } catch { return { root, kind: "invalid", message: "此目录已有文件，但不是可用的工作台实例。请选择空目录或已有实例目录。" }; }
    const lock = await fs.lstat(path.join(root, "data", ".instance-operation.lock")).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (lock && !(root === this.root && this.state === "running")) return { root, kind: "invalid", message: "此实例正在使用，或有待检查的运行锁。请先检查，勿删除资料或锁文件。" };
    return { root, kind: "existing" };
  }
  async readEnvironment(root = this.root) {
    if (!root) throw new Error("请先创建或打开资料目录");
    await assertNoLinks(path.join(root, ".env"));
    const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
    await validateServiceEnvironment({ ...env, LOG_ROOT: path.join(root, "data") }); return env;
  }
  async select({ root, create = false, password }) {
    if (this.state !== "stopped") throw new Error("请先停止当前工作台");
    const inspected = await this.inspect(root);
    root = inspected.root;
    if (inspected.kind !== (create ? "new" : "existing")) throw new Error(inspected.message || (create ? "新实例需要空目录；此目录已有实例，请打开已有实例。" : "此目录尚未创建实例，请先新建。"));
    if (create) {
      if (typeof password !== "string" || password.trim().length < 12 || /[\r\n\0]/.test(password) || /^(?:change-me|replace-|dev-session-secret)/i.test(password)) throw new Error("访问密码至少 12 个字符，不能包含换行或使用占位密码");
      serializeEnvironment({ APP_PASSWORD: password });
      if ((await fs.readdir(root).catch(error => { if (error.code === "ENOENT") return []; throw error; })).length) throw new Error("新实例需要空目录；已有资料请使用打开");
      await privateDirectory(root);
      await initialize(root);
      const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
      env.APP_PASSWORD = password;
      await atomicPrivateFile(path.join(root, ".env"), serializeEnvironment(env));
    }
    const old = this.root; this.root = root;
    try {
      await this.readEnvironment();
      const release = await acquireInstanceLock(path.join(root, "data"), "desktop-open"); await release();
    } catch (error) { this.root = old; throw error; }
    this.issue = ""; return this.status();
  }
  async configuration() {
    const env = await this.readEnvironment();
    return { apiUrl: env.CHAT_API_URL ?? "", model: env.CHAT_MODEL ?? "", hasKey: Boolean(env.CHAT_API_KEY) };
  }
  async configure({ apiUrl = "", model = "", apiKey, clearKey = false }) {
    if (!this.root) throw new Error("请先创建或打开资料目录");
    if (this.state !== "stopped") throw new Error("请先停止工作台再修改模型配置");
    if (typeof apiUrl !== "string" || typeof model !== "string" || (apiKey !== undefined && typeof apiKey !== "string")) throw new Error("模型配置格式无效");
    if (apiUrl) {
      let url; try { url = new URL(apiUrl); } catch { throw new Error("请输入完整模型接口地址"); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || /[\s\\]/.test(apiUrl)) throw new Error("模型接口地址无效");
    }
    if (/[\u0000-\u001f\u007f]/.test(model) || apiKey && /[^\x21-\x7e]/.test(apiKey)) throw new Error("模型配置含无效字符");
    const release = await acquireInstanceLock(path.join(this.root, "data"), "desktop-config");
    try {
      const env = await this.readEnvironment();
      Object.assign(env, { CHAT_API_URL: apiUrl.trim(), CHAT_MODEL: model.trim() });
      if (clearKey) env.CHAT_API_KEY = ""; else if (apiKey) env.CHAT_API_KEY = apiKey;
      await atomicPrivateFile(path.join(this.root, ".env"), serializeEnvironment(env));
    } finally { await release(); }
    return this.configuration();
  }
  async start() {
    if (this.state === "running") return this.status();
    if (this.state !== "stopped") throw new Error(this.issue || "工作台正在操作中");
    const env = await this.readEnvironment();
    const webPort = await availablePort(this.ports.web), mcpPort = await availablePort(this.ports.mcp);
    const release = await acquireInstanceLock(path.join(this.root, "data"), "desktop-services");
    this.release = release; this.state = "starting"; this.issue = "";
    const common = { ...env, NODE_ENV: "production", LOG_ROOT: path.join(this.root, "data"), INDEX_ROOT: path.join(this.root, "index"),
      BACKUP_ROOT: path.join(this.root, "backups"), COOKIE_SECURE: "false", NEXT_TELEMETRY_DISABLED: "1" };
    // Credentials are fresh for this run and travel only through inherited env/IPC.
    const token = crypto.randomBytes(32).toString("base64url");
    try {
      const mcp = launch("mcp", this.mcpRoot, { ...common, MCP_HTTP_PORT: String(mcpPort), MCP_HTTP_TOKEN: token }, this.workerOptions);
      this.processes.push(mcp); await mcp.ready;
      const web = launch("web", this.webRoot, { ...common, PORT: String(webPort), HOSTNAME: "127.0.0.1", STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`, STUDY_LOG_MCP_TOKEN: token }, this.workerOptions);
      this.processes.push(web); await web.ready;
      this.state = "running"; this.url = `http://127.0.0.1:${webPort}/study-log`;
      for (const service of this.processes) service.ended.then(() => {
        if (this.state === "running") {
          this.state = "failed"; this.issue = errorText; this.url = null;
          for (const other of this.processes) if (other !== service) void other.stop().catch(() => {});
        }
      });
      return this.status();
    } catch (error) {
      await Promise.allSettled(this.processes.map(item => item.stop()));
      this.state = "failed"; this.issue = errorText; throw new Error(`${error.message}；${errorText}`);
    }
  }
  async stop() {
    if (this.state === "stopped") return this.status();
    const failed = this.state === "failed"; this.state = "stopping";
    try {
      // Web first: allow in-flight writes/RAG to finish with MCP still available.
      const failures = [];
      for (const item of [...this.processes].reverse()) {
        try { await item.stop(); } catch (error) { failures.push(error); }
      }
      if (failed || failures.length) throw new Error(errorText);
      await this.release(); this.release = null; this.processes = []; this.state = "stopped"; this.url = null;
      return this.status();
    } catch (error) { this.state = "failed"; this.issue = errorText; throw error; }
  }
  async backup(archive) { await this.stop(); return backupInstance(this.root, archive, { protectFile: privateFile }); }
  async shutdown() {
    try { return await this.stop(); }
    catch {
      // A crashed worker still leaves its instance lock, but the launcher can
      // exit once every owned process has actually ended. No lock recovery here.
      await Promise.allSettled(this.processes.map(item => item.stop()));
      return this.status();
    }
  }
  async verify(archive) { const result = await verifyArchive(archive); return { verified: true, files: result.manifest.entries.length, archive: result.archive }; }
  async restore(archive, root) {
    await this.stop(); root = await this.rootPath(root);
    const result = await restoreInstance(archive, root, { onReserved: privateDirectory });
    await this.select({ root }); return { ...result, ...this.status() };
  }
}
