import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { buildLogExport, ExportInputError, ExportNotFoundError, ExportChangedError, stripNoteMetadata } from "../lib/export-store.ts";
import { exportAssetReferences, rewriteExportAssetLinks } from "../lib/export-assets.ts";
import { createStudyNote } from "../lib/notes-store.ts";
import { NoteRecoveryError } from "../lib/notes-types.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-export-test-"));
  const data = path.join(root, "data"), backups = path.join(root, "backups");
  await fs.mkdir(data); await fs.mkdir(backups);
  const previous = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = data; process.env.BACKUP_ROOT = backups;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-export-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const put = async (relative, content) => { const target = path.join(data, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); };
  return { root, data, backups, put };
}
function unpack(output) {
  const files = new Map();
  for (const entry of new AdmZip(output.buffer).getEntries()) {
    assert.ok(!entry.entryName.startsWith("/") && !entry.entryName.split("/").includes(".."));
    if (!entry.isDirectory) files.set(entry.entryName, entry.getData());
  }
  return files;
}
function exactFiles(files, expected) {
  assert.deepEqual([...files.keys()].sort(), Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) assert.deepEqual(files.get(name), Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8"), name);
}
async function seed(t) {
  const f = await fixture(t);
  const png = Buffer.from([137, 80, 78, 71, 0, 1, 2, 255]);
  const day = "## 2026-01-15\n\n### 1. 中文小节\n\n![图](<./assets/中文 图片.png>)\n\n![复用](./assets/shared.png)\n";
  const second = "## 2026-01-17\n\n### 1. 另一天\n\n![共享](./assets/shared.png)\n\n```md\n![代码示例](./assets/not-referenced.png)\n```\n";
  const monthly = "# 合成月份说明\n\n" + day + "\n---\n\n" + second + "\n---\n";
  const yearly = "# 年度原文件\r\n\r\n## 2025-12-31\r\n\r\n### 1. 年度小节\r\n\r\n![年度](./assets/year.png)\r\n\r\n---\r\n";
  await f.put("2026-01_学习日志.md", monthly); await f.put("2025_学习日志.md", yearly);
  for (const name of ["中文 图片.png", "shared.png", "year.png", "unused.png"]) await f.put(`assets/${name}`, png);
  await f.put(".env", "SYNTHETIC_NOT_EXPORTABLE=fixture");
  await f.put(".study-log-favorites.json", '{"synthetic":"excluded"}');
  await f.put("sessions/synthetic.json", '{"synthetic":"excluded"}');
  await f.put("unrelated.md", "Unrelated synthetic Markdown");
  return { ...f, png, day, monthly, yearly };
}

test("day ZIP decompresses into exactly the selected Markdown and referenced binary assets", async t => {
  const { png, day } = await seed(t);
  const output = await buildLogExport("day", "2026-01-15");
  assert.equal(output.fileName, "2026-01-15.zip"); assert.deepEqual(output.warnings, []);
  exactFiles(unpack(output), {
    "2026-01-15/2026-01-15.md": day,
    "2026-01-15/assets/中文 图片.png": png,
    "2026-01-15/assets/shared.png": png
  });
});

test("file ZIP retains monthly/yearly source bytes and excludes the other source", async t => {
  const { png, monthly, yearly } = await seed(t);
  const month = await buildLogExport("file", "2026-01-15");
  assert.equal(month.fileName, "2026-01_学习日志.zip");
  exactFiles(unpack(month), {
    "2026-01_学习日志/2026-01_学习日志.md": monthly,
    "2026-01_学习日志/assets/中文 图片.png": png,
    "2026-01_学习日志/assets/shared.png": png
  });
  exactFiles(unpack(await buildLogExport("file", "2025-12-31")), {
    "2025_学习日志/2025_学习日志.md": yearly, "2025_学习日志/assets/year.png": png
  });
});

test("all ZIP contains only log source files and their referenced assets, never notes/configuration/favorites/sessions", async t => {
  const { png, monthly, yearly, put, data } = await seed(t);
  await put("随记/2026_随记.md", "synthetic note must not be included by all scope");
  const before = await fs.readFile(path.join(data, "2026-01_学习日志.md"));
  const output = await buildLogExport("all", null), prefix = output.fileName.slice(0, -4);
  exactFiles(unpack(output), {
    [`${prefix}/2025_学习日志.md`]: yearly, [`${prefix}/2026-01_学习日志.md`]: monthly,
    [`${prefix}/assets/中文 图片.png`]: png, [`${prefix}/assets/shared.png`]: png, [`${prefix}/assets/year.png`]: png
  });
  assert.deepEqual(await fs.readFile(path.join(data, "2026-01_学习日志.md")), before);
});

test("notes ZIP removes entry metadata but keeps fenced examples, Chinese names, fields, and working relative images", async t => {
  const { png, put, data } = await seed(t);
  await createStudyNote({ title: "合成随记", body: '记录正文\n\n![图片](../assets/notes/2026/note.png)\n\n```html\n<!-- study-note {"example":true} -->\n```',
    insight: "独立心得", sources: ["普通来源"], tags: ["测试标签"], recordedAt: "2026-01-15T09:00" });
  await put("assets/notes/2026/note.png", png); await put("随记/README.md", "unrelated notes file");
  const original = await fs.readFile(path.join(data, "随记/2026_随记.md"), "utf8");
  const output = await buildLogExport("notes", null), prefix = output.fileName.slice(0, -4);
  const expected = original.replace(/\n\n<!-- study-note \{[^\n]+\} -->\n/, "\n");
  exactFiles(unpack(output), { [`${prefix}/随记/2026_随记.md`]: expected, [`${prefix}/assets/notes/2026/note.png`]: png });
  assert.ok(expected.includes('<!-- study-note {"example":true} -->'));
  assert.ok(!expected.includes('"createdAt"'));
  assert.equal(await fs.readFile(path.join(data, "随记/2026_随记.md"), "utf8"), original);
});

test("API/absolute asset URLs become offline relative paths; reference-style and HTML images are included", async t => {
  const { put } = await fixture(t);
  const markdown = '## 2026-01-15\n\n![接口](/study-log/api/assets/%E5%9B%BE%20%281%29.png?download=1#part)\n\n![引用][ref]\n\n[ref]: /api/assets/ref.png "合成标题"\n\n<img src="/assets/html.png" alt="图">\n';
  await put("2026-01_学习日志.md", markdown);
  for (const name of ["图 (1).png", "ref.png", "html.png"]) await put("assets/" + name, "bytes:" + name);
  const files = unpack(await buildLogExport("day", "2026-01-15"));
  exactFiles(files, {
    "2026-01-15/2026-01-15.md": markdown.replace("/study-log/api/assets/%E5%9B%BE%20%281%29.png", "./assets/%E5%9B%BE%20%281%29.png").replace("/api/assets/ref.png", "./assets/ref.png").replace('src="/assets/html.png"', 'src="./assets/html.png"'),
    "2026-01-15/assets/图 (1).png": "bytes:图 (1).png", "2026-01-15/assets/ref.png": "bytes:ref.png", "2026-01-15/assets/html.png": "bytes:html.png"
  });
  const refs = exportAssetReferences('![note](/api/assets/note.png)', true);
  assert.equal(rewriteExportAssetLinks('![note](/api/assets/note.png)', refs), '![note](../assets/note.png)');
});

test("missing images continue with an explicit archive warning and a deduplicated warning count", async t => {
  const { put } = await fixture(t);
  const markdown = "## 2026-01-15\n\n![缺失](./assets/missing.png)\n\n![重复](./assets/missing.png)\n";
  await put("2026-01_学习日志.md", markdown);
  const output = await buildLogExport("day", "2026-01-15"); assert.equal(output.warnings.length, 1);
  const files = unpack(output);
  assert.deepEqual([...files.keys()].sort(), ["2026-01-15/2026-01-15.md", "2026-01-15/导出说明.txt"].sort());
  assert.equal(files.get("2026-01-15/2026-01-15.md").toString(), markdown);
  assert.match(files.get("2026-01-15/导出说明.txt").toString(), /缺少附件：assets\/missing.png/);
});

test("bad scopes/dates and missing saved days are explicit; empty all/notes archives are valid ZIPs", async t => {
  await fixture(t);
  for (const scope of [null, "", "backup", "../notes"]) await assert.rejects(buildLogExport(scope, null), ExportInputError);
  for (const date of [null, "", "2026-02-30", "../2026-01-01"]) await assert.rejects(buildLogExport("day", date), ExportInputError);
  await assert.rejects(buildLogExport("day", "2026-01-15"), ExportNotFoundError);
  assert.equal(unpack(await buildLogExport("all", null)).size, 0);
  assert.equal(unpack(await buildLogExport("notes", null)).size, 0);
});

test("traversal, encoded traversal, absolute local paths and code examples never read arbitrary files", async t => {
  const { put, root } = await fixture(t);
  await fs.writeFile(path.join(root, "outside.png"), "must not export");
  for (const uri of ["./assets/../outside.png", "/api/assets/%2e%2e/outside.png", "../../assets/outside.png", "./assets/a.png:stream", "./assets/folder./a.png"]) {
    await put("2026-01_学习日志.md", `## 2026-01-15\n\n![invalid](${uri})\n`);
    await assert.rejects(buildLogExport("day", "2026-01-15"), ExportInputError);
  }
  const examples = "## 2026-01-15\n\n![remote](https://example.test/remote.png)\n\n![local](file:///private/example.png)\n\n```md\n![code](./assets/../outside.png)\n```\n";
  await put("2026-01_学习日志.md", examples);
  exactFiles(unpack(await buildLogExport("day", "2026-01-15")), { "2026-01-15/2026-01-15.md": examples });
});

test("linked source/asset directories are errors instead of ordinary missing-asset warnings", async t => {
  const { root, data, put } = await fixture(t);
  const outside = path.join(root, "other-instance"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "image.png"), "outside");
  await put("2026-01_学习日志.md", "## 2026-01-15\n\n![图](./assets/linked/image.png)\n");
  await fs.mkdir(path.join(data, "assets"));
  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(outside, path.join(data, "assets", "linked"), type);
  await assert.rejects(buildLogExport("day", "2026-01-15"), ExportInputError);
  const rootAlias = path.join(root, "linked-root"); await fs.symlink(data, rootAlias, type); process.env.LOG_ROOT = rootAlias;
  await assert.rejects(buildLogExport("all", null));
  process.env.LOG_ROOT = data;
  await fs.symlink(outside, path.join(data, "2025_学习日志.md"), type);
  await assert.rejects(buildLogExport("all", null));
});

