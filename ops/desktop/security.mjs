import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertNoLinks } from "../instance.mjs";
const execute = promisify(execFile);
let windowsUser;

export async function privateDirectory(directory) {
  await assertNoLinks(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") { await fs.chmod(directory, 0o700); return; }
  // PowerShell receives the path through an environment value, never source text.
  const script = "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:STUDY_LOG_PRIVATE_DIRECTORY,$acl)";
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, env: { ...process.env, STUDY_LOG_PRIVATE_DIRECTORY: path.resolve(directory) }
  });
}

export async function atomicPrivateFile(file, contents) {
  await assertNoLinks(file);
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    if (process.platform === "win32") {
      const system = path.join(process.env.SystemRoot, "System32");
      const sid = await (windowsUser ??= execute(path.join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { windowsHide: true }).then(({ stdout }) => {
        const match = /"(S-\d(?:-\d+)+)"\s*$/.exec(stdout.trim());
        if (!match) throw new Error("无法确认当前用户的文件权限");
        return match[1];
      }));
      // Only this exclusively created, still-empty temporary file takes the fast path.
      // Its inherited entries are removed before the current user receives access and any contents are written.
      await assertNoLinks(temporary);
      await execute(path.join(system, "icacls.exe"), [temporary, "/inheritance:r", "/grant:r", `*${sid}:(F)`, "/q"], { windowsHide: true });
    } else await privateFile(temporary);
    await handle.writeFile(contents); await handle.sync(); await handle.close();
    await fs.rename(temporary, file);
  } catch (error) { await handle.close().catch(() => {}); await fs.unlink(temporary); throw error; }
}

/** Apply before writing credentials/archives; Windows ignores POSIX mode bits. */
export async function privateFile(file) {
  await assertNoLinks(file);
  if (process.platform !== "win32") { await fs.chmod(file, 0o600); return; }
  const script = "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'); $acl.AddAccessRule($rule); [System.IO.File]::SetAccessControl($env:STUDY_LOG_PRIVATE_FILE,$acl)";
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, STUDY_LOG_PRIVATE_FILE: file } });
}

export function runtimeEnvironment(extra = {}) {
  const allowed = ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PATH", "Path", "COMSPEC", "PATHEXT", "HOME"];
  return Object.fromEntries([...allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]), ...Object.entries(extra)]);
}
