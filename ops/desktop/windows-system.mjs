import path from "node:path";
import { spawn } from "node:child_process";

// One private pipe amortizes PowerShell initialization across startup checks.
// Requests contain data, never PowerShell source; no network listener is opened.
const script = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
while (($line=[Console]::ReadLine()) -ne $null) {
  try {
    $request=ConvertFrom-Json $line; $value=$null
    switch ($request.operation) {
      'drive' { $value=[int]([IO.DriveInfo]::new([string]$request.value).DriveType) }
      'identity' {
        $value=@{machine=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid; user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); processStarted=(Get-Process -Id ([int]$request.value)).StartTime.ToUniversalTime().ToString('o')}
      }
      'processes' {
        $value=@(foreach ($id in $request.value) {
          try { $item=[Diagnostics.Process]::GetProcessById([int]$id) } catch [ArgumentException] { continue }
          try { @{pid=$item.Id; started=$item.StartTime.ToUniversalTime().ToString('o')} } finally { $item.Dispose() }
        })
      }
      { $_ -in 'directory','file' } {
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
        if ($request.operation -eq 'directory') {
          $acl=New-Object Security.AccessControl.DirectorySecurity
          $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        } else {
          $acl=New-Object Security.AccessControl.FileSecurity
          $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
        }
        $acl.SetAccessRuleProtection($true,$false); $acl.AddAccessRule($rule)
        if ($request.operation -eq 'directory') { [IO.Directory]::SetAccessControl([string]$request.value,$acl) }
        else { [IO.File]::SetAccessControl([string]$request.value,$acl) }
      }
      default { throw 'Unknown operation' }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject @{id=$request.id; value=$value} -Depth 5 -Compress))
  } catch { [Console]::WriteLine((ConvertTo-Json -InputObject @{id=$request.id; error=$true} -Compress)) }
}`;
const operations = new Set(["drive", "identity", "processes", "directory", "file"]);
let helper, sequence = 0;
function createHelper() {
  const child = spawn(path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  const current = { child, pending: new Map(), output: "", idle: null };
  const fail = () => {
    if (helper === current) helper = undefined;
    clearTimeout(current.idle);
    for (const request of current.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Windows 系统检查未完成，请重试。")); }
    current.pending.clear(); child.kill();
  };
  current.fail = fail;
  child.on("error", fail); child.on("close", fail); child.stdin.on("error", fail);
  child.stdout.on("data", chunk => {
    current.output += chunk.toString("utf8");
    if (current.output.length > 131072) { fail(); return; }
    let end;
    while ((end = current.output.indexOf("\n")) !== -1) {
      let response;
      try { response = JSON.parse(current.output.slice(0, end)); } catch { fail(); return; }
      current.output = current.output.slice(end + 1);
      const request = current.pending.get(response.id);
      if (!request) { fail(); return; }
      current.pending.delete(response.id); clearTimeout(request.timer);
      if (response.error) request.reject(new Error("Windows 系统检查未完成，请重试。")); else request.resolve(response.value);
    }
    if (!current.pending.size) {
      child.unref(); child.stdin.unref(); child.stdout.unref();
      current.idle = setTimeout(() => { if (helper === current) helper = undefined; child.stdin.end(); }, 2000);
      current.idle.unref();
    }
  });
  return current;
}

export function windowsSystem(operation, value) {
  if (process.platform !== "win32" || !operations.has(operation)) return Promise.reject(new Error("Unsupported Windows operation"));
  const current = helper ??= createHelper(), id = ++sequence;
  clearTimeout(current.idle);
  current.child.ref(); current.child.stdin.ref(); current.child.stdout.ref();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(current.fail, 15000);
    current.pending.set(id, { resolve, reject, timer });
    current.child.stdin.write(JSON.stringify({ id, operation, value }) + "\n");
  });
}
