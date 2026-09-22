import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as store from "../lib/favorites-store.ts";
import { buildMarkdownOutline } from "../lib/markdown-outline.ts";

const source = "## 2026-01-01\n\n### Topic\nFirst body\n```md\n### Fake\n```\nAfter code\n#### Child\nChild body\n### Topic\nSecond body\n### Other\nOther body\n";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-favorites-test-"));
  const data = path.join(root, "data"); await fs.mkdir(data);
  const previous = process.env.LOG_ROOT; process.env.LOG_ROOT = data;
  t.after(async () => {
    if (previous === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-favorites-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const log = path.join(data, "2026_学习日志.md"); await fs.writeFile(log, source);
  return { root, data, log, file: path.join(data, ".study-log-favorites.json") };
}
function input(index = 0) {
  const heading = buildMarkdownOutline(source).filter(item => item.level === 3)[index];
  return { date: "2026-01-01", headingText: heading.text, headingId: heading.id, level: 3 };
}

test("empty instance stays empty until mutation; duplicate favorites retain identity and AST sections", async t => {
  const { data, log } = await fixture(t);
  assert.deepEqual(await store.listFavoritesSnapshot(), { favorites: [], groups: [] });
  assert.deepEqual(await fs.readdir(data), ["2026_学习日志.md"]);
  const first = await store.addFavorite(input());
  assert.equal(first.exists, true);
  assert.match(first.sectionSearchText, /First body.*After code.*Child body/);
  assert.doesNotMatch(first.sectionSearchText, /Fake|Second body|Other body/);
  const again = await store.addFavorite(input());
  assert.equal(again.id, first.id); assert.equal(again.createdAt, first.createdAt);
  const second = await store.addFavorite(input(1));
  assert.equal(second.resolvedHeadingId, "topic-2");
  assert.equal(second.sectionSearchText, "Second body");
  assert.equal((await store.listFavorites()).length, 2);
  assert.equal(await fs.readFile(log, "utf8"), source);
});

test("groups deduplicate, rename, allow multi-membership and remove without deleting favorites", async t => {
  await fixture(t);
  const favorite = await store.addFavorite(input());
  const first = await store.createFavoriteGroup("  Engineering  ");
  const second = await store.createFavoriteGroup("Reading");
  assert.equal((await store.createFavoriteGroup("Engineering")).id, first.id);
  assert.deepEqual((await store.listFavoriteGroups()).map(item => item.order), [1, 2]);
  const assigned = await store.updateFavoriteGroups(favorite.id, [first.id, second.id, first.id, "not-existing"]);
  assert.deepEqual(assigned.groupIds, [first.id, second.id]);
  await assert.rejects(store.renameFavoriteGroup(first.id, "Reading"), store.FavoriteInputError);
  assert.equal((await store.renameFavoriteGroup(first.id, "Systems")).name, "Systems");
  await store.removeFavoriteGroup(first.id);
  assert.deepEqual((await store.listFavorites())[0].groupIds, [second.id]);
  await store.removeFavorite(favorite.id);
  assert.equal((await store.listFavorites()).length, 0);
  assert.equal((await store.listFavoriteGroups()).length, 1);
});

test("deleted or renamed source sections remain visible as unresolved favorites", async t => {
  const { log } = await fixture(t);
  await store.addFavorite(input(1));
  await fs.writeFile(log, "## 2026-01-01\n### Topic\nNow first occurrence\n");
  const moved = (await store.listFavorites())[0];
  assert.equal(moved.exists, true); assert.equal(moved.resolvedHeadingId, "topic");
  await fs.writeFile(log, "## 2026-01-01\n### Renamed\nOther body\n");
  const renamed = (await store.listFavorites())[0];
  assert.equal(renamed.exists, false); assert.equal(renamed.resolvedHeadingId, null); assert.equal(renamed.sectionSearchText, "");
  await fs.writeFile(log, "");
  assert.equal((await store.listFavorites())[0].exists, false);
});

test("concurrent updates serialize without lost groups or duplicate favorites and reads see valid JSON", async t => {
  const { file } = await fixture(t);
  await store.createFavoriteGroup("Initial");
  await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    await store.createFavoriteGroup(`Group ${index}`);
    const parsed = await store.listFavoritesSnapshot();
    assert.ok(parsed.groups.length >= 1); assert.ok(parsed.groups.length <= 21);
  }));
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).groups.length, 21);
  assert.equal((await store.listFavoriteGroups()).length, 21);
  await Promise.all(Array.from({ length: 12 }, () => store.addFavorite(input())));
  assert.equal((await store.listFavorites()).length, 1);
});

