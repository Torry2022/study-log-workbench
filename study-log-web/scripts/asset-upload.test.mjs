import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as upload from "../lib/asset-upload.ts";
import * as boundary from "../lib/asset-path.ts";
import { MAX_IMAGE_BYTES, IMAGE_MIME_EXTENSIONS } from "../lib/asset-upload-rules.ts";
import { readAssetResponse } from "../lib/asset-read.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-upload-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-upload-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const data = path.join(root, "data");
  await fs.mkdir(data);
  return { root, data };
}
function image(name = "synthetic.png", bytes = "synthetic image", type = "image/png") {
  return new File([bytes], name, { type });
}
function form(...files) {
  const value = new FormData();
  for (const file of files) value.append("file", file);
  return value;
}

test("uploads original bytes, returns safe relative Markdown and preserves existing assets", async t => {
  const { data } = await fixture(t);
  await fs.mkdir(path.join(data, "assets"));
  await fs.writeFile(path.join(data, "assets", "existing.png"), "existing");
  const input = image("../../hostile[name].PNG");
  const groups = await Promise.all(Array.from({ length: 8 }, () => upload.uploadAssets(data, form(input))));
  const results = groups.flat();
  assert.equal(new Set(results.map(item => item.fileName)).size, 8);
  for (const result of results) {
    assert.match(result.fileName, /^image-\d+-[0-9a-f-]+\.png$/);
    assert.equal(result.path, `./assets/${result.fileName}`);
    assert.equal(result.markdown, `![${result.fileName.slice(0, -4)}](${result.path})`);
    const response = await readAssetResponse(data, [result.fileName]);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "synthetic image");
  }
  assert.equal(await fs.readFile(path.join(data, "assets", "existing.png"), "utf8"), "existing");
});

test("supports product image MIME types including sandboxed SVG without re-encoding", async t => {
  const { data } = await fixture(t);
  for (const [mime, extension] of Object.entries(IMAGE_MIME_EXTENSIONS)) {
    const [result] = await upload.uploadAssets(data, form(image("clipboard", "original synthetic", mime)));
    assert.ok(result.fileName.endsWith(extension));
    const response = await readAssetResponse(data, [result.fileName]);
    assert.equal(response.headers.get("content-type"), mime);
    assert.match(response.headers.get("content-security-policy"), /^sandbox;/);
    assert.equal(await response.text(), "original synthetic");
  }
});

test("preflights the whole batch: bad late file, empty, oversized, count and unsupported scope write nothing", async t => {
  const { data } = await fixture(t);
  const notes = form(image()); notes.set("scope", "unknown");
  const candidates = [form(), form(...Array.from({ length: 11 }, () => image())),
    form(image(), image("bad.txt", "text", "text/plain")), form(image(), "not a file"),
    form(image(), image("empty.png", "")),
    form(image(), image("large.png", new Uint8Array(MAX_IMAGE_BYTES + 1))), notes];
  for (const input of candidates) {
    await assert.rejects(upload.uploadAssets(data, input), upload.AssetUploadInputError);
    assert.deepEqual(await fs.readdir(data), []);
  }
  const [result] = await upload.uploadAssets(data, form(image("limit.png", new Uint8Array(MAX_IMAGE_BYTES))));
  assert.equal((await fs.stat(path.join(data, "assets", result.fileName))).size, MAX_IMAGE_BYTES);
  assert.equal((await upload.uploadAssets(data, form(...Array.from({ length: 10 }, () => image())))).length, 10);
});

test("note images retain year-relative Markdown and authenticated asset reading", async t => {
  const { data } = await fixture(t);
  const input = form(image()); input.set("scope", "notes");
  for (const year of ["", "../2026", "0000", "26", "2026/elsewhere"]) {
    input.set("year", year);
    await assert.rejects(upload.uploadAssets(data, input), upload.AssetUploadInputError);
    assert.deepEqual(await fs.readdir(data), []);
  }
  input.set("year", "2026");
  const [asset] = await upload.uploadAssets(data, input);
  assert.equal(asset.path, `../assets/notes/2026/${asset.fileName}`);
  const response = await readAssetResponse(data, ["notes", "2026", asset.fileName]);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "synthetic image");
  assert.deepEqual((await fs.readdir(path.join(data, "assets"))).sort(), ["notes"]);
});

