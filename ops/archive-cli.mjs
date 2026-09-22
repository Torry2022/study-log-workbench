import { backupInstance, verifyArchive, restoreInstance } from "./archive.mjs";

try {
  const [command, first, second, ...extra] = process.argv.slice(2);
  if (extra.length || !["backup", "verify", "restore"].includes(command) || !first || (command === "verify" ? second !== undefined : !second)) {
    throw new Error("用法：node ops/archive-cli.mjs backup 实例绝对路径 新归档绝对路径 | verify 归档绝对路径 | restore 归档绝对路径 不存在的新实例绝对路径");
  }
  let result;
  if (command === "backup") result = await backupInstance(first, second);
  if (command === "restore") result = await restoreInstance(first, second);
  if (command === "verify") {
    const verified = await verifyArchive(first);
    result = { verified: true, archive: verified.archive, sha256: verified.sha256, instanceId: verified.manifest.instanceId, files: verified.manifest.entries.filter(entry => entry.type === "file").length };
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error?.name === "ArchiveError" ? `${error.code}: ${error.message}` : "归档操作失败，请核对命令参数、路径、摘要文件和权限。所有路径必须为绝对路径。");
  process.exitCode = 1;
}