test("partial temp write and rename failures preserve original bytes and release the queue", async t => {
  const { data, file } = await fixture(t);
  await store.createFavoriteGroup("Preserved");
  const original = await fs.readFile(file);
  const originalOpen = fs.open, originalRename = fs.rename;
  t.after(() => { fs.open = originalOpen; fs.rename = originalRename; });
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    const write = handle.writeFile.bind(handle);
    handle.writeFile = async () => { await write('{"partial":'); throw Object.assign(new Error("synthetic full disk"), { code: "ENOSPC" }); };
    return handle;
  };
  await assert.rejects(store.createFavoriteGroup("Failed"), { code: "ENOSPC" });
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal((await fs.readdir(data)).filter(name => name.endsWith(".tmp")).length, 0);
  fs.open = originalOpen;
  fs.rename = async () => { throw Object.assign(new Error("synthetic rename failure"), { code: "EACCES" }); };
  await assert.rejects(store.createFavoriteGroup("Failed rename"), { code: "EACCES" });
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal((await fs.readdir(data)).filter(name => name.endsWith(".tmp")).length, 0);
  fs.rename = originalRename;
  await store.createFavoriteGroup("Next works");
  assert.deepEqual((await store.listFavoriteGroups()).map(item => item.name), ["Preserved", "Next works"]);
});

test("malformed JSON/schema are not silently overwritten and invalid input writes nothing", async t => {
  const { file } = await fixture(t);
  for (const content of ["{broken", '{"favorites":[],"groups":[{"id":"partial"}]}', "null"]) {
    await fs.writeFile(file, content);
    await assert.rejects(store.listFavoritesSnapshot());
    await assert.rejects(store.createFavoriteGroup("Do not overwrite"));
    assert.equal(await fs.readFile(file, "utf8"), content);
  }
  await fs.unlink(file);
  for (const bad of [{ ...input(), date: "2026-02-30" }, { ...input(), level: 2 }, { ...input(), headingText: " " }]) {
    await assert.rejects(store.addFavorite(bad), store.FavoriteInputError);
  }
  await assert.rejects(store.updateFavoriteGroups("id", "wrong"), store.FavoriteInputError);
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
});

test("instance junctions cannot cross the storage boundary", async t => {
  const { root } = await fixture(t);
  const outside = path.join(root, "outside"); await fs.mkdir(outside);
  const otherFile = path.join(outside, ".study-log-favorites.json");
  const original = '{"favorites":[],"groups":[]}'; await fs.writeFile(otherFile, original);
  const alias = path.join(root, "alias");
  await fs.symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  process.env.LOG_ROOT = alias;
  await assert.rejects(store.createFavoriteGroup("Not outside"));
  assert.equal(await fs.readFile(otherFile, "utf8"), original);
});

test("favorites-file symlinks cannot cross the storage boundary", async t => {
  const { root, file } = await fixture(t);
  const otherFile = path.join(root, "outside-favorites.json");
  const original = '{"favorites":[],"groups":[]}'; await fs.writeFile(otherFile, original);
  try { await fs.symlink(otherFile, file, "file"); }
  catch (error) { if (error.code === "EPERM") { t.skip("file symlink creation requires Windows developer permission"); return; } throw error; }
  await assert.rejects(store.createFavoriteGroup("Not through file link"));
  assert.equal(await fs.readFile(otherFile, "utf8"), original);
});

test("stored creation order and group order are preserved across reloads", async t => {
  const { file } = await fixture(t);
  const first = await store.addFavorite(input()); const second = await store.addFavorite(input(1));
  const firstGroup = await store.createFavoriteGroup("First"); await store.createFavoriteGroup("Second");
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  raw.favorites[0].createdAt = "2026-02-01T00:00:00.000Z";
  raw.favorites[1].createdAt = "2026-01-01T00:00:00.000Z";
  raw.groups.reverse();
  await fs.writeFile(file, JSON.stringify(raw));
  await store.addFavorite(input(1));
  const result = await store.listFavoritesSnapshot();
  assert.deepEqual(result.favorites.map(item => item.id), [first.id, second.id]);
  assert.equal(result.groups[0].id, firstGroup.id);
});

test("API authenticates all methods before body access, preserves contracts and sanitizes errors", async t => {
  const { file, root } = await fixture(t);
  const source = await fs.readFile(new URL("../app/api/favorites/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} }; let authorized = false;
  runInNewContext(outputText, { Response, exports: module.exports, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/favorites-store") return store;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    assert.equal((await module.exports[method]({ get nextUrl() { assert.fail("anonymous URL"); }, json() { assert.fail("anonymous body"); } })).status, 401);
  }
  authorized = true;
  const request = value => ({ json: async () => value });
  assert.equal((await module.exports.POST(request(null))).status, 400);
  assert.equal((await module.exports.POST({ json: async () => { throw new Error(); } })).status, 400);
  const group = (await (await module.exports.POST(request({ action: "createGroup", name: "Synthetic" }))).json()).group;
  const favorite = (await (await module.exports.POST(request(input()))).json()).favorite;
  const assigned = await module.exports.PATCH(request({ id: favorite.id, groupIds: [group.id] }));
  assert.deepEqual((await assigned.json()).favorite.groupIds, [group.id]);
  const listed = await module.exports.GET({});
  assert.equal(listed.headers.get("cache-control"), "no-store");
  assert.equal((await listed.json()).favorites.length, 1);
  assert.equal((await module.exports.DELETE({ nextUrl: new URL(`http://localhost?groupId=${group.id}`) })).status, 200);
  await fs.writeFile(file, `{bad ${root}`);
  const failed = await module.exports.GET({});
  assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes(root));
});