test("note year directories cannot follow a junction into another instance", async t => {
  const { root, data } = await fixture(t);
  const outside = path.join(root, "outside-notes");
  await fs.mkdir(outside);
  await fs.mkdir(path.join(data, "assets", "notes"), { recursive: true });
  await fs.symlink(outside, path.join(data, "assets", "notes", "2026"), process.platform === "win32" ? "junction" : "dir");
  const input = form(image()); input.set("scope", "notes"); input.set("year", "2026");
  await assert.rejects(upload.uploadAssets(data, input), boundary.InvalidAssetPath);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("refuses linked data/assets roots without writing another instance", async t => {
  const { root, data } = await fixture(t);
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  const kind = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(outside, path.join(data, "assets"), kind);
  await assert.rejects(upload.uploadAssets(data, form(image())), boundary.InvalidAssetPath);
  const alias = path.join(root, "data-alias");
  await fs.symlink(outside, alias, kind);
  await assert.rejects(upload.uploadAssets(alias, form(image())), boundary.InvalidAssetPath);
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(upload.uploadAssets("relative", form(image())), boundary.InvalidAssetPath);
});

test("exclusive open collision never overwrites and later write failure removes this batch only", async t => {
  const { data } = await fixture(t);
  const directory = path.join(data, "assets"); await fs.mkdir(directory);
  const existing = path.join(directory, "existing.png"); await fs.writeFile(existing, "keep");
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  let calls = 0;
  fs.open = async (file, flags, ...rest) => {
    assert.equal(flags, "wx");
    calls++;
    if (calls === 2) throw Object.assign(new Error("synthetic private path"), { code: "EIO" });
    return originalOpen(file, flags, ...rest);
  };
  await assert.rejects(upload.uploadAssets(data, form(image(), image())), /synthetic private path/);
  assert.deepEqual(await fs.readdir(directory), ["existing.png"]);
  fs.open = async (file, flags, ...rest) => {
    await fs.writeFile(file, "concurrent owner", { flag: "wx" });
    return originalOpen(file, flags, ...rest);
  };
  await assert.rejects(upload.uploadAssets(data, form(image())), { code: "EEXIST" });
  for (const file of await fs.readdir(directory)) {
    assert.equal(await fs.readFile(path.join(directory, file), "utf8"), file === "existing.png" ? "keep" : "concurrent owner");
  }
});

test("a partially written file is rolled back on write failure", async t => {
  const { data } = await fixture(t);
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    const originalWrite = handle.writeFile.bind(handle);
    handle.writeFile = async () => {
      await originalWrite("partial synthetic bytes");
      throw Object.assign(new Error("synthetic disk full"), { code: "ENOSPC" });
    };
    return handle;
  };
  await assert.rejects(upload.uploadAssets(data, form(image())), { code: "ENOSPC" });
  assert.deepEqual(await fs.readdir(path.join(data, "assets")), []);
});

test("actual multipart stream is bounded and malformed forms are input errors", async () => {
  const request = new Request("http://localhost/upload", { method: "POST", body: form(image()) });
  const parsed = await upload.readUploadForm(request);
  assert.equal(parsed.get("file").name, "synthetic.png");
  await assert.rejects(upload.readUploadForm(new Request("http://localhost", { method: "POST", body: "wrong" })), upload.AssetUploadInputError);
  await assert.rejects(upload.readUploadForm(new Request("http://localhost", {
    method: "POST", body: "broken", headers: { "content-type": "multipart/form-data; boundary=x" }
  })), upload.AssetUploadInputError);
  await assert.rejects(upload.readUploadForm(new Request("http://localhost", {
    method: "POST", body: "small", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(upload.MAX_UPLOAD_BODY_BYTES + 1) }
  })), upload.AssetUploadTooLargeError);
  let canceled = false;
  const chunk = new TextEncoder().encode("--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"large.png\"\r\nContent-Type: image/png\r\n\r\n");
  let first = true;
  const data = new Uint8Array(16 * 1024 * 1024);
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(first ? chunk : data); first = false; }, cancel() { canceled = true; } });
  await assert.rejects(upload.readUploadForm(new Request("http://localhost", {
    method: "POST", body: stream, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=x" }
  })), upload.AssetUploadTooLargeError);
  assert.equal(canceled, true);
});

test("route authorizes before consuming body, handles real multipart, and hides storage failure paths", async t => {
  const { data } = await fixture(t);
  const source = await fs.readFile(new URL("../app/api/assets/upload/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  let authorized = false;
  runInNewContext(outputText, { Response, exports: module.exports, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/config") return { getLogRoot: () => data };
    if (name === "@/lib/asset-upload") return upload;
    if (name === "@/lib/asset-path") return boundary;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  assert.equal((await module.exports.POST({ get headers() { assert.fail("anonymous body access"); } })).status, 401);
  authorized = true;
  const send = input => module.exports.POST(new Request("http://localhost/upload", { method: "POST", body: input }));
  const response = await send(form(image()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).assets.length, 1);
  assert.equal((await send(form(image("bad.html", "<html>", "text/html")))).status, 400);
  assert.equal((await send(form(image("large.png", new Uint8Array(MAX_IMAGE_BYTES + 1))))).status, 413);
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async () => { throw new Error(`synthetic failure at ${data}`); };
  const failed = await send(form(image()));
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes(data));
});