test("asset read failures reject the export, and source changes during attachment preparation are not called complete", async t => {
  const { put, data } = await fixture(t);
  const source = "## 2026-01-15\n\n![图](./assets/a.png)\n";
  await put("2026-01_学习日志.md", source); await put("assets/a.png", "synthetic bytes");
  const open = fs.open;
  try {
    fs.open = async (target, ...args) => { if (target === path.join(data, "assets/a.png")) throw Object.assign(new Error("synthetic access failure"), { code: "EACCES" }); return open(target, ...args); };
    await assert.rejects(buildLogExport("day", "2026-01-15"), /could not be read/);
  } finally { fs.open = open; }
  try {
    fs.open = async (target, ...args) => { const handle = await open(target, ...args); if (target === path.join(data, "assets/a.png")) await fs.writeFile(path.join(data, "2026-01_学习日志.md"), source + "外部更新"); return handle; };
    await assert.rejects(buildLogExport("day", "2026-01-15"), ExportChangedError);
  } finally { fs.open = open; }
});

test("notes pending recovery blocks sharing and metadata stripping preserves CRLF source content", async t => {
  const { data } = await fixture(t);
  await createStudyNote({ body: "合成", recordedAt: "2026-01-15T09:00" });
  const source = (await fs.readFile(path.join(data, "随记/2026_随记.md"), "utf8")).replace(/\n/g, "\r\n");
  const exported = stripNoteMetadata(source, "2026");
  assert.ok(exported.includes("\r\n")); assert.ok(!exported.replace(/\r\n/g, "").includes("\n"));
  await fs.writeFile(path.join(data, "随记/.pending-write.json"), "{}");
  await assert.rejects(buildLogExport("notes", null), NoteRecoveryError);
});
