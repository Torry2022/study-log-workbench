import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { parseEnv } from "node:util";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { DesktopManager } from "./manager.mjs";
import { startLauncher } from "./launcher.mjs";
import { backupInstance, restoreInstance } from "../archive.mjs";
import { privateDirectory } from "./security.mjs";

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-desktop-test-"));
  const packageRoot = path.join(base, "package"), root = path.join(base, "instance"), stateRoot = path.join(base, "state");
  await fs.mkdir(packageRoot);
  const worker = path.join(base, "worker.mjs");
  await fs.writeFile(worker, `import http from 'node:http'; import fs from 'node:fs/promises'; import path from 'node:path';
    const kind=process.argv[2]; const server=http.createServer(async(req,res)=>{ if(req.url==='/slow'){await new Promise(r=>setTimeout(r,250)); await fs.writeFile(path.join(process.env.LOG_ROOT,'completed'),'done');} res.end('ok'); });
    server.listen(Number(kind==='web'?process.env.PORT:process.env.MCP_HTTP_PORT),'127.0.0.1',()=>process.send({type:'ready'}));
    process.on('message',async m=>{if(m.type==='stop'){if(kind==='web'&&await fs.stat(path.join(process.env.LOG_ROOT,'crash-on-stop')).catch(()=>null))process.exit(7);server.close(()=>process.disconnect());}});
    process.on('disconnect',()=>server.close());`);
  const manager = new DesktopManager({ packageRoot, worker });
  t.after(async () => {
    await manager.stop().catch(() => {});
    assert.equal(path.dirname(base), path.resolve(os.tmpdir())); assert.match(path.basename(base), /^study-log-desktop-test-/);
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, packageRoot, root, stateRoot, manager, worker };
}

test("create/open boundaries, configured password, model key retention and no raw key in configuration", async t => {
  const { manager, root, packageRoot, base } = await fixture(t);
  await assert.rejects(manager.select({ root: packageRoot, create: true, password: "synthetic-password" }), /程序目录/);
  await assert.rejects(manager.select({ root: base, create: true, password: "synthetic-password" }), /程序目录/);
  await assert.rejects(manager.select({ root, create: true, password: "short" }), /12/);
  await assert.rejects(manager.select({ root, create: true, password: "change-me-password" }), /占位/);
  await manager.select({ root, create: true, password: "synthetic-password" });
  assert.equal(parseEnv(await fs.readFile(path.join(root, ".env"), "utf8")).APP_PASSWORD, "synthetic-password");
  await assert.rejects(manager.select({ root, create: true, password: "synthetic-password" }), /空目录/);
  await manager.select({ root });
  await manager.configure({ apiUrl: "https://example.test/v1/chat/completions", model: "synthetic-model", apiKey: "synthetic-key" });
  assert.deepEqual(await manager.configuration(), { apiUrl: "https://example.test/v1/chat/completions", model: "synthetic-model", hasKey: true });
  await manager.configure({ apiUrl: "", model: "", apiKey: "" });
  assert.equal((await manager.configuration()).hasKey, true);
  await manager.configure({ clearKey: true });
  assert.equal((await manager.configuration()).hasKey, false);
});

test("IPC stop drains an actual in-flight write before releasing lock; restart and backup/restore preserve data", async t => {
  const { manager, root, base } = await fixture(t);
  await manager.select({ root, create: true, password: "synthetic-password" });
  await fs.writeFile(path.join(root, "data", "2026-10_学习日志.md"), "## 2026-10-06\n\n### 1. 合成资料\n\n事务先完成再退出。\n");
  await manager.start(); assert.equal(manager.state, "running");
  const request = fetch(new URL("/slow", manager.url)).then(r => r.text());
  await new Promise(resolve => setTimeout(resolve, 60));
  const stopping = manager.stop();
  assert.ok(await fs.stat(path.join(root, "data", ".instance-operation.lock")));
  assert.equal(await request, "ok"); await stopping;
  assert.equal(await fs.readFile(path.join(root, "data", "completed"), "utf8"), "done");
  await assert.rejects(fs.stat(path.join(root, "data", ".instance-operation.lock")), { code: "ENOENT" });
  await manager.start(); assert.equal(manager.state, "running");
  const archive = path.join(base, "synthetic.slwb"); await manager.backup(archive);
  assert.equal(manager.state, "stopped"); assert.equal((await manager.verify(archive)).verified, true);
  await assert.rejects(manager.restore(archive, root));
  const restored = path.join(base, "restored"); await manager.restore(archive, restored);
  assert.equal(await fs.readFile(path.join(restored, "data", "2026-10_学习日志.md"), "utf8"), await fs.readFile(path.join(root, "data", "2026-10_学习日志.md"), "utf8"));
});

