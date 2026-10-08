import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DesktopManager } from "./manager.mjs";
import { privateDirectory, atomicPrivateFile } from "./security.mjs";
import { assertNoLinks } from "../instance.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
function browser(url) {
  if (process.platform !== "win32") return;
  void execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:STUDY_LOG_OPEN_URL"], {
    windowsHide: true, env: { ...process.env, STUDY_LOG_OPEN_URL: url }
  }).catch(() => {});
}
async function pick(mode) {
  if (process.platform !== "win32") throw new Error("请在输入框填写绝对路径");
  const dialogs = {
    folder: "$dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='选择学习记录的保存位置'; $dialog.ShowNewFolderButton=$true; if($dialog.ShowDialog() -eq 'OK'){ [Console]::Write($dialog.SelectedPath) }",
    archive: "$dialog=New-Object System.Windows.Forms.OpenFileDialog; $dialog.Filter='学习日志备份 (*.slwb)|*.slwb|全部文件 (*.*)|*.*'; if($dialog.ShowDialog() -eq 'OK'){ [Console]::Write($dialog.FileName) }",
    save: "$dialog=New-Object System.Windows.Forms.SaveFileDialog; $dialog.Filter='学习日志备份 (*.slwb)|*.slwb'; $dialog.FileName='study-log-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.slwb'; if($dialog.ShowDialog() -eq 'OK'){ [Console]::Write($dialog.FileName) }"
  };
  if (!dialogs[mode]) throw new Error("目录选择类型无效");
  const result = await execute("powershell.exe", ["-NoProfile", "-STA", "-Command", "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " + dialogs[mode]], { windowsHide: true });
  return { path: result.stdout.trim() };
}
async function body(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > 16384) throw new Error("请求过大"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function startLauncher({ packageRoot = path.resolve(here, "../.."), stateRoot, manager, openBrowser = true, port = 0,
  assetsRoot = path.join(packageRoot, "web", "public"), iconFile = path.join(assetsRoot, "icon.svg") } = {}) {
  const key = crypto.createHash("sha256").update(path.resolve(packageRoot).toLowerCase()).digest("hex").slice(0, 20);
  stateRoot ??= path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "StudyLogWorkbench", key);
  await privateDirectory(stateRoot);
  const lock = path.join(stateRoot, "launcher.lock"), descriptor = path.join(lock, "control.json");
  const settings = path.join(stateRoot, "settings.json");
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      await assertNoLinks(descriptor);
      const old = JSON.parse(await fs.readFile(descriptor, "utf8"));
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(old.origin) || typeof old.token !== "string") throw new Error();
      const response = await fetch(`${old.origin}/api/status`, { headers: { Authorization: `Bearer ${old.token}` }, redirect: "error", signal: AbortSignal.timeout(2000) });
      const data = await response.json();
      if (!response.ok || data.launchId !== old.launchId) throw new Error();
      if (openBrowser) browser(`${old.origin}/#${old.token}`);
      return { reused: true, origin: old.origin };
    } catch { throw new Error(`上次运行未正常结束，或另一个入口仍在启动。请先检查服务和文件状态，再按维护说明处理。启动锁已保留：${lock}`); }
  }
  manager ??= new DesktopManager({ packageRoot });
  const token = crypto.randomBytes(32).toString("base64url"), launchId = crypto.randomUUID();
  const staticFiles = {
    "/": [path.join(here, "index.html"), "text/html; charset=utf-8"],
    "/ui.js": [path.join(here, "ui.js"), "text/javascript; charset=utf-8"],
    "/ui.css": [path.join(here, "ui.css"), "text/css; charset=utf-8"],
    "/app-logo-light.svg": [path.join(assetsRoot, "app-logo-light.svg"), "image/svg+xml"],
    "/app-logo-dark.svg": [path.join(assetsRoot, "app-logo-dark.svg"), "image/svg+xml"],
    "/icon.svg": [iconFile, "image/svg+xml"],
    "/fonts/Gelasio.ttf": [path.join(assetsRoot, "fonts", "Gelasio.ttf"), "font/ttf"],
    "/fonts/NotoSerifSC-Medium.woff2": [path.join(assetsRoot, "fonts", "NotoSerifSC-Medium.woff2"), "font/woff2"]
  };
  let origin, closing = false;
  const clients = new Set(), departedClients = new Set();
  let idleClose;
  const connections = new Map();
  let listenerClosing = false;
  const reply = (res, status, result) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(result)); };
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return reply(res, 403, { error: "仅允许本机启动入口访问" });
    if (req.method === "GET" && Object.hasOwn(staticFiles, req.url)) {
      const [file, contentType] = staticFiles[req.url];
      try { const contents = await fs.readFile(file); res.setHeader("Content-Type", contentType); res.end(contents); }
      catch { reply(res, 404, { error: "页面资源缺失，请检查程序包是否完整" }); }
      return;
    }
    if (!safeEqual(req.headers.authorization || "", `Bearer ${token}`)) return reply(res, 401, { error: "请通过桌面启动入口重新打开此页面" });
    if (req.method === "GET" && req.url === "/api/status") {
      const client = req.headers["x-launcher-client"];
      if (typeof client === "string" && /^[a-f0-9-]{36}$/i.test(client) && !departedClients.has(client)) { clients.add(client); clearTimeout(idleClose); }
      return reply(res, 200, { ...manager.status(), launchId, closing });
    }
    if (closing) return reply(res, 503, { error: "正在等待保存和服务退出" });
    if (req.method !== "POST" || req.headers.origin !== origin || !/^application\/json(?:;|$)/.test(req.headers["content-type"] || "")) return reply(res, 403, { error: "请求来源或格式无效" });
    try {
      const input = await body(req);
      if (req.url === "/api/leave") {
        const wasPresent = clients.delete(input.clientId);
        if (wasPresent) departedClients.add(input.clientId);
        if (wasPresent && clients.size === 0) {
          clearTimeout(idleClose);
          idleClose = setTimeout(() => {
            // A reload or another tab can reconnect during the grace period.
            // Never terminate running services just because a page was closed.
            void manager.queue.then(() => {
              if (!clients.size && manager.state === "stopped") return close();
            }).catch(() => { process.exitCode = 1; });
          }, 3000);
          idleClose.unref();
        }
        return reply(res, 200, { left: true });
      }
      // Reject newly arriving and already queued work as soon as exit is
      // accepted, while keeping status readable during the service drain.
      if (req.url === "/api/exit") closing = true;
      const result = await manager.operation(async () => {
        if (closing && req.url !== "/api/exit") throw new Error("启动入口正在退出，未执行此操作");
        switch (req.url) {
          case "/api/select": {
            const value = await manager.select(input);
            await atomicPrivateFile(settings, JSON.stringify({ root: manager.root })); return value;
          }
          case "/api/inspect": return manager.inspect(input.root);
          case "/api/configuration": return manager.configuration();
          case "/api/configure": return manager.configure(input);
          case "/api/start": { const started = await manager.start(); if (openBrowser) browser(started.url); return started; }
          case "/api/stop": return manager.stop();
          case "/api/backup": return manager.backup(input.archive);
          case "/api/verify": return manager.verify(input.archive);
          case "/api/restore": {
            const result = await manager.restore(input.archive, input.root);
            await atomicPrivateFile(settings, JSON.stringify({ root: manager.root })); return result;
          }
          case "/api/pick": return pick(input.mode);
          case "/api/exit": { const result = await manager.shutdown(); return { exited: true, issue: result.issue }; }
          default: throw new Error("未知操作");
        }
      });
      reply(res, 200, result);
      if (closing) setImmediate(() => void close());
    } catch (error) { reply(res, 400, { error: error.code === "EACCES" || error.code === "EPERM" ? "目录不可写，请选择当前账户可写的文件夹" : error.message }); }
  });
  server.on("connection", socket => {
    connections.set(socket, 0);
    socket.once("close", () => connections.delete(socket));
  });
  server.on("request", (req, res) => {
    const socket = req.socket;
    connections.set(socket, (connections.get(socket) ?? 0) + 1);
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      if (!connections.has(socket)) return;
      const pending = connections.get(socket) - 1;
      connections.set(socket, pending);
      if (listenerClosing && pending === 0) socket.destroySoon();
    };
    res.once("finish", complete); res.once("close", complete);
  });
  let closed;
  const close = () => closed ??= (async () => {
    closing = true; clearTimeout(idleClose);
    await manager.operation(() => manager.shutdown());
    await new Promise(resolve => {
      listenerClosing = true;
      server.close(resolve);
      // Flush completed responses and close both TCP directions, including
      // speculative connections whose peer does not answer FIN with FIN.
      // Active responses finish first and close their connection in complete().
      for (const [socket, pending] of connections) if (pending === 0) socket.destroySoon();
    });
    const owner = JSON.parse(await fs.readFile(descriptor, "utf8"));
    if (owner.launchId !== launchId) throw new Error("启动锁归属变化，已保留锁");
    await fs.unlink(descriptor); await fs.rmdir(lock);
  })();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    await atomicPrivateFile(descriptor, JSON.stringify({ origin, token, launchId }));
    try {
      await assertNoLinks(settings);
      const saved = JSON.parse(await fs.readFile(settings, "utf8"));
      if (saved.root) await manager.select({ root: saved.root });
    } catch (error) { if (error.code !== "ENOENT") manager.issue = error.message; }
    if (openBrowser) browser(`${origin}/#${token}`);
    return { origin, token, manager, close, reused: false };
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(descriptor).catch(() => {}); await fs.rmdir(lock); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const launcher = await startLauncher();
    if (!launcher.reused) {
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void launcher.close().catch(() => { process.exitCode = 1; }));
    }
  } catch (error) {
    // Hidden startup must still leave a readable failure message, without secrets.
    console.error(error.message);
    if (process.platform === "win32") await execute("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($env:STUDY_LOG_LAUNCH_ERROR,'学习日志工作台')"], { windowsHide: true, env: { ...process.env, STUDY_LOG_LAUNCH_ERROR: error.message } }).catch(() => {});
    process.exitCode = 1;
  }
}
