import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const [packageRoot, reportFile] = process.argv.slice(2);
if (process.platform !== "win32" || !packageRoot || !reportFile || !path.isAbsolute(packageRoot) || !path.isAbsolute(reportFile)) throw new Error("Provide an extracted Windows package and report absolute path");
assert.match(packageRoot, /\s/); assert.match(packageRoot, /[^\x00-\x7f]/);
const key = crypto.createHash("sha256").update(path.resolve(packageRoot).toLowerCase()).digest("hex").slice(0, 20);
const state = path.join(process.env.LOCALAPPDATA, "StudyLogWorkbench", key);
assert.equal(await fs.stat(state).catch(() => null), null, "Use a fresh extraction path; never operate an existing launcher");
const descriptor = path.join(state, "launcher.lock", "control.json");
let control;
try {
  await execute("wscript.exe", [path.join(packageRoot, "启动学习日志.vbs")], { windowsHide: true });
  for (let i = 0; i < 100; i++) {
    try { control = JSON.parse(await fs.readFile(descriptor, "utf8")); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(control, "VBS must launch the bundled Node and publish its private control descriptor");
  const response = await fetch(`${control.origin}/api/status`, { headers: { Authorization: `Bearer ${control.token}` } });
  assert.equal(response.status, 200); assert.equal((await response.json()).launchId, control.launchId);
  const inspect = "$wanted=$env:STUDY_LOG_TEST_NODE; $owners=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $wanted -and $_.CommandLine -like '*ops\\desktop\\launcher.mjs*'}); [Console]::Write($owners.Count)";
  const processes = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", inspect], { windowsHide: true, env: { ...process.env, STUDY_LOG_TEST_NODE: path.join(packageRoot, "runtime", "node.exe") } });
  assert.equal(Number(processes.stdout), 1, "Exactly one packaged launcher process");
  // Inspect only connections to this test launcher; never read browser URLs/tabs.
  const browserCheck = "$names=@(Get-NetTCPConnection -RemotePort ([int]$env:STUDY_LOG_TEST_PORT) -State Established -ErrorAction SilentlyContinue | ForEach-Object {(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName} | Where-Object {$_ -match '^(msedge|chrome|firefox|brave|vivaldi|arc|browser)$'}); [Console]::Write($names.Count -gt 0)";
  let connected = false;
  for (let i = 0; i < 10; i++) {
    const result = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", browserCheck], { windowsHide: true, env: { ...process.env, STUDY_LOG_TEST_PORT: new URL(control.origin).port } });
    if (result.stdout === "True") { connected = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(connected, true, "A default browser process must connect to the launched management page");
  await fs.writeFile(reportFile, JSON.stringify({ passed: ["Real Windows Script Host entry from Chinese/space extraction path", "Bundled Node process and authenticated loopback control", "Default browser process connected to this management listener"], limitation: "Native folder/save dialog confirmation is not automated; visual browser UI is covered by browser-launcher.mjs." }, null, 2));
  console.log(JSON.stringify({ passed: 3, report: reportFile }));
} finally {
  if (control) {
    const response = await fetch(`${control.origin}/api/exit`, { method: "POST", headers: { Authorization: `Bearer ${control.token}`, Origin: control.origin, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    for (let i = 0; i < 100 && await fs.stat(descriptor).catch(() => null); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await fs.stat(descriptor).catch(() => null), null, "VBS-launched controller must remove its own lock after graceful exit");
  }
}