test("abnormal worker termination preserves instance lock and blocks restart", async t => {
  const { manager, root } = await fixture(t);
  await manager.select({ root, create: true, password: "synthetic-password" }); await manager.start();
  // Deliberate fault injection, never used by the application's stop path.
  manager.processes[1].child.kill(); await manager.processes[1].ended;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(manager.state, "failed");
  await assert.rejects(manager.stop(), /实例锁/);
  assert.ok(await fs.stat(path.join(root, "data", ".instance-operation.lock")));
  await assert.rejects(manager.start(), /实例锁/);
});

test("port occupation fails before taking the instance lock", async t => {
  const { manager, root } = await fixture(t);
  await manager.select({ root, create: true, password: "synthetic-password" });
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  manager.ports.web = listener.address().port;
  await assert.rejects(manager.start(), { code: "EADDRINUSE" });
  await assert.rejects(fs.stat(path.join(root, "data", ".instance-operation.lock")), { code: "ENOENT" });
});

test("stop still closes MCP when Web crashes during draining, and preserves the lock", async t => {
  const { manager, root } = await fixture(t);
  await manager.select({ root, create: true, password: "synthetic-password" }); await manager.start();
  await fs.writeFile(path.join(root, "data", "crash-on-stop"), "synthetic fault");
  await assert.rejects(manager.stop(), /实例锁/);
  assert.equal((await manager.processes[0].ended).code, 0);
  assert.equal(manager.state, "failed");
  assert.ok(await fs.stat(path.join(root, "data", ".instance-operation.lock")));
  await manager.shutdown();
});

test("backup/restore protection runs before any secret bytes and failed ACL cannot expose credentials", async t => {
  const { manager, root, base } = await fixture(t);
  await manager.select({ root, create: true, password: "synthetic-password" });
  const failed = path.join(base, "acl-denied.slwb"); let partial;
  await assert.rejects(backupInstance(root, failed, { protectFile: async file => { partial = file; assert.equal((await fs.stat(file)).size, 0); throw new Error("synthetic ACL failure"); } }), /未完成/);
  assert.equal((await fs.stat(partial)).size, 0);
  const archive = path.join(base, "valid.slwb"); await manager.backup(archive);
  const target = path.join(base, "restore-denied");
  await assert.rejects(restoreInstance(archive, target, { onReserved: async directory => { assert.deepEqual(await fs.readdir(directory), []); throw new Error("synthetic ACL failure"); } }), /未完成/);
  assert.deepEqual(await fs.readdir(target), []);
});

test("Windows denies unwritable directories and restricts saved credentials to the current account", { skip: process.platform !== "win32" }, async t => {
  const { manager, root, base } = await fixture(t), execute = promisify(execFile);
  const blocked = path.join(base, "blocked"); await privateDirectory(blocked);
  const deny = "$ErrorActionPreference='Stop'; $p=$env:STUDY_LOG_ACL_TEST; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.Directory]::GetAccessControl($p); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'CreateDirectories,CreateFiles','ContainerInherit,ObjectInherit','None','Deny'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($p,$acl)";
  try {
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", deny], { windowsHide: true, env: { ...process.env, STUDY_LOG_ACL_TEST: blocked } });
    await assert.rejects(manager.select({ root: path.join(blocked, "instance"), create: true, password: "synthetic-password" }), error => ["EACCES", "EPERM"].includes(error.code));
  } finally { await privateDirectory(blocked); }
  await manager.select({ root, create: true, password: "synthetic-password" });
  const check = "$acl=[System.IO.File]::GetAccessControl($env:STUDY_LOG_ACL_TEST); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); [Console]::Write(($acl.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference -eq $sid).ToString())";
  const result = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", check], { windowsHide: true, env: { ...process.env, STUDY_LOG_ACL_TEST: path.join(root, ".env") } });
  assert.equal(result.stdout, "True");
});

