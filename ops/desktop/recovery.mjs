import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { assertNoLinks } from "../instance.mjs";
import { atomicPrivateFile, privateDirectory } from "./security.mjs";

const execute = promisify(execFile);
let identity;
async function machineIdentity() {
  return identity ??= execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; @{machine=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid; user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); processStarted=(Get-Process -Id $env:STUDY_LOG_OWNER_PID).StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress"
  ], { windowsHide: true, timeout: 15000, env: { ...process.env, STUDY_LOG_OWNER_PID: String(process.pid) } }).then(({ stdout }) => {
    const value = JSON.parse(stdout);
    if (!value.machine || !value.user || !Number.isFinite(Date.parse(value.boot))) throw Error("无法确认本机运行状态，请重试。");
    return { host: crypto.createHash("sha256").update(value.machine + value.user).digest("hex"), boot: value.boot, processStarted: value.processStarted };
  }).catch(error => { identity = undefined; throw error; });
}

export async function desktopOwnership(data) {
  if (process.platform !== "win32") return undefined;
  await assertNoLinks(data);
  const root = (await fs.realpath(data)).toLowerCase();
  // Recovery is local to this machine/account and this exact data directory.
  if (!/^[a-z]:\\/.test(root)) return undefined;
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq $env:STUDY_LOG_RECOVERY_DRIVE }).DriveType"
  ], { windowsHide: true, timeout: 15000, env: { ...process.env, STUDY_LOG_RECOVERY_DRIVE: path.parse(root).root.slice(0, 2) } });
  if (stdout.trim() !== "3") return undefined;
  const instance = JSON.parse(await fs.readFile(path.join(data, ".instance.json"), "utf8"));
  return { schema: 1, ...await machineIdentity(), root, instance: instance.id, workers: [] };
}

export async function registerDesktopWorker(data, pid) {
  const file = path.join(data, ".instance-operation.lock", "owner.json");
  const owner = JSON.parse(await fs.readFile(file, "utf8"));
  if (owner.pid !== process.pid || owner.operation !== "desktop-services") throw Error("运行状态发生变化，请重新打开工作台。");
  if (!owner.desktop) return;
  const worker = (await processStamps([pid]))[0];
  if (!worker) throw Error("本地服务未能启动，请重试。");
  owner.desktop.workers.push(worker);
  await atomicPrivateFile(file, JSON.stringify(owner));
}

async function processStamps(pids) {
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; $ids=@($env:STUDY_LOG_RECOVERY_PIDS.Split(',') | ForEach-Object { [int]$_ }); $items=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $ids } | ForEach-Object { @{pid=[int]$_.ProcessId; started=$_.CreationDate.ToUniversalTime().ToString('o')} }); ConvertTo-Json -InputObject $items -Compress"
  ], { windowsHide: true, timeout: 15000, env: { ...process.env, STUDY_LOG_RECOVERY_PIDS: pids.join(",") } });
  return JSON.parse(stdout);
}

// A kernel-held file handle serializes recovery attempts and disappears on crash.
// The guard file itself is harmless; its existence is never treated as a lock.
async function recoveryGuard(root) {
  const file = path.join(root, ".desktop-recovery.guard");
  await assertNoLinks(file);
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; try { $f=[IO.File]::Open($env:STUDY_LOG_RECOVERY_GUARD,'OpenOrCreate','ReadWrite','None') } catch { exit 3 }; try { [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }"
  ], { windowsHide: true, env: { ...process.env, STUDY_LOG_RECOVERY_GUARD: file }, stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.on("error", () => {});
  const ended = new Promise(resolve => { child.once("error", () => resolve()); child.once("close", resolve); });
  const ready = await new Promise(resolve => {
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; if (output.includes("ready")) resolve(true); });
    ended.then(() => resolve(false));
  });
  if (!ready) return null;
  return async () => { child.stdin.end("done\n"); await ended; };
}

async function checkWrites(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error("保存路径包含目录联接，暂时无法自动恢复。");
    if (entry.name === ".pending-write.json" || /\.(tmp|partial)$/.test(entry.name)) throw Error("上次保存尚未完成，已保留原文件。请先检查学习记录后再打开。");
    if (entry.isDirectory() && entry.name !== ".instance-operation.lock") await checkWrites(path.join(directory, entry.name));
  }
}

export async function recoverDesktopLock(data) {
  if (process.platform !== "win32") return false;
  const lock = path.join(data, ".instance-operation.lock");
  if (!await fs.lstat(lock).catch(error => { if (error.code === "ENOENT") return null; throw error; })) return false;
  await assertNoLinks(lock);
  const current = await desktopOwnership(data);
  if (!current) return false;
  const release = await recoveryGuard(path.dirname(data));
  if (!release) throw Error("工作台正在检查这个保存位置，请稍后再打开。");
  try {
    const stat = await fs.lstat(lock).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return false;
    const file = path.join(lock, "owner.json");
    await assertNoLinks(file);
    const ownerStat = await fs.stat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!ownerStat || ownerStat.size > 4096) return false;
    const bytes = await fs.readFile(file);
    let owner;
    try { owner = JSON.parse(bytes); } catch { return false; }
    const previous = owner.desktop;
    if (owner.operation !== "desktop-services" || !/^[a-f0-9-]{36}$/.test(owner.ownerId || "") || previous?.schema !== 1 ||
      previous.host !== current.host || previous.root !== current.root || previous.instance !== current.instance ||
      !Number.isSafeInteger(owner.pid) || owner.pid < 1 || !Number.isFinite(Date.parse(previous.processStarted)) ||
      !Array.isArray(previous.workers) || previous.workers.length > 2 || previous.workers.some(w => !Number.isSafeInteger(w.pid) || w.pid < 1 || !Number.isFinite(Date.parse(w.started)))) return false;
    if (previous.boot !== current.boot && !(Date.parse(previous.boot) < Date.parse(current.boot) && Date.parse(owner.startedAt) < Date.parse(current.boot))) return false;
    const expected = [{ pid: owner.pid, started: previous.processStarted }, ...previous.workers];
    const running = await processStamps(expected.map(p => p.pid));
    if (running.some(p => expected.some(old => old.pid === p.pid && Date.parse(old.started) === Date.parse(p.started)))) throw Error("这个保存位置正在使用，请先关闭正在使用它的工作台。");
    await checkWrites(data);
    if ((await fs.readdir(lock)).some(name => name !== "owner.json")) return false;
    const history = path.join(path.dirname(data), ".desktop-recovery");
    await privateDirectory(history);
    const target = path.join(history, owner.ownerId);
    if (await fs.lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error; })) return false;
    const finalStat = await fs.lstat(lock);
    if (finalStat.ino !== stat.ino || finalStat.dev !== stat.dev || !(await fs.readFile(file)).equals(bytes)) throw Error("运行状态发生变化，请重新打开工作台。");
    // Preserve evidence, never touch or rewrite the authoritative learning files.
    await fs.rename(lock, target);
    return true;
  } finally { await release(); }
}
