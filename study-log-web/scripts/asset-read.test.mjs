import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { readAssetResponse } from "../lib/asset-read.ts";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-asset-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-asset-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const data = path.join(root, "data");
  await fs.mkdir(path.join(data, "assets", "2026"), { recursive: true });
  return { root, data };
}

test("returns asset bytes with image MIME and restrictive response headers", async t => {
  const { data } = await fixture(t);
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await fs.writeFile(path.join(data, "assets/2026/synthetic.PNG"), bytes);
  const response = await readAssetResponse(data, ["2026", "synthetic.PNG"]);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
});

test("route refuses unauthenticated access before resolving paths and serves an authorized request", async t => {
  const { data } = await fixture(t);
  await fs.writeFile(path.join(data, "assets", "sample.png"), "synthetic");
  const source = await fs.readFile(new URL("../app/api/assets/[...assetPath]/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  let authorized = false, roots = 0;
  runInNewContext(outputText, { exports: module.exports, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/config") return { getLogRoot: () => { roots++; return data; } };
    if (name === "@/lib/asset-read") return { readAssetResponse };
    throw new Error(`Unexpected route dependency ${name}`);
  } });
  assert.equal((await module.exports.GET({}, { get params() { assert.fail("unauthenticated params access"); } })).status, 401);
  assert.equal(roots, 0);
  authorized = true;
  const response = await module.exports.GET({}, { params: Promise.resolve({ assetPath: ["sample.png"] }) });
  assert.equal(response.status, 200); assert.equal(await response.text(), "synthetic");
  assert.equal(roots, 1);
});

test("SVG and unknown formats cannot opt into script execution", async t => {
  const { data } = await fixture(t);
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><script>window.synthetic=true</script></svg>';
  for (const name of ["synthetic.svg", "synthetic.html"]) {
    await fs.writeFile(path.join(data, "assets", name), source);
    const response = await readAssetResponse(data, [name]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), name.endsWith("svg") ? "image/svg+xml" : "application/octet-stream");
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /^sandbox;/); assert.match(csp, /script-src 'none'/);
    assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/);
  }
});

test("rejects traversal, embedded separators, alternate streams and path aliases", async t => {
  const { root, data } = await fixture(t);
  await fs.writeFile(path.join(root, "outside.txt"), "synthetic outside material");
  for (const segments of [[], ["..", "outside.txt"], ["."], [""], ["../outside.txt"],
    ["..\\outside.txt"], ["/outside.txt"], ["C:\\outside.txt"], ["image.png:stream"], ["image.png."], ["image.png "], ["x\0y"]]) {
    const response = await readAssetResponse(data, segments);
    assert.equal(response.status, 400, JSON.stringify(segments));
    assert.deepEqual(await response.json(), { error: "Invalid asset path" });
  }
});

test("missing assets and directories return 404 without filesystem details", async t => {
  const { root, data } = await fixture(t);
  for (const segments of [["missing.png"], ["2026"], ["missing", "image.png"]]) {
    const response = await readAssetResponse(data, segments);
    assert.equal(response.status, 404);
    const body = await response.text(); assert.ok(!body.includes(root));
  }
});

test("rejects an assets root or nested directory linked into another instance", async t => {
  const { root, data } = await fixture(t);
  const other = path.join(root, "other-instance");
  await fs.mkdir(path.join(other, "assets"), { recursive: true });
  await fs.writeFile(path.join(other, "assets", "outside.png"), "other instance synthetic bytes");
  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(path.join(other, "assets"), path.join(data, "assets", "linked"), type);
  assert.equal((await readAssetResponse(data, ["linked", "outside.png"])).status, 400);
  const aliasInstance = path.join(root, "alias-instance");
  await fs.mkdir(aliasInstance);
  await fs.symlink(path.join(other, "assets"), path.join(aliasInstance, "assets"), type);
  assert.equal((await readAssetResponse(aliasInstance, ["outside.png"])).status, 400);
  const rootAlias = path.join(root, "root-alias");
  await fs.symlink(other, rootAlias, type);
  assert.equal((await readAssetResponse(rootAlias, ["outside.png"])).status, 400);
  assert.equal(await fs.readFile(path.join(other, "assets", "outside.png"), "utf8"), "other instance synthetic bytes");
});

test("rejects a linked file and fails closed if a checked file is replaced before open", async t => {
  const { root, data } = await fixture(t);
  const outside = path.join(root, "outside.png");
  await fs.writeFile(outside, "synthetic outside");
  const link = path.join(data, "assets", "linked.png");
  try { await fs.symlink(outside, link, "file"); }
  catch (error) { if (error.code === "EPERM") { t.skip("file symlink creation requires Windows developer mode or permission"); return; } throw error; }
  assert.equal((await readAssetResponse(data, ["linked.png"])).status, 400);
  const target = path.join(data, "assets", "raced.png");
  await fs.writeFile(target, "original synthetic");
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async (file, ...args) => {
    if (file === target) { await fs.unlink(target); await fs.symlink(outside, target, "file"); }
    return originalOpen(file, ...args);
  };
  assert.equal((await readAssetResponse(data, ["raced.png"])).status, 400);
});

test("refuses a parent directory replaced with a junction during file open", async t => {
  const { root, data } = await fixture(t);
  const outside = path.join(root, "outside-assets");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "sample.png"), "outside synthetic");
  const directory = path.join(data, "assets", "2026");
  const target = path.join(directory, "sample.png");
  await fs.writeFile(target, "original synthetic");
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async (file, ...args) => {
    if (file === target) {
      await fs.rename(directory, path.join(data, "assets", "original"));
      await fs.symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
    }
    return originalOpen(file, ...args);
  };
  const response = await readAssetResponse(data, ["2026", "sample.png"]);
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("outside synthetic"));
});