test("authenticated loopback control, strict origins, duplicate launcher reuse, and graceful close", async t => {
  const { manager, packageRoot, stateRoot, root } = await fixture(t);
  const launcher = await startLauncher({ manager, packageRoot, stateRoot, openBrowser: false });
  t.after(() => launcher.close());
  assert.equal((await fetch(`${launcher.origin}/api/status`)).status, 401);
  const headers = { Authorization: `Bearer ${launcher.token}`, "Content-Type": "application/json" };
  assert.equal((await fetch(`${launcher.origin}/api/select`, { method: "POST", headers: { ...headers, Origin: "https://evil.invalid" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${launcher.origin}/api/select`, { method: "POST", headers, body: "{}" })).status, 403);
  const response = await fetch(`${launcher.origin}/api/select`, { method: "POST", headers: { ...headers, Origin: launcher.origin }, body: JSON.stringify({ root, create: true, password: "synthetic-password" }) });
  assert.equal(response.status, 200, await response.text());
  const reused = await startLauncher({ packageRoot, stateRoot, openBrowser: false }); assert.equal(reused.reused, true); assert.equal(reused.origin, launcher.origin);
  await launcher.close();
  await assert.rejects(fs.stat(path.join(stateRoot, "launcher.lock")), { code: "ENOENT" });
});

test("unused browser preconnection cannot keep the stopped launcher locked", { timeout: 10000 }, async t => {
  const { manager, packageRoot, stateRoot } = await fixture(t);
  const launcher = await startLauncher({ manager, packageRoot, stateRoot, openBrowser: false });
  const socket = net.connect({ port: Number(new URL(launcher.origin).port), host: "127.0.0.1", allowHalfOpen: true });
  t.after(async () => { socket.destroy(); await launcher.close(); });
  await new Promise(resolve => socket.once("connect", resolve));
  socket.resume();
  await launcher.close();
  await assert.rejects(fs.stat(path.join(stateRoot, "launcher.lock")), { code: "ENOENT" });
});

test("launcher waits for an accepted request body and closes its connection after responding", { timeout: 10000 }, async t => {
  const { manager, packageRoot, stateRoot } = await fixture(t);
  const launcher = await startLauncher({ manager, packageRoot, stateRoot, openBrowser: false });
  const address = new URL(launcher.origin);
  const socket = net.connect(Number(address.port), "127.0.0.1");
  t.after(async () => { socket.destroy(); await launcher.close(); });
  await new Promise(resolve => socket.once("connect", resolve));
  let response = ""; socket.on("data", bytes => response += bytes.toString());
  socket.write(`POST /api/configuration HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: ${launcher.origin}\r\nAuthorization: Bearer ${launcher.token}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{`);
  await new Promise(resolve => setTimeout(resolve, 50));
  let finished = false;
  const closed = launcher.close().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(finished, false, "Do not interrupt an already accepted HTTP request");
  const disconnected = new Promise(resolve => socket.once("close", resolve));
  socket.write("}"); await closed; await disconnected;
  assert.match(response, /HTTP\/1\.1 400/);
  assert.match(response, /启动入口正在退出/);
  await assert.rejects(fs.stat(path.join(stateRoot, "launcher.lock")), { code: "ENOENT" });
});

test("accepted exit rejects queued and new start requests while the active service write drains", async t => {
  const { manager, packageRoot, stateRoot, root } = await fixture(t);
  await manager.select({ root, create: true, password: "synthetic-password" }); await manager.start();
  const launcher = await startLauncher({ manager, packageRoot, stateRoot, openBrowser: false });
  t.after(() => launcher.close());
  const headers = { Authorization: `Bearer ${launcher.token}`, "Content-Type": "application/json", Origin: launcher.origin };
  const write = fetch(new URL("/slow", manager.url)).then(response => response.text());
  await new Promise(resolve => setTimeout(resolve, 40));
  let unblock; const blocked = manager.operation(() => new Promise(resolve => { unblock = resolve; }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const queuedStart = fetch(`${launcher.origin}/api/start`, { method: "POST", headers, body: "{}" });
  await new Promise(resolve => setTimeout(resolve, 10));
  const exiting = fetch(`${launcher.origin}/api/exit`, { method: "POST", headers, body: "{}" });
  for (let i = 0; i < 30; i++) {
    const status = await (await fetch(`${launcher.origin}/api/status`, { headers })).json();
    if (status.closing) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await fetch(`${launcher.origin}/api/start`, { method: "POST", headers, body: "{}" })).status, 503);
  unblock(); await blocked;
  assert.equal((await queuedStart).status, 400);
  assert.equal((await exiting).status, 200); assert.equal(await write, "ok");
  await launcher.close(); assert.equal(manager.state, "stopped");
});

test("directory inspection is read-only and distinguishes new, existing, unrelated and locked directories", async t => {
  const { manager, root, base, packageRoot } = await fixture(t);
  assert.equal((await manager.inspect(root)).kind, "new");
  assert.equal(await fs.stat(root).catch(() => null), null);
  await fs.mkdir(root);
  assert.equal((await manager.inspect(root)).kind, "new");
  assert.deepEqual(await fs.readdir(root), []);
  const unrelated = path.join(base, "unrelated"); await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, "keep.txt"), "untouched");
  assert.equal((await manager.inspect(unrelated)).kind, "invalid");
  await assert.rejects(manager.select({ root: unrelated, create: true, password: "synthetic-password" }), /已有文件/);
  await assert.rejects(manager.select({ root: unrelated }), /已有文件/);
  assert.equal(await fs.readFile(path.join(unrelated, "keep.txt"), "utf8"), "untouched");
  await assert.rejects(manager.inspect(packageRoot), /程序目录/);
  await manager.select({ root, create: true, password: "synthetic-password" });
  assert.equal((await manager.inspect(root)).kind, "existing");
  await fs.mkdir(path.join(root, "data", ".instance-operation.lock"));
  assert.equal((await manager.inspect(root)).kind, "invalid");
  await assert.rejects(manager.select({ root }), /运行锁/);
  assert.equal((await fs.stat(path.join(root, "data", ".instance-operation.lock"))).isDirectory(), true);
});

test("closing the last stopped launcher page exits automatically; refresh, other tabs and running work are preserved", async t => {
  const { manager, packageRoot, stateRoot, root } = await fixture(t);
  const launcher = await startLauncher({ packageRoot, stateRoot, manager, openBrowser: false });
  t.after(() => launcher.close());
  const headers = { Authorization: `Bearer ${launcher.token}`, Origin: launcher.origin, "Content-Type": "application/json" };
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", c = "33333333-3333-4333-8333-333333333333";
  const visit = id => fetch(`${launcher.origin}/api/status`, { headers: { ...headers, "X-Launcher-Client": id } });
  const leave = id => fetch(`${launcher.origin}/api/leave`, { method: "POST", headers, body: JSON.stringify({ clientId: id }) });
  await visit(a); await visit(b); await leave(a);
  await new Promise(resolve => setTimeout(resolve, 3200));
  assert.equal((await visit(b)).status, 200, "another open tab keeps the launcher alive");
  await leave(b); await visit(c);
  await new Promise(resolve => setTimeout(resolve, 3200));
  assert.equal((await visit(c)).status, 200, "reload connects during grace period");
  await manager.select({ root, create: true, password: "synthetic-password" }); await manager.start();
  await leave(c); await new Promise(resolve => setTimeout(resolve, 3200));
  assert.equal(manager.state, "running", "closing the launcher must not interrupt workspace writes");
  const d = "44444444-4444-4444-8444-444444444444";
  await visit(d); await manager.stop(); await leave(d);
  await visit(d); // late request from the departed page must not resurrect it
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.equal(await fs.stat(path.join(stateRoot, "launcher.lock")).catch(() => null), null);
  assert.equal(await fs.stat(path.join(root, "data", ".instance-operation.lock")).catch(() => null), null);
});
