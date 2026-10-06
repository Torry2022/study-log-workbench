import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertNoLinks } from "../instance.mjs";
const execute = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Fixed LTS release. Hash is from the official release's SHASUMS256.txt,
// https://nodejs.org/dist/v22.23.3/SHASUMS256.txt (verified 2026-10-06).
export const runtime = Object.freeze({ version: "22.23.3", archive: "node-v22.23.3-win-x64.zip",
  sha256: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
  executableSha256: "9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e" });

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const safeCopy = source => !/^\.env(?:\.|$)/i.test(path.basename(source)) && ![".local", ".git"].includes(path.basename(source));

export async function packageWindows(output, { cache = path.join(repository, ".local", "windows-runtime") } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("请在 Windows x64 上构建此安装包");
  if (!output || !path.isAbsolute(output)) throw new Error("请指定新的输出绝对路径");
  await assertNoLinks(output);
  if (await fs.lstat(output).catch(() => null)) throw new Error("输出目录已存在；请使用新目录，不覆盖已有包");
  const standalone = path.join(repository, "study-log-web", ".next-build-cache", "standalone");
  await fs.access(path.join(standalone, ".next-build-cache", "BUILD_ID"));
  await assertNoLinks(cache); await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, runtime.archive);
  let bytes = await fs.readFile(archive).catch(() => null);
  if (!bytes) {
    const download = `${archive}.${crypto.randomUUID()}.download`;
    // Respect the builder's configured proxy. Node's native fetch does not use
    // HTTPS_PROXY on all supported versions; the shipped app needs no download.
    const script = "$ErrorActionPreference='Stop'; $client=New-Object System.Net.WebClient; if($env:HTTPS_PROXY){$client.Proxy=New-Object System.Net.WebProxy($env:HTTPS_PROXY)}; try{$client.DownloadFile($env:STUDY_LOG_NODE_URL,$env:STUDY_LOG_NODE_DOWNLOAD)}finally{$client.Dispose()}";
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 180000, env: { ...process.env, STUDY_LOG_NODE_URL: `https://nodejs.org/dist/v${runtime.version}/${runtime.archive}`, STUDY_LOG_NODE_DOWNLOAD: download } });
    bytes = await fs.readFile(download);
    if (sha256(bytes) !== runtime.sha256) throw new Error("Node 运行时校验失败");
    await fs.link(download, archive); await fs.unlink(download);
  }
  if (sha256(bytes) !== runtime.sha256) throw new Error("Node 缓存校验失败；请检查下载文件，不会使用未核验运行时");
  const extracted = path.join(cache, `node-v${runtime.version}-win-x64`);
  if (!(await fs.stat(path.join(extracted, "node.exe")).catch(() => null))) {
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:STUDY_LOG_NODE_ARCHIVE,$env:STUDY_LOG_NODE_CACHE)"], { windowsHide: true, env: { ...process.env, STUDY_LOG_NODE_ARCHIVE: archive, STUDY_LOG_NODE_CACHE: cache } });
  }
  if (sha256(await fs.readFile(path.join(extracted, "node.exe"))) !== runtime.executableSha256) throw new Error("Node 可执行文件校验失败");
  await fs.mkdir(output);
  await fs.mkdir(path.join(output, "runtime"));
  for (const name of ["node.exe", "LICENSE"]) await fs.copyFile(path.join(extracted, name), path.join(output, "runtime", name));
  await fs.cp(standalone, path.join(output, "web"), { recursive: true, dereference: true, filter: safeCopy });
  await fs.cp(path.join(repository, "study-log-web", ".next-build-cache", "static"), path.join(output, "web", ".next-build-cache", "static"), { recursive: true });
  await fs.cp(path.join(repository, "study-log-web", "public"), path.join(output, "web", "public"), { recursive: true });
  await fs.copyFile(path.join(repository, "study-log-web", "app", "icon.svg"), path.join(output, "web", "public", "icon.svg"));
  for (const name of ["src", "node_modules", "package.json", "package-lock.json"]) {
    await fs.cp(path.join(repository, "study-log-mcp", name), path.join(output, "mcp", name), { recursive: true, dereference: true, filter: safeCopy });
  }
  await fs.cp(path.join(repository, "prompts"), path.join(output, "prompts"), { recursive: true });
  for (const name of ["instance.mjs", "service.mjs", "archive.mjs"]) {
    await fs.mkdir(path.join(output, "ops"), { recursive: true });
    await fs.copyFile(path.join(repository, "ops", name), path.join(output, "ops", name));
  }
  await fs.mkdir(path.join(output, "ops", "desktop"));
  for (const name of ["worker.mjs", "security.mjs", "manager.mjs", "launcher.mjs", "index.html", "ui.js", "ui.css"]) {
    await fs.copyFile(path.join(repository, "ops", "desktop", name), path.join(output, "ops", "desktop", name));
  }
  await fs.copyFile(path.join(repository, "LICENSE"), path.join(output, "LICENSE"));
  await fs.copyFile(path.join(repository, "THIRD_PARTY_NOTICES.md"), path.join(output, "THIRD_PARTY_NOTICES.md"));
  const guides = ["windows-portable.md", "maintenance.md", "backup-restore.md", "ai-configuration.md", "notes-storage.md"];
  await fs.mkdir(path.join(output, "docs"));
  for (const name of guides) {
    const source = await fs.readFile(path.join(repository, "docs", name), "utf8");
    // Keep operational links usable offline without bundling development history.
    const offline = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (link, label, target) =>
      /^(?:https?:|#)/.test(target) || guides.includes(target.split("#")[0]) ? link : `${label}（源码仓库文档：${target}）`);
    await fs.writeFile(path.join(output, "docs", name), offline);
  }
  // Script host starts Node invisibly: no terminal remains open while using the UI.
  const launcher = 'Set shell = CreateObject("WScript.Shell")\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\nroot = fso.GetParentFolderName(WScript.ScriptFullName)\r\nshell.Run Chr(34) & root & "\\runtime\\node.exe" & Chr(34) & " " & Chr(34) & root & "\\ops\\desktop\\launcher.mjs" & Chr(34), 0, False\r\n';
  await fs.writeFile(path.join(output, "启动学习日志.vbs"), Buffer.from("\ufeff" + launcher, "utf16le"));
  await fs.writeFile(path.join(output, "使用说明.txt"), "双击“启动学习日志.vbs”，在本地页面选择资料目录并设置密码。无需安装 Node 或 Docker。\r\n程序目录与资料目录须分开；没有模型也能使用日志。默认仅本机访问。\r\n在启动页面点击“退出启动入口”可正常停止服务；关闭浏览器不会停止服务。\r\n若系统禁用 Windows Script Host，可运行 runtime\\node.exe ops\\desktop\\launcher.mjs。\r\n不要删除异常退出后保留的实例锁；先确认服务状态并检查资料。\r\n备份含配置和密钥，请存放在可信位置；恢复到新的目录。\r\n本机使用说明：docs\\windows-portable.md；异常退出处理：docs\\maintenance.md；备份恢复：docs\\backup-restore.md。可用文本编辑器打开。\r\n");
  const version = JSON.parse(await fs.readFile(path.join(repository, "study-log-web", "package.json"), "utf8"));
  await fs.writeFile(path.join(output, "package-manifest.json"), JSON.stringify({ format: "study-log-windows", version: version.version, platform: "win32-x64", node: runtime,
    nodeSource: `https://nodejs.org/dist/v${runtime.version}/`, builtAt: new Date().toISOString(), webBuild: (await fs.readFile(path.join(standalone, ".next-build-cache", "BUILD_ID"), "utf8")).trim() }, null, 2));
  const zip = `${output}.zip`;
  if (await fs.lstat(zip).catch(() => null)) throw new Error("同名 zip 已存在，不覆盖；已生成目录包");
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:STUDY_LOG_PACKAGE_ROOT,$env:STUDY_LOG_PACKAGE_ZIP,[System.IO.Compression.CompressionLevel]::Optimal,$true)"], { windowsHide: true, env: { ...process.env, STUDY_LOG_PACKAGE_ROOT: output, STUDY_LOG_PACKAGE_ZIP: zip }, maxBuffer: 1024 * 1024 });
  const digest = sha256(await fs.readFile(zip)); await fs.writeFile(`${zip}.sha256`, `${digest}\n`, { flag: "wx" });
  return { output, archive: zip, sha256: digest, node: runtime.version };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await packageWindows(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
